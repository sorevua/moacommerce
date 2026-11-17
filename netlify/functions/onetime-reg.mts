// 임시 확인용 (확인 후 삭제)
import { getStore } from "@netlify/blobs"
import { outboundPlaces, returnCenters, getProduct, productHistory } from "./_lib/coupang.mts"
import { internalKey } from "./_lib/auth.mts"
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
  if (act === "start") {
    const ids = (u.searchParams.get("ids") || "").split(",").filter(Boolean)
    const body = { productIds: ids, templateId: "16419735114", outboundShippingPlaceCode: "25572192", returnCenterCode: "1002729419", deliveryCompanyCode: "CJGLS", requestApproval: u.searchParams.get("approve") === "1", once: u.searchParams.get("once") === "1", retry: u.searchParams.get("retry") === "1", shipDays: 3, mode: u.searchParams.get("mode") || "", batch: Number(u.searchParams.get("batch") || 8) }
    const r = await fetch(u.origin + "/.netlify/functions/lucky-register-background", { method: "POST", headers: { "x-internal": internalKey() }, body: JSON.stringify(body) })
    out.started = r.status; out.body = body
  }
  if (act === "check") {
    const id = u.searchParams.get("id") || ""
    try { const p: any = await getProduct(id); out.product = { status: p.statusName, name: p.sellerProductName, brand: p.brand, outbound: p.outboundShippingPlaceCode, ret: p.returnCenterCode, courier: p.deliveryCompanyCode, charge: [p.deliveryChargeType, p.deliveryCharge, p.remoteAreaDeliverable, p.returnCharge, p.deliveryChargeOnReturn], items: (p.items || []).length, item0: { name: p.items?.[0]?.itemName, price: p.items?.[0]?.salePrice, vid: p.items?.[0]?.vendorItemId, ship: p.items?.[0]?.outboundShippingTimeDay, img: p.items?.[0]?.images?.[0], content: JSON.stringify(p.items?.[0]?.contents || []).slice(0, 300) } } } catch (e: any) { out.productError = e.message }
    try { out.history = JSON.stringify(await productHistory(id)).slice(0, 1200) } catch (e: any) { out.historyError = e.message }
  }
  if (act === "status") {
    const st: any = await getStore({ name: "admin-settings", consistency: "strong" }).get("lucky-reg", { type: "json" })
    out.running = st?.running; out.error = st?.error; out.total = st?.total; out.at = st?.at
    const d = Object.values(st?.done || {}) as any[]
    out.ok = d.filter((x) => x.ok).length; out.fail = d.filter((x) => !x.ok).length
    out.linkLeft = st?.linkLeft; out.linked = d.filter((x) => x.linked).length
    out.left = (st?.total || 0) - d.length
    if (u.searchParams.get("brief") === "1") { out.fails = d.filter((x) => !x.ok).map((x) => `${x.name} [${x.tries || 1}]: ${String(x.error).slice(0, 160)}`); return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json; charset=utf-8" } }) }
    out.list = d.map((x) => x.ok ? `OK ${x.name} #${x.sellerProductId} (${x.options?.length}옵션) ${x.cpStatus || ""} 연결 ${x.linkedCount ?? "-"} ${x.shipFix ? "출고일수정:" + x.shipFix : ""} ${x.linkError || ""}` : `FAIL ${x.name}: ${x.error}`)
  }
  if (act === "reset") { const s2 = getStore({ name: "admin-settings", consistency: "strong" }); const st: any = (await s2.get("lucky-reg", { type: "json" })) || { done: {} }; for (const k of Object.keys(st.done)) if (!st.done[k].ok) delete st.done[k]; st.running = false; await s2.setJSON("lucky-reg", st); out.reset = true }
  return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json; charset=utf-8" } })
}
