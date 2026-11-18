// 고객 문의: 쿠팡·네이버에서 모으고, AI 답변 초안을 만들고, 승인하면 마켓에 등록한다
import { getStore } from "@netlify/blobs"
import { putIfNew } from "./blob-put.mts"
import Anthropic from "@anthropic-ai/sdk"
import { aiCreate } from "./ai.mts"
import { HUMAN_RULES } from "./human.mts"
import { call, coupangConfigured, vendorId } from "./coupang.mts"
import { ncall, naverConfigured } from "./naver.mts"

const st = () => getStore({ name: "admin-inquiries", consistency: "strong" })
const settings = () => getStore({ name: "admin-settings", consistency: "strong" })
const env = (k: string) => Netlify.env.get(k) || ""
const kst = (d: Date) => new Date(d.getTime() + 9 * 3600e3)
const ymd = (d: Date) => kst(d).toISOString().slice(0, 10)
const isoK = (d: Date) => kst(d).toISOString().replace(/\.\d+Z$/, ".000+09:00")

type Inq = { id: string; channel: "쿠팡" | "네이버"; kind: string; marketId: string; product: string; question: string; askedAt: string; draft?: string; check?: string; status: "대기" | "답변완료" | "건너뜀"; answer?: string; answeredAt?: string; error?: string; createdAt: string }

async function fetchCoupang(): Promise<Partial<Inq>[]> {
  const out: Partial<Inq>[] = []
  const q = `vendorId=${vendorId()}&answeredType=NOANSWER&inquiryStartAt=${ymd(new Date(Date.now() - 6 * 864e5))}&inquiryEndAt=${ymd(new Date())}&pageSize=50&pageNum=1`
  let r: any, err = ""
  for (const v of ["v5", "v4"]) {
    try { r = await call("GET", `/v2/providers/openapi/apis/api/${v}/vendors/${vendorId()}/onlineInquiries`, q); break } catch (e: any) { err = String(e?.message || e) }
  }
  if (!r) throw new Error("쿠팡 문의 조회 실패: " + err)
  for (const x of r?.data?.content || r?.data || []) {
    if ((x.commentDtoList || []).length) continue
    out.push({ channel: "쿠팡", kind: "상품문의", marketId: String(x.inquiryId), product: String(x.sellerProductName || x.productName || x.sellerProductId || x.productId || ""), question: String(x.content || ""), askedAt: String(x.inquiryAt || "") })
  }
  return out
}

async function fetchNaver(): Promise<Partial<Inq>[]> {
  const out: Partial<Inq>[] = []
  const from = new Date(Date.now() - 14 * 864e5), to = new Date()
  const errs: string[] = []
  try {
    const r: any = await ncall("GET", "/v1/contents/qnas", `page=1&size=100&answered=false&fromDate=${encodeURIComponent(isoK(from))}&toDate=${encodeURIComponent(isoK(to))}`)
    for (const x of r?.contents || []) if (!x.answered) out.push({ channel: "네이버", kind: "상품문의", marketId: String(x.questionId), product: String(x.productName || x.productId || ""), question: String(x.question || ""), askedAt: String(x.createDate || "") })
  } catch (e: any) { errs.push("상품문의: " + String(e?.message || e)) }
  try {
    const r: any = await ncall("GET", "/v1/pay-user/inquiries", `page=1&size=100&answered=false&startSearchDate=${ymd(from)}&endSearchDate=${ymd(to)}`)
    for (const x of r?.content || r?.contents || []) if (!x.answered) out.push({ channel: "네이버", kind: "고객문의", marketId: String(x.inquiryNo), product: String(x.productName || ""), question: [x.title, x.inquiryContent].filter(Boolean).join("\n"), askedAt: String(x.inquiryRegistrationDateTime || "") })
  } catch (e: any) { errs.push("고객문의: " + String(e?.message || e)) }
  if (errs.length && !out.length) throw new Error("네이버 " + errs.join(" / "))
  return out
}

const SYSTEM = `당신은 과일 산지직송 판매자의 고객 문의 답변 담당자입니다.
규칙:
- 아래 "판매자 정책·사실"에 있는 내용만으로 답한다. 없는 내용(배송 날짜 확정, 당도 보장, 환불 약속 등)은 지어내지 않는다.
- 정책·사실로 답할 수 없는 부분은 "확인 후 다시 안내드리겠습니다"라고 쓰고, CHECK에 판매자가 확인할 것을 적는다.
- 3~6문장. 인사 한 줄 → 답 → 마무리 한 줄. 고객이 쓴 말을 길게 되풀이하지 않는다.
- 전화번호·카카오톡·외부 링크·다른 판매처 안내 금지(마켓 규정).
- 불만·파손 문의는 먼저 사과하고, 사진을 문의에 첨부해 달라고 안내한다.
${HUMAN_RULES}
출력 형식(다른 말 없이):
@@ANSWER
답변
@@CHECK
판매자가 확인할 것 (없으면 "없음")`

