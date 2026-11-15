// 상세페이지에 꼭 필요한 연출 사진만 AI로 만들고, 이상한 사진은 자동으로 걸러낸다.
// - 생성: OpenAI 이미지 편집 API (실제 상품 사진을 기준으로 연출만 바꿈)
// - 검수: Claude가 기준 사진과 생성 사진을 함께 보고 점수·탈락 사유를 판단
import Anthropic from "@anthropic-ai/sdk"
import { getStore } from "@netlify/blobs"
import { randomUUID } from "node:crypto"

export type Shot = { base: number; what: string; why: string }
export type ShotResult = {
  what: string
  why: string
  base: number
  ok: boolean
  url?: string
  score?: number
  tries: { score: number; pass: boolean; reasons: string }[]
  error?: string
}

const PASS_SCORE = 7
const MAX_TRIES = 3

export function imageGenConfigured() {
  return !!process.env.OPENAI_API_KEY
}

async function toDataUrl(url: string) {
  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } })
  if (!r.ok) throw new Error(`기준 사진을 불러오지 못했습니다 (${r.status})`)
  const type = r.headers.get("content-type")?.split(";")[0] || "image/jpeg"
  const buf = Buffer.from(await r.arrayBuffer())
  return { dataUrl: `data:${type};base64,${buf.toString("base64")}`, b64: buf.toString("base64"), type }
}

const genPrompt = (what: string) =>
  [
    `Korean online grocery product photo: ${what}.`,
    "Use the reference photo as the exact product: keep the same fruit variety, the same peel color and texture, the same size and shape, and the same packaging if visible.",
    "Do not make the fruit bigger, shinier, more saturated or more perfect than in the reference. Only change camera angle, setting, props and lighting.",
    "Real photograph, natural daylight from the side, shot on a full-frame camera with a 50mm lens, shallow depth of field, clean neutral background or a simple wooden table.",
    "No text, no letters, no numbers, no logos, no watermark, no stickers, no hands unless necessary.",
  ].join(" ")

async function openaiEdit(prompt: string, ref: { dataUrl: string }) {
  const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "")
  const r = await fetch(`${base}/images/edits`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2.6-sunburst",
      prompt,
      images: [{ image_url: ref.dataUrl }],
      size: "1024x1024",
      quality: "high",
      output_format: "jpeg",
      output_compression: 88,
      n: 1,
    }),
  })
  const j: any = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error("OpenAI 이미지 오류: " + (j?.error?.message || r.status))
  const b64 = j?.data?.[0]?.b64_json
  if (!b64) throw new Error("OpenAI가 이미지를 돌려주지 않았습니다.")
  return b64 as string
}

const CHECK = `당신은 쿠팡 신선식품 상세페이지 사진을 검수하는 깐깐한 사진 편집장입니다.
사진 A는 실제 상품 사진, 사진 B는 AI가 만든 연출 사진입니다. 사진 B를 상세페이지에 써도 되는지 판정하세요.

바로 탈락(점수 4 이하):
- 과일 모양이 찌그러짐, 녹아 붙음, 개수·꼭지·잎이 이상함, 다른 과일처럼 보임
- 사진 A보다 눈에 띄게 크고·진하고·매끈해서 실제로 받으면 다르다고 느낄 정도
- 글자·숫자·로고·워터마크가 생김(뭉개진 글자 포함)
- 손가락·칼·포장 등 소품이 기괴하거나 물리적으로 말이 안 됨
- 한눈에 AI 그림·3D 렌더처럼 보임

점수 기준(10점 만점): 실제 사진처럼 자연스러운가, 먹음직스러운가, 사진 A와 같은 상품으로 보이는가, 구도·밝기·선명도.
반드시 아래 JSON 한 줄만 출력: {"score": 0~10 정수, "pass": true/false, "reasons": "한국어 한두 문장"}`

async function checkImage(client: Anthropic, ref: { b64: string; type: string }, genB64: string, what: string) {
  const msg: any = await client.messages.create({
    model: process.env.AI_MODEL || "claude-sonnet-5-5",
    max_tokens: 400,
    system: CHECK,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: `만들려던 사진: ${what}\n사진 A (실제 상품):` },
          { type: "image", source: { type: "base64", media_type: ref.type as any, data: ref.b64 } },
          { type: "text", text: "사진 B (AI 연출):" },
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: genB64 } },
        ],
      },
    ],
  })
  const text = msg.content.map((b: any) => (b.type === "text" ? b.text : "")).join("")
  const m = text.match(/\{[\s\S]*\}/)
  try {
    const j = JSON.parse(m ? m[0] : text)
    const score = Math.max(0, Math.min(10, Math.round(Number(j.score) || 0)))
    return { score, pass: !!j.pass && score >= PASS_SCORE, reasons: String(j.reasons || "").slice(0, 300) }
  } catch {
    return { score: 0, pass: false, reasons: "검수 결과를 읽지 못해 제외" }
  }
}

// 필요한 컷만 만들고, 통과한 사진만 공개 주소로 저장해 돌려준다.
export async function makeShots(shots: Shot[], photoUrls: string[], origin: string): Promise<ShotResult[]> {
  const client = new Anthropic()
  const out: ShotResult[] = []
  for (const s of shots.slice(0, 2)) {
    const res: ShotResult = { what: s.what, why: s.why, base: s.base, ok: false, tries: [] }
    out.push(res)
    try {
      const baseUrl = photoUrls[s.base - 1]
      if (!baseUrl) throw new Error(`기준 사진 ${s.base}번이 없습니다.`)
      const ref = await toDataUrl(baseUrl)
      let best: { b64: string; score: number } | null = null
      for (let i = 0; i < MAX_TRIES; i++) {
        const b64 = await openaiEdit(genPrompt(s.what), ref)
        const c = await checkImage(client, ref, b64, s.what)
        res.tries.push(c)
        if (c.pass && (!best || c.score > best.score)) best = { b64, score: c.score }
        if (c.pass && c.score >= 8) break
      }
      if (best) {
        const key = `${randomUUID()}.jpg`
        const buf = Buffer.from(best.b64, "base64")
        const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
        await getStore({ name: "public-images", consistency: "strong" }).set(key, ab, {
          metadata: { ai: "1", what: s.what },
        })
        res.ok = true
        res.score = best.score
        res.url = `${origin}/img/${key}`
      }
    } catch (e: any) {
      res.error = String(e?.message || e)
    }
  }
  return out
}
