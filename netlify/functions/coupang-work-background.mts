// 오래 걸리는 작업(쿠팡 상품 전체 새로고침, AI 상세페이지 초안)을 백그라운드로 처리한다.
// 결과는 Blobs(admin-settings)에 저장하고, 관리자 화면이 주기적으로 읽어 간다.
import { getStore } from "@netlify/blobs"
import Anthropic from "@anthropic-ai/sdk"
import { isLoggedIn } from "./_lib/auth.mts"
import { listProducts, getProduct, getInventory, extractContent } from "./_lib/coupang.mts"
import { imageGenConfigured, makeShots, type Shot, type ShotResult } from "./_lib/image-gen.mts"

const store = () => getStore({ name: "admin-settings", consistency: "strong" })
const now = () => new Date().toISOString()

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++
        out[k] = await fn(items[k])
      }
    }),
  )
  return out
}

async function refreshProducts() {
  const prev: any = (await store().get("coupang-products", { type: "json" })) || {}
  await store().setJSON("coupang-products", { ...prev, running: true, startedAt: now(), error: "" })
  try {
    const list = (await listProducts()).filter((p: any) => p.statusName !== "상품삭제" && p.statusName !== "DELETED")
    const rows = await pool(list, 3, async (sp: any) => {
      const id = String(sp.sellerProductId)
      try {
        const p = await getProduct(id)
        const items = await pool(p.items || [], 3, async (it: any) => {
          const vid = it.vendorItemId ? String(it.vendorItemId) : ""
          const inv = vid ? await getInventory(vid).catch(() => null) : null
          return {
            vendorItemId: vid,
            itemName: it.itemName,
            salePrice: inv?.salePrice ?? it.salePrice,
            originalPrice: it.originalPrice,
            onSale: inv ? !!inv.onSale : null,
            stock: inv?.amountInStock ?? it.maximumBuyCount ?? null,
          }
        })
        const tags = [...new Set((p.items || []).flatMap((it: any) => it.searchTags || []))]
        const c = extractContent(p)
        return {
          sellerProductId: id,
          sellerProductName: p.sellerProductName,
          displayProductName: p.displayProductName || "",
          status: sp.statusName,
          createdAt: sp.createdAt,
          searchTags: tags,
          images: c.images,
          detailText: c.text.slice(0, 800),
          delivery: {
            method: p.deliveryMethod,
            chargeType: p.deliveryChargeType,
            charge: p.deliveryCharge,
            returnCharge: p.returnCharge,
          },
          items,
        }
      } catch (e: any) {
        return { sellerProductId: id, sellerProductName: sp.sellerProductName, status: sp.statusName, error: String(e?.message || e), items: [] }
      }
    })
    await store().setJSON("coupang-products", { running: false, at: now(), products: rows, error: "" })
  } catch (e: any) {
    await store().setJSON("coupang-products", { ...prev, running: false, error: String(e?.message || e) })
  }
}

