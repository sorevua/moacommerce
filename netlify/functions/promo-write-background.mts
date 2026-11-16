// 홍보 글 AI 작성 (블로그·인스타·당근·밴드·오픈채팅 공지 등). 결과는 admin-promo 저장소에 저장.
import { getStore } from "@netlify/blobs"
import Anthropic from "@anthropic-ai/sdk"
import { randomUUID } from "node:crypto"
import { isLoggedIn } from "./_lib/auth.mts"
import { aiCreate } from "./_lib/ai.mts"
import { HUMAN_RULES, aiTells } from "./_lib/human.mts"

const st = () => getStore({ name: "admin-promo", consistency: "strong" })
const now = () => new Date().toISOString()

const GUIDE: Record<string, string> = {
  naver_blog: `네이버 블로그 글. 제목 1개(25~35자, 검색어를 앞쪽에). 본문 1,500~2,500자.
구성: 인사·도입(왜 이 과일인지) → 사진별 설명 → 맛·식감·크기(근거 있는 것만) → 고르는 법·보관법 → 구매·문의 방법 → 마무리.
사진 자리는 본문 안에 [사진1], [사진2]처럼 따로 한 줄로 표시. 모든 사진을 한 번씩 쓴다.
문단은 2~3문장, 줄바꿈을 넉넉히. 이모지는 문단 앞에 가끔만. 태그 10~15개.`,
  instagram: `인스타그램 게시글. 첫 줄은 눈길을 끄는 한 문장(25자 이내). 본문 300~600자, 짧은 줄 위주, 이모지 적당히.
마지막에 "프로필 링크"나 오픈채팅 안내. 해시태그 15~25개(한 줄에 모아서).`,
  threads: `스레드 글. 300자 이내 대화체. 질문으로 끝내 댓글을 유도. 해시태그 1~3개.`,
  karrot: `당근 비즈프로필 소식. 이웃에게 말하듯 친근하게 400~700자. 동네 이웃 대상이라 과장 없이, 받는 방법·문의 방법을 분명히. 해시태그 없음.`,
  band: `밴드 게시글. 회원에게 공지하듯 400~800자. 품목·옵션·주문 방법을 목록으로 정리.`,
  openchat: `카카오 오픈채팅방 공지. 200~400자. 핵심만: 품목, 특징, 주문 방법. 줄바꿈 많이.`,
}

const SYSTEM = `당신은 한국 농산물 직거래 홍보 글을 쓰는 전문 마케터입니다.
규칙:
- 판매자가 준 사실과 사진에 보이는 것만 쓴다. 없는 당도·수상·인증·판매량·후기·순위·효능은 만들지 않는다.
- "최고","1위","100%","무조건", 질병 예방·치료 같은 과장·의학 표현 금지.
- 측정값은 "측정 예시"로 쓰고 과일마다 차이가 있다고 붙인다.
- 가격은 판매자가 준 경우에만 쓴다.
- 판매자가 준 링크(오픈채팅·카카오톡·쿠팡 등)는 그대로 정확히 넣는다. 다른 링크를 만들지 않는다.
- 다른 판매자·브랜드 비방 금지. 반복 문장 금지.
${HUMAN_RULES}
출력은 아래 형식 그대로, 다른 말 없이:
@@TITLE
제목
@@BODY
본문
@@TAGS
태그1, 태그2, ...`

const sec = (t: string, n: string) => (t.match(new RegExp(`@@${n}\\s*([\\s\\S]*?)(?=\\n@@[A-Z]+\\s|$)`)) || [])[1]?.trim() || ""

export default async (req: Request) => {
  if (!isLoggedIn(req)) return
  const job: any = await req.json().catch(() => ({}))
  if (!job.jobId) return
  const key = `job-${job.jobId}`
  await st().setJSON(key, { running: true, at: now() })
  try {
    const channel = GUIDE[job.channel] ? job.channel : "naver_blog"
    const settings: any = (await st().get("settings", { type: "json" })) || {}
    const photos: string[] = (job.photos || []).filter((u: string) => /^https:\/\/[^\s"'<>]+\/img\/[a-f0-9-]{36}\.jpg$/.test(u)).slice(0, 10)
    const links = [
      settings.openchat && `카카오 오픈채팅: ${settings.openchat}`,
      settings.kakao && `카카오톡 채널: ${settings.kakao}`,
      job.buyUrl && `구매 링크: ${job.buyUrl}`,
    ].filter(Boolean)
    const content: any[] = [{
      type: "text",
      text: `채널 안내:\n${GUIDE[channel]}\n\n판매자 브랜드: ${settings.brand || "모아커머스"}\n상품: ${job.product || ""}\n판매자가 준 사실:\n${job.facts || "(없음)"}\n가격 안내: ${job.price || "(쓰지 말 것)"}\n넣을 링크:\n${links.join("\n") || "(없음)"}\n사진 수: ${photos.length}장${settings.voice ? `\n\n판매자 말투 샘플(말투만 참고):\n${settings.voice}` : ""}`,
    }]
    for (let i = 0; i < photos.length; i++) {
      try {
        const r = await fetch(photos[i])
        const b64 = Buffer.from(await r.arrayBuffer()).toString("base64")
        content.push({ type: "text", text: `[사진${i + 1}]` }, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } })
      } catch {}
    }
    const client = new Anthropic()
    const msg: any = await aiCreate(client, { model: process.env.AI_MODEL || "claude-sonnet-5-5", max_tokens: 6000, system: SYSTEM, messages: [{ role: "user", content }] })
    let text = msg.content.map((b: any) => (b.type === "text" ? b.text : "")).join("")
    // AI 말버릇이 남았으면 한 번 더 고쳐 쓴다 (사실·숫자·링크는 그대로)
    const tells = aiTells(text)
    if (tells.length) {
      try {
        const fix: any = await aiCreate(client, { model: process.env.AI_MODEL || "claude-sonnet-5-5", max_tokens: 6000, system: SYSTEM, messages: [{ role: "user", content: `아래 글에 광고 문구 같은 표현이 남아 있다: ${tells.join(", ")}\n이 표현들을 없애고 사람이 쓴 말투로 다시 써라. 사실·숫자·링크·[사진n] 표시는 하나도 바꾸지 말고, 형식(@@TITLE/@@BODY/@@TAGS)도 그대로.\n\n${text}` }] })
        const t2 = fix.content.map((b: any) => (b.type === "text" ? b.text : "")).join("")
        if (sec(t2, "BODY")) text = t2
      } catch {}
    }
    const post = {
      id: randomUUID(),
      at: now(),
      channel,
      product: String(job.product || "").slice(0, 100),
      title: sec(text, "TITLE").split("\n")[0].slice(0, 200),
      body: sec(text, "BODY").slice(0, 20000),
      tags: sec(text, "TAGS").split(/[,\n]/).map((t) => t.trim().replace(/^#/, "")).filter(Boolean).slice(0, 30),
      photos,
      postedAt: null as string | null,
      url: "",
    }
    if (!post.body) throw new Error("AI 응답을 읽지 못했습니다. 다시 눌러 주세요.")
    const list: any[] = ((await st().get("posts", { type: "json" })) as any[]) || []
    list.unshift(post)
    await st().setJSON("posts", list.slice(0, 200))
    await st().setJSON(key, { running: false, at: now(), postId: post.id })
  } catch (e: any) {
    await st().setJSON(key, { running: false, at: now(), error: String(e?.message || e) })
  }
}
