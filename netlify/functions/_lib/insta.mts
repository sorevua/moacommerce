// 인스타그램 자동화: 매일 게시물 초안(실제 상품 사진 + 사람 말투 글)을 만들고, 예약 시간에 자동 게시한다
import { getStore } from "@netlify/blobs"
import Anthropic from "@anthropic-ai/sdk"
import { randomUUID } from "node:crypto"
import { aiCreate } from "./ai.mts"
import { HUMAN_RULES, aiTells } from "./human.mts"
import { getProduct, normImg, coupangConfigured } from "./coupang.mts"

const P = () => getStore({ name: "admin-promo", consistency: "strong" })
const S = () => getStore({ name: "admin-settings", consistency: "strong" })
const env = (k: string) => Netlify.env.get(k) || ""
const SITE = () => env("URL") || "https://volqavo.com"
export const IG_DEFAULT = { daily: true, autoPublish: true, hour: 19 }
export async function igConfig() { return { ...IG_DEFAULT, ...(((await P().get("ig-config", { type: "json" })) as any) || {}), connected: !!env("MAKE_IG_URL") } }

// 인스타는 공개 JPEG 주소가 필요 → Netlify 이미지 서버로 1080 정사각 JPEG 변환
const igImg = (u: string) => `${SITE()}/.netlify/images?url=${encodeURIComponent(u)}&w=1080&h=1080&fit=cover&fm=jpg&q=88`

const ANGLES = ["사진에 보이는 장면 하나를 골라 이야기", "크기·당도처럼 사람들이 제일 궁금해하는 것 하나", "보관하는 법이나 맛있게 먹는 법 한 가지", "산지 농가 이야기 (사진에 보이는 것만)", "선물로 보낼 때 좋은 점", "솔직한 단점 하나와 그래도 권하는 이유"]

