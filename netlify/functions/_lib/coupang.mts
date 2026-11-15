import { createHmac } from "node:crypto"
import { getStore } from "@netlify/blobs"

// 쿠팡 OPEN API — 고정 IP가 필요해서 Make 웹훅(eu1 고정 송신 IP)을 거쳐 호출한다.
// 서명(HMAC)은 여기서 만들고, Make는 받은 요청을 그대로 전달만 한다.

const HOST = "https://api-gateway.coupang.com"
const ID_FIELDS = "shipmentBoxId|orderId|vendorItemId|productId|sellerProductId|sellerProductItemId|vendorItemPackageId|responseKey|itemId"

export function coupangConfigured() {
  return !!(env("COUPANG_VENDOR_ID") && env("COUPANG_ACCESS_KEY") && env("COUPANG_SECRET_KEY") && env("MAKE_RELAY_URL") && env("MAKE_RELAY_TOKEN"))
}

function env(k: string) {
  return Netlify.env.get(k) || ""
}

export function vendorId() {
  return env("COUPANG_VENDOR_ID")
}

function signedDate() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, "0")
  return `${String(d.getUTCFullYear()).slice(2)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
}

export function authorization(method: string, path: string, query: string) {
  const dt = signedDate()
  const sig = createHmac("sha256", env("COUPANG_SECRET_KEY")).update(dt + method + path + query).digest("hex")
  return `CEA algorithm=HmacSHA256, access-key=${env("COUPANG_ACCESS_KEY")}, signed-date=${dt}, signature=${sig}`
}

// 큰 숫자 ID(묶음배송번호 등)가 자바스크립트 숫자 범위를 넘을 수 있어 문자열로 바꿔 읽는다
export function parseSafe(text: string) {
  return JSON.parse(text.replace(new RegExp(`"(${ID_FIELDS})"\\s*:\\s*(-?\\d+)`, "g"), '"$1":"$2"'))
}

// 요청 본문의 ID를 다시 숫자로 내보낸다
function stringifyWithIds(obj: unknown) {
  return JSON.stringify(obj).replace(new RegExp(`"(${ID_FIELDS})":"(\\d+)"`, "g"), '"$1":$2').replace(/"__num__(\d+)"/g, "$1")
}

export async function call(method: "GET" | "POST" | "PATCH" | "PUT", path: string, query = "", body?: unknown) {
  if (!coupangConfigured()) throw new Error("쿠팡 API 키 또는 중계 설정이 없습니다.")
  const url = HOST + path + (query ? "?" + query : "")
  const payload = {
    token: env("MAKE_RELAY_TOKEN"),
    method,
    url,
    auth: authorization(method, path, query),
    body: body === undefined ? (method === "GET" ? "" : "{}") : stringifyWithIds(body),
  }
  const res = await fetch(env("MAKE_RELAY_URL"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  const upstream = Number(res.headers.get("x-upstream-status") || 0)
  if (!upstream) throw new Error("중계(Make) 응답 오류: " + text.slice(0, 200))
  let data: any = null
  try {
    data = parseSafe(text)
  } catch {
    data = { raw: text.slice(0, 500) }
  }
  if (upstream >= 400) {
    const msg = data?.message || data?.raw || text.slice(0, 200)
    throw new Error(`쿠팡 오류 ${upstream}: ${msg}`)
  }
  return data
}

// ---------- 주문 수집 ----------
const kstDate = (offsetDays: number) => {
  const d = new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400 * 1000)
  return d.toISOString().slice(0, 10)
}

export async function fetchOrdersheets(status: string, fromDays = -3) {
  const path = `/v2/providers/openapi/apis/api/v5/vendors/${vendorId()}/ordersheets`
  const list: any[] = []
  let next = ""
  for (let page = 0; page < 10; page++) {
    const q = [
      `createdAtFrom=${kstDate(fromDays)}%2B09:00`,
      `createdAtTo=${kstDate(0)}%2B09:00`,
      `maxPerPage=50`,
      `status=${status}`,
      ...(next ? [`nextToken=${encodeURIComponent(next)}`] : []),
    ].join("&")
    const data = await call("GET", path, q)
    list.push(...(data?.data || []))
    next = data?.nextToken || ""
    if (!next) break
  }
  return list
}

export function phoneFromE164(v: string | null | undefined) {
  if (!v) return ""
  let s = String(v).replace(/[^\d+]/g, "")
  if (s.startsWith("+82")) s = "0" + s.slice(3)
  if (!/^0\d{8,11}$/.test(s)) return s
  const head = s.startsWith("02") ? 2 : /^050\d/.test(s) && s.length === 12 ? 4 : 3
  const rest = s.slice(head)
  return `${s.slice(0, head)}-${rest.slice(0, rest.length - 4)}-${rest.slice(-4)}`
}

const money = (m: any) => (m && typeof m === "object" ? Number(m.units || 0) : Number(m || 0))

export async function syncCoupangOrders() {
  const orders = getStore({ name: "admin-orders", consistency: "strong" })
  const vendors = getStore({ name: "admin-vendors", consistency: "strong" })
  const state = getStore({ name: "admin-settings", consistency: "strong" })

  // 쿠팡 옵션ID → 업체·상품 매핑
  const { blobs: vb } = await vendors.list()
  const vlist: any[] = (await Promise.all(vb.map((b) => vendors.get(b.key, { type: "json" })))).filter(Boolean)
  const byItem = new Map<string, { vendorId: string; productName: string }>()
  for (const v of vlist) for (const p of v.products || []) if (p.coupangItemId) byItem.set(String(p.coupangItemId).trim(), { vendorId: v.id, productName: p.name })

  const sheets = await fetchOrdersheets("ACCEPT")
  let added = 0
  const seenBoxes = new Set<string>()
  for (const s of sheets) {
    const box = String(s.shipmentBoxId)
    seenBoxes.add(box)
    for (const it of s.orderItems || []) {
      const qty = Number(it.shippingCount || 0) - Number(it.cancelCount || 0) - Number(it.holdCountForCancel || 0)
      if (qty <= 0) continue
      const key = `coupang-${box}-${it.vendorItemId}`
      const map = byItem.get(String(it.vendorItemId))
      const now = new Date().toISOString()
      const o = {
        id: key,
        channel: "쿠팡",
        vendorId: map?.vendorId || "",
        productName: map?.productName || it.vendorItemName || it.sellerProductName || "",
        marketProductName: it.vendorItemName || "",
        qty,
        salePrice: money(it.salesPrice),
        recipientName: s.receiver?.name || "",
        recipientAddress: [s.receiver?.addr1, s.receiver?.addr2].filter(Boolean).join(" "),
        recipientZip: s.receiver?.postCode || "",
        recipientPhone: phoneFromE164(s.receiver?.safeNumber || s.receiver?.receiverNumber),
        recipientPhone2: "",
        message: s.parcelPrintMessage || "",
        status: "접수",
        market: {
          name: "coupang",
          shipmentBoxId: box,
          orderId: String(s.orderId),
          vendorItemId: String(it.vendorItemId),
          status: s.status,
          orderedAt: s.orderedAt,
          acknowledged: false,
          needsMapping: !map,
        },
        createdAt: now,
        updatedAt: now,
      }
      const { modified } = await orders.setJSON(key, o, { onlyIfNew: true })
      if (modified) added++
    }
  }

  // 결제완료 목록에서 사라진 미처리 쿠팡 주문 → 취소 가능성 표시
  const { blobs: ob } = await orders.list({ prefix: "coupang-" })
  let flagged = 0
  for (const b of ob) {
    const o: any = await orders.get(b.key, { type: "json" })
    if (!o || o.status !== "접수" || o.market?.acknowledged) continue
    const gone = !seenBoxes.has(o.market?.shipmentBoxId)
    if (gone !== !!o.market?.missingFromAccept) {
      o.market.missingFromAccept = gone
      o.updatedAt = new Date().toISOString()
      await orders.setJSON(o.id, o)
      if (gone) flagged++
    }
  }

  const result = { at: new Date().toISOString(), ok: true, fetched: sheets.length, added, flagged }
  await state.setJSON("coupang-sync", result)
  return result
}

export async function recordSyncError(err: unknown) {
  const state = getStore({ name: "admin-settings", consistency: "strong" })
  await state.setJSON("coupang-sync", { at: new Date().toISOString(), ok: false, error: String((err as any)?.message || err) })
}

// ---------- 상품준비중 처리 ----------
export async function acknowledge(shipmentBoxIds: string[]) {
  const path = `/v2/providers/openapi/apis/api/v4/vendors/${vendorId()}/ordersheets/acknowledgement`
  const body = { vendorId: vendorId(), shipmentBoxIds: shipmentBoxIds.map((id) => `__num__${id}`) }
  return call("PATCH", path, "", body)
}

// ---------- 송장 업로드 ----------
export async function uploadInvoice(items: { shipmentBoxId: string; orderId: string; vendorItemId: string; courier: string; invoiceNumber: string }[]) {
  const path = `/v2/providers/openapi/apis/api/v4/vendors/${vendorId()}/orders/invoices`
  const body = {
    vendorId: vendorId(),
    orderSheetInvoiceApplyDtos: items.map((i) => ({
      shipmentBoxId: i.shipmentBoxId,
      orderId: i.orderId,
      vendorItemId: i.vendorItemId,
      deliveryCompanyCode: i.courier,
      invoiceNumber: i.invoiceNumber.replace(/\D/g, ""),
      splitShipping: false,
      preSplitShipped: false,
      estimatedShippingDate: "",
    })),
  }
  return call("POST", path, "", body)
}

export const COURIERS: Record<string, string> = {
  CJGLS: "CJ대한통운",
  HYUNDAI: "롯데택배",
  HANJIN: "한진택배",
  EPOST: "우체국",
  KGB: "로젠택배",
  KDEXP: "경동택배",
  ILYANG: "일양택배",
  DAESIN: "대신택배",
  CHUNIL: "천일특송",
  HDEXP: "합동택배",
  DIRECT: "업체직송",
}


// ---------- 상품 ----------
const SP = "/v2/providers/seller_api/apis/api/v1/marketplace"

export async function listProducts(opts: { status?: string; name?: string } = {}) {
  const out: any[] = []
  let next = ""
  for (let page = 0; page < 5; page++) {
    const q = [
      `vendorId=${vendorId()}`,
      `maxPerPage=100`,
      ...(next ? [`nextToken=${encodeURIComponent(next)}`] : []),
      ...(opts.status ? [`status=${opts.status}`] : []),
      ...(opts.name ? [`sellerProductName=${encodeURIComponent(opts.name.slice(0, 20))}`] : []),
    ].join("&")
    const data = await call("GET", `${SP}/seller-products`, q)
    out.push(...(data?.data || []))
    next = data?.nextToken || ""
    if (!next) break
  }
  return out
}

export async function getProduct(sellerProductId: string) {
  const data = await call("GET", `${SP}/seller-products/${sellerProductId}`)
  if (!data?.data) throw new Error("상품을 찾을 수 없습니다: " + (data?.message || ""))
  return data.data
}

export async function productHistory(sellerProductId: string) {
  const h = await call("GET", `${SP}/seller-products/${sellerProductId}/histories`).catch((e: any) => ({ error: String(e?.message || e) }))
  const p = await call("GET", `${SP}/seller-products/${sellerProductId}`).catch((e: any) => ({ error: String(e?.message || e) }))
  return { status: p?.data?.statusName || p?.data?.status || p?.error, history: h?.data ?? h }
}

export async function getInventory(vendorItemId: string) {
  const data = await call("GET", `${SP}/vendor-items/${vendorItemId}/inventories`)
  return data?.data || null
}

export async function changePrice(vendorItemId: string, price: number) {
  return call("PUT", `${SP}/vendor-items/${vendorItemId}/prices/${Math.round(price)}`)
}

export async function stopSale(vendorItemId: string) {
  return call("PUT", `${SP}/vendor-items/${vendorItemId}/sales/stop`)
}

export async function resumeSale(vendorItemId: string) {
  return call("PUT", `${SP}/vendor-items/${vendorItemId}/sales/resume`)
}

// 배송·반품 정보는 손대지 않고, 상품명·검색어·상세페이지만 바꿔서 승인 요청
export async function updateProductContent(sellerProductId: string, change: { displayProductName?: string; sellerProductName?: string; searchTags?: string[]; detailHtml?: string; detailImages?: string[]; mainImages?: Record<string, string> }) {
  const p = await getProduct(sellerProductId)
  if (change.displayProductName) p.displayProductName = change.displayProductName.slice(0, 100)
  if (change.sellerProductName) p.sellerProductName = change.sellerProductName.slice(0, 100)
  for (const it of p.items || []) {
    if (change.searchTags) it.searchTags = cleanTags(change.searchTags)
    // 대표사진 교체 (옵션별). 추가 사진(DETAIL)은 그대로 둔다
    const mi = change.mainImages?.[String(it.vendorItemId)]
    if (mi) it.images = [{ imageOrder: 0, imageType: "REPRESENTATION", vendorPath: mi }, ...(it.images || []).filter((x: any) => x.imageType !== "REPRESENTATION")]
    if (change.detailImages?.length) it.contents = change.detailImages.map((u) => ({ contentsType: "IMAGE_NO_SPACE", contentDetails: [{ content: u, detailType: "IMAGE" }] }))
    else if (change.detailHtml) it.contents = [{ contentsType: "HTML", contentDetails: [{ content: change.detailHtml, detailType: "TEXT" }] }]
  }
  p.requested = true
  return call("PUT", `${SP}/seller-products`, "", p)
}

export function cleanTags(tags: string[]) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of tags) {
    const v = String(t || "").replace(/[^0-9A-Za-z가-힣\s!@#$%^&*\-+;:'.]/g, "").trim().slice(0, 20)
    if (v && !seen.has(v)) { seen.add(v); out.push(v) }
    if (out.length >= 20) break
  }
  return out
}

// 기존 상세 내용에서 이미지 주소와 글을 뽑아낸다 (AI 재작성용)
export function normImg(u: string) {
  u = String(u || "").trim().replace(/&amp;/g, "&")
  if (!u) return ""
  if (u.startsWith("//")) return "https:" + u
  if (/^https?:\/\//i.test(u)) return u.replace(/^http:/i, "https:")
  if (/\.(jpe?g|png|gif|webp)(\?|$)/i.test(u)) return "https://image1.coupangcdn.com/image/" + u.replace(/^\/+/, "")
  return ""
}

// 상품 사진 + 상세페이지 안의 사진(경로만 있는 것, //로 시작하는 것 포함)을 모두 뽑는다
export function extractContent(p: any) {
  const images: string[] = []
  const add = (u: string) => { const n = normImg(u); if (n && !images.includes(n)) images.push(n) }
  const texts: string[] = []
  for (const it of p.items || []) {
    for (const im of it.images || []) add(im.cdnPath || im.vendorPath)
    for (const c of it.contents || []) for (const d of c.contentDetails || []) {
      const content = String(d.content || "")
      if (d.detailType === "IMAGE") { add(content); continue }
      for (const m of content.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) add(m[1])
      const t = content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
      if (t) texts.push(t.slice(0, 1500))
    }
  }
  return { images: images.slice(0, 24), text: texts.join("\n").slice(0, 3000) }
}

// ---------- 새 상품 등록 ----------
export async function predictCategory(productName: string, description = "") {
  const r = await call("POST", "/v2/providers/openapi/apis/api/v1/categorization/predict", "", { productName, productDescription: description })
  return r?.data || null
}
export async function categoryMeta(code: string) {
  const r = await call("GET", `${SP}/meta/category-related-metas/display-category-codes/${code}`)
  return r?.data || null
}
export async function returnCenters() {
  const r = await call("GET", `/v2/providers/openapi/apis/api/v5/vendors/${vendorId()}/returnShippingCenters`, "pageNum=1&pageSize=50")
  return r?.data?.content || r?.data || []
}
export async function outboundPlaces() {
  const r = await call("GET", "/v2/providers/marketplace_openapi/apis/api/v2/vendor/shipping-place/outbound", "pageNum=1&pageSize=50")
  return r?.content || r?.data?.content || r?.data || []
}
// 출고지에 등록된 택배사 코드 (도서산간 배송정보 기준)
export async function outboundCourier(placeCode: string) {
  const list: any[] = await outboundPlaces()
  const pl = list.find((x: any) => String(x.outboundShippingPlaceCode ?? x.shippingPlaceCode) === String(placeCode))
  const infos: any[] = pl?.remoteInfos || []
  const usable = infos.find((r: any) => r.usable !== false) || infos[0]
  return usable?.deliveryCode ? String(usable.deliveryCode) : ""
}
// 상품의 택배사를 출고지 택배사로 맞추고 다시 승인 요청
export async function fixDeliveryCompany(sellerProductId: string) {
  const p = await getProduct(sellerProductId)
  const code = await outboundCourier(p.outboundShippingPlaceCode)
  if (!code) throw new Error("출고지 택배사를 찾지 못했습니다")
  const before = p.deliveryCompanyCode
  p.deliveryCompanyCode = code
  p.requested = true
  const r = await call("PUT", `${SP}/seller-products`, "", p)
  return { before, after: code, result: r }
}
export async function createProduct(body: any) {
  return call("POST", `${SP}/seller-products`, "", body)
}
