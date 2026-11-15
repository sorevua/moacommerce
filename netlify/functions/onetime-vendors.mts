// 임시: 키위·귤 업체 정보 채우기 — 실행 후 삭제
import type { Config } from "@netlify/functions"
import { getStore } from "@netlify/blobs"
import { getProduct, outboundPlaces } from "./_lib/coupang.mts"

const st = (n: string) => getStore({ name: n, consistency: "strong" })
const COLS = [
  { header: "받는분 성명", field: "recipientName" },
  { header: "받는분 주소(전체)", field: "recipientAddress" },
  { header: "받는분 전화번호", field: "recipientPhone" },
  { header: "받는분 기타연락처", field: "recipientPhone2" },
  { header: "보내는분 성명", field: "senderName" },
  { header: "보내는분 주소", field: "senderAddress" },
  { header: "보내는분 전화번호", field: "senderPhone" },
  { header: "품목명", field: "itemName" },
  { header: "박스수량", field: "qty" },
  { header: "배송메세지", field: "message" },
]
const KIWI_SUPPLY: Record<string, number> = {
  "골드키위 5kg 특대": 41000, "골드키위 5kg 대과": 39000, "골드키위 5kg 중과": 34000, "골드키위 5kg 소과": 24000,
  "그린키위 5kg 특대": 30000, "그린키위 5kg 대과": 28000, "그린키위 5kg 중과": 26000, "그린키위 5kg 소과": 23000,
}
const phone = (e: string) => String(e || "").replace(/^\+82/, "0").replace(/^0?(10)(\d{4})(\d{4})$/, "0$1-$2-$3")

export default async (req: Request) => {
  const u = new URL(req.url)
  const tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || u.searchParams.get("t") !== tok) return new Response("no", { status: 403 })
  const V = st("admin-vendors"), O = st("admin-orders")
  const out: any = { kiwi: [], jeju: [], orders: 0 }
  const now = new Date().toISOString()

  // 키위
  const kiwiProducts: any[] = []
  for (const id of ["16456111134", "16456110852"]) {
    const p = await getProduct(id)
    for (const it of p.items || []) {
      const name = String(it.itemName)
      kiwiProducts.push({ name, supplyPrice: KIWI_SUPPLY[name] || 0, coupangItemId: String(it.vendorItemId || "") })
    }
  }
  const prev: any = (await V.get("gwangyang-kiwi", { type: "json" })) || {}
  const kiwi = {
    id: "gwangyang-kiwi", name: "광양 키위농가", status: "거래 중",
    products: kiwiProducts,
    order: { method: "카톡 발주서", email: "", cutoff: "", prepay: false, csChannel: "카톡", fixedMessage: "파손주의", columns: COLS },
    sender: { name: "광양 키위농가", phone: "010-8587-0003", zip: "57707", address: "전라남도 광양시 진상면 신시3길 13-23" },
    returnInfo: { sameAsSender: true, name: "", phone: "", zip: "", address: "" },
    extraInfo: "쿠팡 출고지 코드 25735840 · 택배 한진 · 무료배송 · 반품비 편도 5,000원",
    photoIds: prev.photoIds || [], listing: prev.listing || null,
    createdAt: prev.createdAt || now, updatedAt: now,
  }
  await V.setJSON(kiwi.id, kiwi)
  out.kiwi = kiwiProducts

  // 귤 (유라귤)
  const j: any = await V.get("jeju-dameun", { type: "json" })
  if (j) {
    const p = await getProduct("16417633126")
    for (const it of p.items || []) {
      const kg = String(it.itemName).match(/(\d+)\s*kg/i)?.[1]
      const prod = (j.products || []).find((x: any) => kg && new RegExp(`\\b${kg}kg`, "i").test(x.name))
      if (prod) prod.coupangItemId = String(it.vendorItemId)
      out.jeju.push({ option: it.itemName, vendorItemId: it.vendorItemId, matched: prod?.name || null, supply: prod?.supplyPrice ?? null })
    }
    const places: any[] = await outboundPlaces()
    const pl = places.find((x: any) => String(x.outboundShippingPlaceCode) === String(p.outboundShippingPlaceCode))
    const a = pl?.placeAddresses?.[0]
    j.sender = j.sender || {}
    if (!j.sender.name) j.sender.name = pl?.shippingPlaceName || j.name
    if (!j.sender.phone && a?.companyContactNumber) j.sender.phone = phone(a.companyContactNumber)
    out.jejuSender = j.sender
    out.jejuOutbound = { code: p.outboundShippingPlaceCode, name: pl?.shippingPlaceName, addr: a ? `${a.returnAddress} ${a.returnAddressDetail}` : null }
    j.updatedAt = now
    await V.setJSON(j.id, j)
  }

  // 이미 들어온 주문 중 업체 미연결 → 연결
  const map = new Map<string, { vid: string; name: string }>()
  for (const v of [kiwi, j].filter(Boolean)) for (const p of v.products || []) if (p.coupangItemId) map.set(String(p.coupangItemId), { vid: v.id, name: p.name })
  const { blobs } = await O.list()
  for (const b of blobs) {
    const o: any = await O.get(b.key, { type: "json" })
    const m = o?.market?.vendorItemId && map.get(String(o.market.vendorItemId))
    if (m && o.vendorId !== m.vid) { o.vendorId = m.vid; o.productName = m.name; o.market.needsMapping = false; await O.setJSON(o.id, o); out.orders++ }
  }
  return Response.json(out)
}
export const config: Config = { path: "/api/onetime-vendors" }
