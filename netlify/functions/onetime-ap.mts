// 임시 (확인 후 삭제): 쿠팡 자동가격조정 상태 확인
import { getStore } from "@netlify/blobs"
import { getProduct } from "./_lib/coupang.mts"
export default async (req: Request) => {
  const u = new URL(req.url), t = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!t || u.searchParams.get("t") !== t) return new Response("no", { status: 404 })
  const s = getStore({ name: "admin-settings", consistency: "strong" })
  const reg: any = (await s.get("lucky-reg", { type: "json" })) || { done: {} }
  const cache: any = (await s.get("coupang-products", { type: "json" })) || {}
  const vend = getStore({ name: "admin-vendors", consistency: "strong" })
  const { blobs } = await vend.list()
  const vs: any[] = (await Promise.all(blobs.map((b) => vend.get(b.key, { type: "json" })))).filter(Boolean)
  const supply = new Map<string, number>(); for (const v of vs) for (const p of v.products || []) if (p.coupangItemId) supply.set(String(p.coupangItemId), Number(p.supplyPrice || 0))
  let ids: string[] = [...new Set([...(Object.values(reg.done) as any[]).filter((d) => d.ok).map((d) => String(d.sellerProductId)), ...(cache.products || []).map((p: any) => String(p.sellerProductId))])]
  if (u.searchParams.get("ids")) ids = u.searchParams.get("ids")!.split(",")
  const from = Number(u.searchParams.get("from") || 0), n = Number(u.searchParams.get("n") || 30)
  const out: any = { total: ids.length, from, rows: [] }
  for (const id of ids.slice(from, from + n)) {
    try {
      const p: any = await getProduct(id)
      const its: any[] = p.items || []
      if (u.searchParams.get("raw") === "1") { out.rows.push({ id, name: p.sellerProductName, keys: Object.keys(its[0] || {}), ap: its[0]?.autoPricingInfoView, sale: its[0]?.salePrice, orig: its[0]?.originalPrice }); continue }
      const on = its.filter((it) => it.autoPricingInfoView?.active)
      out.products = (out.products || 0) + 1; out.items = (out.items || 0) + its.length; out.active = (out.active || 0) + on.length
      for (const it of on) {
        const ap = it.autoPricingInfoView, sup = supply.get(String(it.vendorItemId)) || 0, floor = sup ? Math.ceil(sup / 0.7834 / 100) * 100 : 0
        if (Number(ap.minSalePrice) < Number(it.salePrice)) out.minBelowSale = (out.minBelowSale || 0) + 1
        if (!sup) (out.noSupply = out.noSupply || []).push(`${p.sellerProductName} / ${it.itemName}: 판매 ${it.salePrice} 최저 ${ap.minSalePrice} 설정 ${ap.setPrice}`)
        else if (Number(ap.minSalePrice) < floor) (out.belowFloor = out.belowFloor || []).push(`${p.sellerProductName} / ${it.itemName}: 공급 ${sup} 하한 ${floor} 최저 ${ap.minSalePrice} 판매 ${it.salePrice}`)
        if (Number(it.salePrice) !== Number(it.originalPrice) || (sup && Number(it.salePrice) < floor)) (out.priceMoved = out.priceMoved || []).push(`${p.sellerProductName} / ${it.itemName}: 판매 ${it.salePrice} 정가 ${it.originalPrice} 공급 ${sup}`)
      }
    } catch (e: any) { out.rows.push({ id, error: e.message.slice(0, 120) }) }
  }
  return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json; charset=utf-8" } })
}