const SYSTEM = `당신은 한국 오픈마켓(쿠팡) 신선식품 상세페이지를 10년 넘게 만든 전문 기획자 겸 카피라이터입니다.
입력으로 상품 정보, 판매자 메모, 그리고 번호가 붙은 실제 사진들을 받습니다. 사진을 직접 보고 분석한 뒤 상세페이지를 설계하세요.

[1단계: 사진 분석]
- 각 사진이 무엇인지(과육 단면, 박스 포장, 농장, 당도계, 글자가 들어간 홍보 이미지 등) 파악한다.
- 사진 안에 박힌 글자·숫자(당도, 중량, 인증, 방송, 순위 등)를 읽는다.
- 사진 속 수치·주장이 판매자 메모와 다르거나 메모에 근거가 없으면 그 사진은 쓰지 않고, 분석에 이유를 적는다. (예: 메모는 16.6 Brix인데 사진에는 13브릭스 문구)
- 흐리거나 중복이거나 상품과 무관한 사진도 제외하고 이유를 적는다.
- 판매자가 추가한 사진(설명 포함)은 반드시 사용하고, 설명 문구를 사진 바로 아래에 넣는다.

[2단계: 구성 — 모바일 구매자가 위에서부터 읽는 순서]
1. 첫 화면: 가장 먹음직스러운 사진 + 한 줄 핵심 문구(무슨 과일인지, 어디 것인지)
2. 핵심 포인트 3가지(짧은 제목 + 한 줄 설명) — 입력에 근거가 있는 것만
3. 근거 섹션: 당도계 사진·방송 출연 등 메모에 있는 사실. 측정값은 "측정 예시"로 쓰고 개체 차이 안내를 붙인다.
4. 상품 사진 섹션: 과육·크기·포장 사진을 설명과 함께
5. 옵션 안내 표(중량별 구성, 어떤 가구에 맞는지)
6. 보관·먹는 방법
7. 배송·교환·반품 안내: 입력의 "배송반품안내"가 있을 때만, 그 내용을 빠짐없이 쉬운 말로 정리한다(표나 아이콘형 카드). 내용을 바꾸거나 없는 조건을 더하지 않는다.
8. 꼭 읽어 주세요: 신선식품 개체 차이, 수령 후 바로 확인 안내
9. 맨 끝 판매자 소개: 입력의 "판매자소개"가 있을 때만, 브랜드명을 크게 두고 소개 문장을 그대로 살려 신뢰감 있게 마무리한다. 소개에 없는 수상·규모·연혁은 만들지 않는다.
섹션 수는 사진과 정보 양에 맞게 조절한다. 정보가 없는 섹션은 만들지 않는다.

[글 규칙]
- 입력(메모·사진 설명·기존 상세글)에 없는 수치, 인증, 수상, 판매량, 후기, 순위는 절대 만들지 않는다.
- "최고", "1위", "100%", "무조건", 질병 예방·치료 등 과장·의학 표현 금지. 방송 프로그램 이름은 메모에 있을 때만 쓴다.
- 판매자 메모의 지시(예: "당도 수치는 쓰지 말 것")가 최우선이다.
- 가격은 쓰지 않는다. 배송·반품은 "배송반품안내"에 있는 내용만 쓴다.
- 문장은 짧게. 초등학생도 이해할 쉬운 말. 한 문단 2문장 이내.

[사진 원칙 — 실제 사진 위주]
- 상세페이지는 실제 사진이 중심이다. 쓸 수 있는 실제 사진은 최대한 쓴다.
- 실제 사진으로 채울 수 없는 꼭 필요한 컷(예: 과육 단면이 전혀 없음, 대표로 쓸 깔끔한 사진이 없음)만 AI 연출 사진을 요청한다. 최대 2장, 필요 없으면 요청하지 않는다.
- 요청은 @@SHOTS 에 "기준사진번호 | 만들 사진 | 이유" 한 줄씩 쓴다. 기준 사진은 그 상품이 가장 잘 보이는 실제 사진 번호.
- HTML에서 첫 번째 요청 사진 자리는 {{G1}}, 두 번째는 {{G2}} 로 쓴다.

[HTML 규칙]
- 이미지 주소를 직접 쓰지 않는다. 실제 사진 n번은 <img src="{{Pn}}"> 처럼 번호 표시만 쓴다(예: {{P1}}, {{P3}}). AI 연출 사진은 {{G1}}, {{G2}}. 다른 주소 금지.
- div, h2, h3, p, ul, li, img, table, tr, td, th, strong, span, br 만 사용. 모든 스타일은 인라인 style. script/iframe/외부 CSS/웹폰트 금지.
- 전체를 <div style="max-width:780px;margin:0 auto;font-family:sans-serif;color:#222;line-height:1.6"> 로 감싼다.
- 모바일 기준: 본문 18px 이상, 섹션 제목 28px 이상 굵게, 이미지는 width:100%, 섹션 사이 여백 56px 이상, 가운데 정렬 위주.
- 포인트 색은 과일에 어울리는 한 가지 색만 쓰고, 배경 띠·둥근 카드·번호 배지로 구획을 나눠 전문 디자이너가 만든 것처럼 정돈한다.

[검색어 규칙]
- 구매자가 실제로 칠 만한 말: 품목명, 품종 다른 이름, 산지, 용도(선물용·가정용), 제철 표현. 다른 브랜드명·무관한 인기어 금지. 20개 이내, 각 20자 이내, 특수문자 없이.

[출력 형식 — 아래 구분선을 그대로 쓰고 다른 말은 쓰지 않는다]
@@TITLE
노출상품명 한 줄 (50자 이내, 품목·산지·특징·중량 위주, 메모에 없는 수치 금지)
@@TAGS
검색어1, 검색어2, ...
@@ANALYSIS
사진별 판단을 한 줄씩 (예: "사진 3: 13브릭스 문구가 있어 제외"), 그리고 판매자가 확인해야 할 점
@@SHOTS
기준사진번호 | 만들 사진 | 이유   (필요 없으면 "없음")
@@HTML
상세페이지 HTML`

function section(text: string, name: string) {
  const m = text.match(new RegExp(`@@${name}\\s*([\\s\\S]*?)(?=\\n@@[A-Z]+\\s|$)`))
  return m ? m[1].trim() : ""
}

