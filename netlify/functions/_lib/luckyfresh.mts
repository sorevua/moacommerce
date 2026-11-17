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
  const sec = Number(r.data?.expiresIn || r.data?.expires_in || 0)
  await store().setJSON("lucky-token", { accessToken: tok, expiresAt: Date.now() + (sec > 0 ? sec * 1000 : 20 * 3600e3) }) // 설명서: 24시간마다 재발급
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
  return out
}