export async function makeDailyDraft(force = false) {
  const cfg = await igConfig()
  if (!cfg.daily && !force) return { skipped: "매일 만들기 꺼짐" }
  if (!coupangConfigured()) return { skipped: "쿠팡 미연결" }
  const list: any[] = ((await P().get("posts", { type: "json" })) as any[]) || []
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)
  if (!force && list.some((x) => x.auto && x.channel === "instagram" && String(x.day) === today)) return { skipped: "오늘 것은 이미 있음" }
  const cp: any = (await S().get("coupang-products", { type: "json" })) || {}
  const onSale = (cp.products || []).filter((p: any) => (p.items || []).some((i: any) => i.onSale))
  if (!onSale.length) return { skipped: "판매 중인 상품 없음" }
  const st: any = (await P().get("ig-state", { type: "json" })) || { n: 0 }
  const prod = onSale[st.n % onSale.length], angle = ANGLES[Math.floor(st.n / onSale.length) % ANGLES.length]
  const full: any = await getProduct(String(prod.sellerProductId))
  const imgs: string[] = []
  // 대표사진은 AI로 만든 것일 수 있어 빼고, 실제 사진(추가 사진)만 쓴다
  for (const it of full.items || []) for (const im of it.images || []) { if (im.imageType === "REPRESENTATION") continue; const u = normImg(im.cdnPath || im.vendorPath); if (u && !imgs.includes(u)) imgs.push(u) }
  // 매번 다른 사진부터 쓰도록 돌려 가며 고른다 (최대 4장)
  const start = st.n % Math.max(1, imgs.length)
  const pick = [...imgs.slice(start), ...imgs.slice(0, start)].slice(0, 4)
  if (!pick.length) return { skipped: "사진 없음" }
  const copy: any = (await S().get("cp-copy", { type: "json" })) || {}
  const settings: any = (await P().get("settings", { type: "json" })) || {}
  const spid = String(prod.sellerProductId)
  const facts = [copy.notes?.[spid], copy.facts, copy.guides?.[spid] && `보관·손질: ${String(copy.guides[spid]).slice(0, 500)}`].filter(Boolean).join("\n") || "(없음)"
  const content: any[] = [{ type: "text", text: `상품: ${full.displayProductName || full.sellerProductName}\n옵션: ${(prod.items || []).filter((i: any) => i.onSale).map((i: any) => i.itemName).join(", ")}\n판매자가 확인한 사실:\n${facts}\n오늘 글의 소재: ${angle}\n구매 안내: 쿠팡·네이버에서 "${settings.brand || "모아커머스"}" 검색${settings.openchat ? ` 또는 오픈채팅 ${settings.openchat}` : ""}${settings.voice ? `\n\n판매자 말투 샘플(말투만 참고):\n${settings.voice}` : ""}` }]
  for (let i = 0; i < pick.length; i++) {
    try { const r = await fetch(`${SITE()}/.netlify/images?url=${encodeURIComponent(pick[i])}&w=768&fm=jpg&q=75`); if (!r.ok) continue; content.push({ type: "text", text: `[사진${i + 1}]` }, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: Buffer.from(await r.arrayBuffer()).toString("base64") } }) } catch {}
  }
  const system = `과일 산지직송 판매자의 인스타그램 게시글을 씁니다.
- 판매자가 확인한 사실과 사진에 보이는 것만 쓴다. 없는 당도·수상·후기·판매량·효능은 만들지 않는다. 측정값은 "측정 예시"로.
- 판매자가 하지 않은 행동을 지어내지 않는다: "오늘 상자를 열었다", "잘라 봤다", "먹어 봤다", "방금 들어왔다" 같은 말은 판매자가 확인한 사실에 있을 때만 쓴다. 사진에 없는 장면(과일 단면, 포장 상자 등)을 본 것처럼 쓰지 않는다.
- 가격은 쓰지 않는다(자주 바뀜). 무료배송 같은 조건은 사실에 있을 때만.
- 첫 줄은 눈길 가는 한 문장(25자 이내). 본문 250~500자, 짧은 줄. 마지막 줄에 구매 안내 한 줄.
- 해시태그 10~15개는 @@TAGS에만.
${HUMAN_RULES}
출력 형식(다른 말 없이):
@@BODY
본문
@@TAGS
태그1, 태그2`
  const client = new Anthropic()
  const ask = async (msgs: any[]) => { const m: any = await aiCreate(client, { model: process.env.AI_MODEL || "claude-sonnet-5-5", max_tokens: 2000, system, messages: msgs }); return m.content.map((b: any) => (b.type === "text" ? b.text : "")).join("") }
  const sec = (t: string, n: string) => (t.match(new RegExp(`@@${n}\\s*([\\s\\S]*?)(?=\\n@@[A-Z]+\\s|$)`)) || [])[1]?.trim() || ""
  let text = await ask([{ role: "user", content }])
  const tells = aiTells(text)
  if (tells.length) { try { const t2 = await ask([{ role: "user", content }, { role: "assistant", content: text }, { role: "user", content: `광고 문구 같은 표현이 남았다: ${tells.join(", ")}. 이 표현을 없애고 사실은 그대로 둔 채 같은 형식으로 다시 써라.` }]); if (sec(t2, "BODY")) text = t2 } catch {} }
  const body = sec(text, "BODY")
  if (!body) throw new Error("AI 응답을 읽지 못했습니다.")
  const when = new Date(`${today}T${String(cfg.hour).padStart(2, "0")}:00:00+09:00`)
  const post = { id: randomUUID(), at: new Date().toISOString(), channel: "instagram", product: String(full.displayProductName || "").slice(0, 100), title: body.split("\n")[0].slice(0, 200), body, tags: sec(text, "TAGS").split(/[,\n]/).map((t) => t.trim().replace(/^#/, "")).filter(Boolean).slice(0, 20), photos: pick.map(igImg), postedAt: null as string | null, url: "", auto: true, day: today, scheduleAt: (when.getTime() > Date.now() ? when : new Date(Date.now() + 3600e3)).toISOString(), hold: !cfg.autoPublish }
  const cur: any[] = ((await P().get("posts", { type: "json" })) as any[]) || []
  cur.unshift(post)
  await P().setJSON("posts", cur.slice(0, 200))
  await P().setJSON("ig-state", { n: st.n + 1 })
  return { made: post.id, product: post.product, scheduleAt: post.scheduleAt }
}

// 예약 시간이 된 게시물을 인스타그램에 올린다 (Make 연결이 있어야 함)
export async function publishDue() {
  const hook = env("MAKE_IG_URL")
  if (!hook) return { skipped: "인스타 연결 전" }
  const list: any[] = ((await P().get("posts", { type: "json" })) as any[]) || []
  const due = list.filter((x) => x.channel === "instagram" && x.scheduleAt && !x.postedAt && !x.hold && !x.failed && new Date(x.scheduleAt).getTime() <= Date.now())
  const out: any[] = []
  for (const p of due.slice(0, 2)) {
    const caption = [p.body, (p.tags || []).map((t: string) => "#" + t).join(" ")].filter(Boolean).join("\n\n").slice(0, 2150)
    try {
      const r = await fetch(hook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: env("MAKE_RELAY_TOKEN"), images: (p.photos || []).slice(0, 10), image: p.photos?.[0], caption }) })
      const t = await r.text()
      if (!r.ok || /error|fail/i.test(t.slice(0, 200)) && !/"id"/.test(t)) throw new Error(t.slice(0, 200))
      p.postedAt = new Date().toISOString(); p.igResult = t.slice(0, 200); out.push({ id: p.id, ok: true })
    } catch (e: any) { p.failed = String(e?.message || e).slice(0, 200); out.push({ id: p.id, error: p.failed }) }
  }
  if (due.length) await P().setJSON("posts", list)
  return { published: out }
}
