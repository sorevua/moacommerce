// 행운프레시 OPEN API — 등록한 고정 IP(Make 중계)를 거쳐 호출한다. (조회 전용: 토큰·잔액·상품)
import { getStore } from "@netlify/blobs"

const HOST = "https://api.luckyfresh.co.kr/api/open/v1"
const env = (k: string) => Netlify.env.get(k) || ""

export function luckyConfigured() {
  return !!(env("LUCKYFRESH_CLIENT_ID") && env("LUCKYFRESH_CLIENT_SECRET") && env("MAKE_RELAY_URL") && env("MAKE_RELAY_TOKEN"))
}

async function relay(method: string, url: string, auth: string, body?: unknown) {
  const res = await fetch(env("MAKE_RELAY_URL"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: env("MAKE_RELAY_TOKEN"), method, url, auth, ctype: "", body: body === undefined ? (method === "GET" ? "" : "{}") : JSON.stringify(body) }),
  })
  const text = await res.text()
  const upstream = Number(res.headers.get("x-upstream-status") || 0)
  if (!upstream) throw new Error("중계(Make) 응답 오류: " + text.slice(0, 200))
  let data: any
  try { data = JSON.parse(text) } catch { data = { raw: text.slice(0, 500) } }
  return { status: upstream, data }
}

const store = () => getStore({ name: "admin-settings", consistency: "strong" })

export async function luckyToken(force = false) {
  if (!force) {
    const t: any = await store().get("lucky-token", { type: "json" })
    if (t?.accessToken && t.expiresAt > Date.now() + 60_000) return t.accessToken as string
  }
  const r = await relay("POST", `${HOST}/auth/token`, "", { clientId: env("LUCKYFRESH_CLIENT_ID").trim(), clientSecret: env("LUCKYFRESH_CLIENT_SECRET").trim() })
  const tok = r.data?.accessToken || r.data?.access_token
  if (r.status >= 400 || !tok) throw new Error(`행운프레시 인증 실패 ${r.status}: ${r.data?.code || ""} ${r.data?.message || r.data?.raw || ""}`.trim())
  const exp = Date.parse(r.data?.expiresAt || "")
  await store().setJSON("lucky-token", { accessToken: tok, expiresAt: exp > Date.now() ? exp : Date.now() + 20 * 3600e3 }) // 설명서: 발급 후 24시간 유효
  return tok as string
}

export async function lcall(method: "GET" | "POST", path: string, query = "", body?: unknown) {
  let tok = await luckyToken()
  const url = HOST + path + (query ? "?" + query : "")
  let r = await relay(method, url, "Bearer " + tok, body)
  if (r.status === 401) { tok = await luckyToken(true); r = await relay(method, url, "Bearer " + tok, body) }
  if (r.status >= 400) throw new Error(`행운프레시 오류 ${r.status}: ${r.data?.code || ""} ${r.data?.message || r.data?.raw || JSON.stringify(r.data).slice(0, 300)}`.trim())
  return r.data
}

export const luckyWallet = () => lcall("GET", "/wallet")

// 상품 전체 (일 48회 제한 → 30분 안에는 저장해 둔 것을 돌려줌)
export async function luckyProducts(force = false) {
  const c: any = await store().get("lucky-products", { type: "json" })
  if (!force && c?.at > Date.now() - 30 * 60e3) return c
  const data = await lcall("GET", "/products")
  const out = { at: Date.now(), data }
  await store().setJSON("lucky-products", out)
  return { ...out, fresh: true }
}

// ---------- 주문 넣기 ----------
// dryRun=true 면 검증·금액 계산·잔액 판정만 하고 아무것도 만들지 않는다.
export async function luckyPlaceOrder(o: any, vendor: any, dryRun: boolean) {
  const prod = (vendor?.products || []).find((x: any) => x.name === o.productName && x.luckyOptionId)
  if (!prod) throw new Error("이 주문의 상품이 행운프레시 옵션과 연결되어 있지 않습니다.")
  const sName = String(vendor?.sender?.name || "").trim(), sPhone = String(vendor?.sender?.phone || "").trim()
  if (!sName || !sPhone) throw new Error("[업체] → 행운프레시에서 '보내는분 이름·전화'를 먼저 넣어 주세요. (송장에 찍힙니다)")
  const zip = String(o.recipientZip || "").replace(/\D/g, "")
  if (zip.length !== 5) throw new Error("받는 분 우편번호(숫자 5자리)가 없습니다. 주문에 우편번호를 넣어 주세요.")
  const body: any = {
    userOrderNumber: String(o.id).slice(0, 100),
    senderName: sName, senderPhone: sPhone,
    customerName: String(o.recipientName || "").trim(), customerPhone: String(o.recipientPhone || "").trim(),
    customerPostalCode: zip, customerAddress: String(o.recipientAddress || "").trim(),
    items: [{ productOptionId: prod.luckyOptionId, quantity: Math.max(1, Number(o.qty || 1)) }],
  }
  if (o.message) body.customerRequest = String(o.message).slice(0, 200)
  if (dryRun) body.dryRun = true
  return lcall("POST", "/orders", "", body)
}

const ymd = (d: Date) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10)
// 최근 7일 주문 라인 (일 50회 제한 → 30분에 한 번만 부른다)
export async function luckyRecentOrders() {
  const to = new Date(), from = new Date(Date.now() - 6 * 86400e3)
  const r: any = await lcall("GET", "/orders", `from=${ymd(from)}&to=${ymd(to)}&pageSize=500`)
  return (r?.orders || []) as any[]
}
export const LUCKY_COURIER: Record<string, string> = { "CJ대한통운": "CJGLS", "대한통운": "CJGLS", "롯데택배": "HYUNDAI", "한진택배": "HANJIN", "우체국": "EPOST", "우체국택배": "EPOST", "로젠택배": "KGB", "경동택배": "KDEXP", "일양택배": "ILYANG", "대신택배": "DAESIN" }