async function draft(client: any, q: Inq, policy: string) {
  const msg: any = await aiCreate(client, { model: process.env.AI_MODEL || "claude-sonnet-5-5", max_tokens: 1200, system: SYSTEM, messages: [{ role: "user", content: `판매자 정책·사실:\n${policy}\n\n마켓: ${q.channel}\n상품: ${q.product}\n고객 문의:\n${q.question}` }] })
  const text = msg.content.map((b: any) => (b.type === "text" ? b.text : "")).join("")
  const sec = (n: string) => (text.match(new RegExp(`@@${n}\\s*([\\s\\S]*?)(?=\\n@@[A-Z]+\\s|$)`)) || [])[1]?.trim() || ""
  const chk = sec("CHECK")
  return { draft: sec("ANSWER") || text.trim(), check: /^없음\.?$/.test(chk) ? "" : chk }
}

export async function syncInquiries() {
  const result: any = { at: new Date().toISOString(), added: 0, drafted: 0, errors: [] as string[] }
  const found: Partial<Inq>[] = []
  if (coupangConfigured()) { try { found.push(...(await fetchCoupang())) } catch (e: any) { result.errors.push(String(e?.message || e).slice(0, 300)) } }
  if (naverConfigured()) { try { found.push(...(await fetchNaver())) } catch (e: any) { result.errors.push(String(e?.message || e).slice(0, 300)) } }
  const now = new Date().toISOString()
  for (const f of found) {
    const id = `${f.channel === "쿠팡" ? "cp" : "nv"}-${f.kind === "고객문의" ? "c" : "q"}-${f.marketId}`
    if (await putIfNew(st(), id, { ...f, id, status: "대기", createdAt: now })) result.added++ // 2026-11-18: 새 문의만 저장 (blob-put.mts)
  }
  // 초안이 없는 대기 문의에 AI 답변 초안 작성
  const copy: any = (await settings().get("cp-copy", { type: "json" })) || {}
  const policy = [copy.shipping && `[배송·교환·반품]\n${copy.shipping}`, copy.facts && `[공통 사실]\n${copy.facts}`, ...Object.values(copy.guides || {}).slice(0, 3).map((g: any) => `[보관·손질 안내]\n${String(g).slice(0, 800)}`)].filter(Boolean).join("\n\n") || "무료배송. 신선식품 특성상 단순 변심 반품은 어렵습니다. 반품 배송비 편도 5,000원."
  const { blobs } = await st().list()
  const client = new Anthropic()
  for (const b of blobs) {
    const q: any = await st().get(b.key, { type: "json" })
    if (!q || q.status !== "대기" || q.draft) continue
    try { Object.assign(q, await draft(client, q, policy)); await st().setJSON(q.id, q); result.drafted++ } catch (e: any) { result.errors.push("초안: " + String(e?.message || e).slice(0, 200)); break }
  }
  await settings().setJSON("inquiry-sync", result)
  return result
}

export async function listInquiries() {
  const { blobs } = await st().list()
  const list = (await Promise.all(blobs.map((b) => st().get(b.key, { type: "json" })))).filter(Boolean) as Inq[]
  return { last: await settings().get("inquiry-sync", { type: "json" }), list: list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 200) }
}

export async function answerInquiry(id: string, answer: string) {
  const q: any = await st().get(id, { type: "json" })
  if (!q) throw new Error("문의를 찾을 수 없습니다.")
  const text = String(answer || "").trim()
  if (text.length < 5) throw new Error("답변 내용이 너무 짧습니다.")
  if (/01[016789][-\s]?\d{3,4}[-\s]?\d{4}|open\.kakao|pf\.kakao|https?:\/\//i.test(text)) throw new Error("답변에 전화번호·카카오톡·링크는 넣을 수 없습니다(마켓 규정).")
  if (q.channel === "쿠팡") {
    const replyBy = env("COUPANG_WING_ID")
    if (!replyBy) throw new Error("쿠팡 답변에는 WING 로그인 아이디가 필요합니다. Netlify 환경변수 COUPANG_WING_ID에 넣어 주세요.")
    await call("POST", `/v2/providers/openapi/apis/api/v4/vendors/${vendorId()}/onlineInquiries/${q.marketId}/replies`, "", { content: text, vendorId: vendorId(), replyBy })
  } else if (q.kind === "고객문의") {
    await ncall("POST", `/v1/pay-merchant/inquiries/${q.marketId}/answer`, "", { answerComment: text })
  } else {
    await ncall("PUT", `/v1/contents/qnas/${q.marketId}`, "", { commentContent: text })
  }
  Object.assign(q, { status: "답변완료", answer: text, answeredAt: new Date().toISOString(), error: "" })
  await st().setJSON(id, q)
  return q
}

export async function skipInquiry(id: string) {
  const q: any = await st().get(id, { type: "json" })
  if (!q) throw new Error("문의를 찾을 수 없습니다.")
  q.status = "건너뜀"; await st().setJSON(id, q); return q
}