async function aiDetail(job: any) {
  const key = `ai-${job.sellerProductId}`
  await store().setJSON(key, { running: true, startedAt: now() })
  try {
    if (!process.env.ANTHROPIC_BASE_URL && !process.env.ANTHROPIC_API_KEY)
      throw new Error("Netlify AI Gateway가 켜져 있지 않습니다. (Netlify 크레딧 요금제에서만 동작)")
    const p = await getProduct(job.sellerProductId)
    const c = extractContent(p)
    const existing: string[] = (Array.isArray(job.images) ? job.images : c.images).filter((u: string) => c.images.includes(u)).slice(0, 10)
    const extras: any[] = (Array.isArray(job.extras) ? job.extras : []).filter((e: any) => /^https:\/\/[^\s"'<>]+\/img\/[a-f0-9-]{36}\.jpg$/.test(String(e?.url || ""))).slice(0, 6)
    const photos = [
      ...extras.map((e) => ({ url: e.url, kind: "판매자가 추가한 사진(반드시 사용)", caption: String(e.caption || "") })),
      ...existing.map((u) => ({ url: u, kind: "기존 등록 사진", caption: "" })),
    ]
    const info = {
      현재상품명: p.displayProductName || p.sellerProductName,
      옵션: (p.items || []).map((it: any) => it.itemName),
      기존상세글: c.text,
      판매자메모: job.notes || "",
      배송반품안내: String(job.shipping || "").slice(0, 2000),
      판매자소개: String(job.brand || "").slice(0, 1000),
    }
    // 사진을 직접 받아 AI에게 보낸다 (쿠팡 CDN을 AI 쪽에서 못 읽는 경우 대비)
    const inline: any[] = await Promise.all(
      photos.map(async (ph) => {
        try {
          const r = await fetch(ph.url, { headers: { "user-agent": "Mozilla/5.0" } })
          const type = (r.headers.get("content-type") || "").split(";")[0]
          if (!r.ok || !/^image\/(jpeg|png|webp|gif)$/.test(type)) return null
          const buf = Buffer.from(await r.arrayBuffer())
          if (buf.byteLength > 4.5 * 1024 * 1024) return null
          return { type: "base64", media_type: type, data: buf.toString("base64") }
        } catch {
          return null
        }
      }),
    )
    const build = (withVision: boolean) => {
      const content: any[] = [{ type: "text", text: "상품 정보:\n" + JSON.stringify(info, null, 1) }]
      photos.forEach((ph, i) => {
        content.push({ type: "text", text: `사진 ${i + 1} {{P${i + 1}}} — ${ph.kind}${ph.caption ? ` / 설명: ${ph.caption}` : ""}` })
        if (withVision) content.push({ type: "image", source: inline[i] || { type: "url", url: ph.url } })
      })
      content.push({
        type: "text",
        text: job.genImages === false || !imageGenConfigured()
          ? "위 사진을 분석하고 출력 형식대로 작성하세요. 이번에는 AI 연출 사진을 만들 수 없으니 @@SHOTS 는 \"없음\"으로 쓰고 {{G1}}·{{G2}}는 쓰지 마세요."
          : "위 사진을 분석하고 출력 형식대로 작성하세요.",
      })
      return content
    }
    const client = new Anthropic()
    const ask = (withVision: boolean) =>
      client.messages.create({
        model: process.env.AI_MODEL || "claude-sonnet-5-5",
        max_tokens: 10000,
        system: SYSTEM,
        messages: [{ role: "user", content: build(withVision) }],
      })
    let msg: any, vision = true
    try {
      msg = await ask(true)
    } catch (e) {
      vision = false
      msg = await ask(false)
    }
    const text = msg.content.map((b: any) => (b.type === "text" ? b.text : "")).join("")
    let html = section(text, "HTML").replace(/^```html?\s*|\s*```$/g, "")
    if (!html) throw new Error("AI 응답을 읽지 못했습니다. 다시 시도해 주세요.")
    const warnings: string[] = []

    // 꼭 필요한 컷만 AI로 생성 → 자동 검수 통과분만 사용
    let shots: ShotResult[] = []
    const wanted: Shot[] = section(text, "SHOTS")
      .split("\n")
      .map((l: string) => l.split("|").map((x) => x.trim()))
      .filter((a: string[]) => a.length >= 2 && /^\d+$/.test(a[0]))
      .map((a: string[]) => ({ base: Number(a[0]), what: a[1], why: a[2] || "" }))
      .slice(0, 2)
    if (wanted.length && job.genImages !== false) {
      if (!imageGenConfigured()) warnings.push("AI가 연출 사진이 필요하다고 판단했지만 OpenAI 키(OPENAI_API_KEY)가 없어 만들지 않았습니다.")
      else shots = await makeShots(wanted, photos.map((p) => p.url), job.origin || "")
    }

    // 번호 표시({{P1}}, {{G1}})를 실제 주소로 바꾸고, 못 바꾼 이미지는 제거
    const urlFor = (tok: string) => {
      const m = tok.match(/^([PG])(\d+)$/)
      if (!m) return ""
      const n = Number(m[2])
      if (m[1] === "P") return photos[n - 1]?.url || ""
      const s = shots[n - 1]
      return s?.ok && s.url ? s.url : ""
    }
    const used = new Set<string>()
    let dropped = 0
    html = html.replace(/<img\b[^>]*>/gi, (tag: string) => {
      const src = (tag.match(/src=["']([^"']+)["']/i) || [])[1] || ""
      const tok = (src.match(/\{\{\s*([PG]\d+)\s*\}\}/) || [])[1] || ""
      let real = tok ? urlFor(tok) : ""
      // 혹시 AI가 실제 주소를 그대로 쓴 경우도 허용
      if (!real && photos.some((p) => p.url === src.replace(/&amp;/g, "&"))) real = src.replace(/&amp;/g, "&")
      if (!real) {
        dropped++
        return ""
      }
      used.add(real)
      const isAi = tok.startsWith("G")
      const fixed = tag.replace(src, () => real).replace(/<img/i, '<img referrerpolicy="no-referrer"')
      return isAi
        ? fixed + '<p style="font-size:12px;color:#999;margin:4px 0 0;text-align:center">연출 이미지입니다. 실제 상품은 위 실사진을 참고해 주세요.</p>'
        : fixed
    })
    html = html.replace(/\{\{\s*[PG]\d+\s*\}\}/g, "")

    // 안전장치: 실제 사진이 하나도 안 들어갔으면 고른 사진을 아래에 모두 붙인다
    const realUsed = photos.filter((p) => used.has(p.url)).length
    if (photos.length && realUsed === 0) {
      const gallery = photos
        .map(
          (p) =>
            `<img src="${p.url}" referrerpolicy="no-referrer" style="width:100%;display:block;margin:0 0 12px">` +
            (p.caption ? `<p style="font-size:16px;color:#555;text-align:center;margin:0 0 24px">${p.caption.replace(/[<>&"]/g, "")}</p>` : ""),
        )
        .join("")
      html = html.replace(/<\/div>\s*$/, `<div style="margin-top:56px">${gallery}</div></div>`)
      if (!/<\/div>\s*$/.test(html)) html += gallery
      warnings.push("AI가 실제 사진을 하나도 넣지 않아, 고른 사진을 상세페이지 아래에 모두 붙였습니다.")
    }
    const unusedReal = photos.map((p, i) => (used.has(p.url) ? 0 : i + 1)).filter(Boolean)
    if (realUsed && unusedReal.length) warnings.push(`사진 ${unusedReal.join(", ")}번은 상세페이지에 쓰이지 않았습니다. 이유는 아래 AI 사진 분석을 보세요.`)
    for (const s of shots) {
      if (s.ok) warnings.push(`AI 연출 사진 "${s.what}" 추가 (검수 ${s.score}/10 통과). 네이버 신선식품에는 AI 생성 이미지를 쓰지 마세요.`)
      else warnings.push(`AI 연출 사진 "${s.what}"은 품질 기준 미달로 넣지 않았습니다${s.error ? ` (${s.error})` : ""}.`)
    }

    // 입력에 없는 당도 수치가 들어갔는지 점검
    const source = JSON.stringify(info) + extras.map((e) => e.caption).join(" ")
    const plain = html.replace(/<[^>]+>/g, " ")
    for (const m of plain.matchAll(/(\d+(?:\.\d+)?)\s*(?:brix|브릭스)/gi)) {
      if (!source.includes(m[1])) warnings.push(`상세글에 메모에 없는 당도 수치 ${m[1]}가 있습니다. 확인하세요.`)
    }
    for (const e of extras) if (!html.includes(e.url)) warnings.push("추가한 사진 중 상세페이지에 들어가지 않은 것이 있습니다.")
    if (!vision) warnings.push("사진을 직접 보지 못하고 글만으로 작성했습니다. 사진 속 문구(예: 13브릭스)는 직접 확인하세요.")
    if (dropped) warnings.push(`주소를 알 수 없는 이미지 ${dropped}개를 제거했습니다.`)
    await store().setJSON(key, {
      running: false,
      at: now(),
      title: section(text, "TITLE").split("\n")[0] || "",
      tags: section(text, "TAGS").split(/[,\n]/).map((t: string) => t.trim()).filter(Boolean),
      analysis: section(text, "ANALYSIS"),
      warnings: [...new Set(warnings)],
      html,
      vision,
      shots,
    })
  } catch (e: any) {
    await store().setJSON(key, { running: false, at: now(), error: String(e?.message || e) })
  }
}

export default async (req: Request) => {
  if (!isLoggedIn(req)) return
  const job = await req.json().catch(() => ({}))
  if (job.type === "refresh") await refreshProducts()
  if (job.type === "ai" && job.sellerProductId) await aiDetail({ ...job, origin: new URL(req.url).origin })
}
