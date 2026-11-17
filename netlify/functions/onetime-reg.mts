// 임시 확인용 (확인 후 삭제)
import { getStore } from "@netlify/blobs"
import { outboundPlaces, returnCenters } from "./_lib/coupang.mts"
export default async (req: Request) => {
  const u = new URL(req.url), t = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!t || u.searchParams.get("t") !== t) return new Response("no", { status: 404 })
  const out: any = {}
  const act = u.searchParams.get("a") || "probe"
  if (act === "probe") {
    try { out.outbound = (await outboundPlaces()).map((p: any) => ({ code: p.outboundShippingPlaceCode, name: p.shippingPlaceName, usable: p.usable, addr: (p.placeAddresses || []).map((a: any) => `${a.addressType}:${a.returnZipCode} ${a.returnAddress} ${a.returnAddressDetail} tel:${a.companyContactNumber}`), remote: (p.remoteInfos || []).map((r: any) => `${r.deliveryCode}/jeju${r.jeju}/etc${r.notJeju}/${r.usable}`) })) } catch (e: any) { out.outboundError = e.message }
    try { out.returns = (await returnCenters()).map((p: any) => ({ code: p.returnCenterCode, name: p.shippingPlaceName, usable: p.usable, addr: (p.placeAddresses || []).map((a: any) => `${a.returnZipCode} ${a.returnAddress} ${a.returnAddressDetail} tel:${a.companyContactNumber}`), courier: p.deliverCode, fee: [p.returnFee05kg, p.returnFee10kg, p.returnFee20kg] })) } catch (e: any) { out.returnsError = e.message }
    const c: any = await getStore({ name: "admin-settings", consistency: "strong" }).get("coupang-products", { type: "json" })
    out.products = (c?.products || []).map((p: any) => ({ id: p.sellerProductId, name: p.sellerProductName, status: p.status, items: (p.items || []).length, delivery: p.delivery }))
    const s: any = await getStore({ name: "admin-settings", consistency: "strong" }).get("settings", { type: "json" })
    out.settings = s
  }
  return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json; charset=utf-8" } })
}
