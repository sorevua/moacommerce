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

// ---------- 주문 수집 ----------
const NAVER_COURIER: Record<string, string> = { CJGLS: "CJGLS", HYUNDAI: "LOTTE", HANJIN: "HANJIN", EPOST: "EPOST", KGB: "KGB", KDEXP: "KDEXP", ILYANG: "ILYANG", DAESIN: "DAESIN", CHUNIL: "CHUNIL", HDEXP: "HDEXP" }
const phone = (s: string) => String(s || "").replace(/\s/g, "")

export async function productOrderDetails(ids: string[]) {
  const out: any[] = []
  for (let i = 0; i < ids.length; i += 300) {
    const r = await ncall("POST", "/v1/pay-order/seller/product-orders/query", "", { productOrderIds: ids.slice(i, i + 300) })
    out.push(...(r?.data || []))
  }
  return out
}

export async function syncNaverOrders() {
  const orders = getStore({ name: "admin-orders", consistency: "strong" })
  const vendors = getStore({ name: "admin-vendors", consistency: "strong" })
  const state = tokens()
  const { blobs: vb } = await vendors.list()
  const vlist: any[] = (await Promise.all(vb.map((b) => vendors.get(b.key, { type: "json" })))).filter(Boolean)
  const byItem = new Map<string, { vendorId: string; productName: string }>()
  for (const v of vlist) for (const p of v.products || []) if (p.naverItemId) byItem.set(String(p.naverItemId).trim(), { vendorId: v.id, productName: p.name })

  const ch: any = await changedOrders(25)
  const list: any[] = ch?.data?.lastChangeStatuses || []
  const payed = list.filter((x) => x.productOrderStatus === "PAYED").map((x) => String(x.productOrderId))
  const canceled = list.filter((x) => /CANCEL/.test(String(x.productOrderStatus) + String(x.claimType || ""))).map((x) => String(x.productOrderId))
  let added = 0, flagged = 0
  if (payed.length) {
    const det = await productOrderDetails(payed)
    for (const d of det) {
      const po = d.productOrder || {}, od = d.order || {}, sa = po.shippingAddress || {}
      const key = `naver-${po.productOrderId}`
      const map = byItem.get(String(po.optionCode || "")) || byItem.get(String(po.productId || ""))
      const now = new Date().toISOString()
      const o = {
        id: key, channel: "네이버",
        vendorId: map?.vendorId || "",
        productName: map?.productName || [po.productName, po.productOption].filter(Boolean).join(" / "),
        marketProductName: [po.productName, po.productOption].filter(Boolean).join(" / "),
        qty: Number(po.quantity || 1),
        salePrice: Math.round(Number(po.totalPaymentAmount || 0) / Math.max(1, Number(po.quantity || 1))) || Number(po.unitPrice || 0),
        recipientName: sa.name || "", recipientAddress: [sa.baseAddress, sa.detailedAddress].filter(Boolean).join(" "), recipientZip: sa.zipCode || "",
        recipientPhone: phone(sa.tel1), recipientPhone2: phone(sa.tel2), message: po.shippingMemo || "",
        status: "접수",
        market: { name: "naver", productOrderId: String(po.productOrderId), orderId: String(od.orderId || ""), productId: String(po.productId || ""), optionCode: String(po.optionCode || ""), status: po.productOrderStatus, orderedAt: od.paymentDate || od.orderDate, acknowledged: false, needsMapping: !map },
        createdAt: now, updatedAt: now,
      }
      const { modified } = await orders.setJSON(key, o, { onlyIfNew: true })
      if (modified) added++
    }
  }
  for (const id of canceled) {
    const o: any = await orders.get(`naver-${id}`, { type: "json" })
    if (o && o.status !== "취소" && !o.market?.cancelRequested) { o.market.cancelRequested = true; o.updatedAt = new Date().toISOString(); await orders.setJSON(o.id, o); flagged++ }
  }
  const result = { at: new Date().toISOString(), ok: true, changed: list.length, added, flagged }
  await state.setJSON("naver-sync", result)
  return result
}

// 발주확인 (네이버 '배송준비')
export async function naverConfirm(productOrderIds: string[]) {
  if (!productOrderIds.length) return null
  return ncall("POST", "/v1/pay-order/seller/product-orders/confirm", "", { productOrderIds })
}

// 발송처리 (송장 등록)
export async function naverDispatch(productOrderId: string, courier: string, trackingNumber: string) {
  const code = NAVER_COURIER[courier] || courier
  const dispatchDate = new Date(Date.now() + 9 * 3600e3).toISOString().replace(/\.\d+Z$/, ".000+09:00")
  return ncall("POST", "/v1/pay-order/seller/product-orders/dispatch", "", { dispatchProductOrders: [{ productOrderId, deliveryMethod: "DELIVERY", deliveryCompanyCode: code, trackingNumber, dispatchDate }] })
}
