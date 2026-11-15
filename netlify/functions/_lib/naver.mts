// 네이버 커머스API — 등록한 고정 IP(Make 중계)를 거쳐 호출한다.
import bcrypt from "bcryptjs"
import { getStore } from "@netlify/blobs"

const HOST = "https://api.commerce.naver.com/external"
const env = (k: string) => Netlify.env.get(k) || ""

export function naverConfigured() {
  return !!(env("NAVER_CLIENT_ID") && env("NAVER_CLIENT_SECRET") && env("MAKE_RELAY_URL") && env("MAKE_RELAY_TOKEN"))
}

async function relay(method: string, url: string, auth: string, body: unknown, ctype = "") {
  const res = await fetch(env("MAKE_RELAY_URL"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: env("MAKE_RELAY_TOKEN"), method, url, auth, ctype, body: typeof body === "string" ? body : body === undefined ? (method === "GET" ? "" : "{}") : JSON.stringify(body) }),
  })
  const text = await res.text()
  const upstream = Number(res.headers.get("x-upstream-status") || 0)
  if (!upstream) throw new Error("중계(Make) 응답 오류: " + text.slice(0, 200))
  let data: any
  try { data = JSON.parse(text) } catch { data = { raw: text.slice(0, 500) } }
  return { status: upstream, data }
}

const tokens = () => getStore({ name: "admin-settings", consistency: "strong" })

export async function naverToken(force = false) {
  if (!force) {
    const t: any = await tokens().get("naver-token", { type: "json" })
    if (t?.access_token && t.expiresAt > Date.now() + 60_000) return t.access_token as string
  }
  const id = env("NAVER_CLIENT_ID"), secret = env("NAVER_CLIENT_SECRET")
  const ts = Date.now()
  const sign = Buffer.from(bcrypt.hashSync(`${id}_${ts}`, secret), "utf-8").toString("base64")
  const q = new URLSearchParams({ client_id: id, timestamp: String(ts), client_secret_sign: sign, grant_type: "client_credentials", type: "SELF" })
  const r = await relay("POST", `${HOST}/v1/oauth2/token`, "", q.toString(), "application/x-www-form-urlencoded")
  if (r.status >= 400 || !r.data?.access_token) throw new Error(`네이버 인증 실패 ${r.status}: ${r.data?.message || r.data?.raw || JSON.stringify(r.data).slice(0, 300)}`)
  await tokens().setJSON("naver-token", { access_token: r.data.access_token, expiresAt: Date.now() + Number(r.data.expires_in || 3600) * 1000 })
  return r.data.access_token as string
}

export async function ncall(method: "GET" | "POST" | "PUT" | "PATCH", path: string, query = "", body?: unknown) {
  let tok = await naverToken()
  const url = HOST + path + (query ? "?" + query : "")
  let r = await relay(method, url, "Bearer " + tok, body)
  if (r.status === 401) { tok = await naverToken(true); r = await relay(method, url, "Bearer " + tok, body) }
  if (r.status >= 400) throw new Error(`네이버 오류 ${r.status}: ${r.data?.message || r.data?.raw || JSON.stringify(r.data).slice(0, 300)}`)
  return r.data
}

// 최근 변경된 주문 (기본 24시간)
export async function changedOrders(hours = 24) {
  const from = new Date(Date.now() - hours * 3600e3 + 9 * 3600e3).toISOString().replace("Z", "+09:00")
  return ncall("GET", "/v1/pay-order/seller/product-orders/last-changed-statuses", `lastChangedFrom=${encodeURIComponent(from)}`)
}
