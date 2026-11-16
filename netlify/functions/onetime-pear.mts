// 임시: 네이버 배 상품 옵션 품절 처리 후 판매 재개 — 작업 후 삭제
import type { Config } from "@netlify/functions"
import { ncall } from "./_lib/naver.mts"
export default async (req: Request) => {
  const u = new URL(req.url)
  const tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || u.searchParams.get("t") !== tok) return new Response("no", { status: 403 })
  const list: any[] = []
  for (let page = 1; page <= 5; page++) {
    const r: any = await ncall("POST", "/v1/products/search", "", { page, size: 50 })
    for (const c of r?.contents || []) for (const ch of c.channelProducts || []) list.push({ no: String(c.originProductNo), name: ch.name, status: ch.statusType, price: ch.salePrice })
    if (!r?.contents?.length || page >= (r.totalPages || 1)) break
  }
  const pears = list.filter((x) => /배/.test(x.name) && !/배송/.test(x.name.replace(/배송/g, "")) || /(^|\s)(배|신고배|나주배|원황|추황)/.test(x.name))
  const out: any = { all: list.map((x) => `${x.no} ${x.status} ${x.name}`), pears: [] }
  const go = u.searchParams.get("go") === "1", only = u.searchParams.get("no")
  for (const p of pears) {
    if (only && p.no !== only) continue
    const g: any = await ncall("GET", `/v2/products/origin-products/${p.no}`)
    const op = g.originProduct, oi = op.detailAttribute.optionInfo || {}
    const combos: any[] = oi.optionCombinations || []
    const hit = (c: any) => { const n = [c.optionName1, c.optionName2, c.optionName3].filter(Boolean).join(" ").replace(/\s/g, "").toLowerCase(); return /특대/.test(n) && (/(^|[^0-9])5kg/.test(n) || /15kg/.test(n)) }
    const info = { no: p.no, name: op.name, status: op.statusType, salePrice: op.salePrice, groups: oi.optionCombinationGroupNames, options: combos.map((c) => ({ id: c.id, name: [c.optionName1, c.optionName2, c.optionName3].filter(Boolean).join(" / "), price: c.price, stock: c.stockQuantity, usable: c.usable, soldout: hit(c) })) }
    out.pears.push(info)
    if (go) {
      for (const c of combos) if (hit(c)) { c.stockQuantity = 0 }
      const left = combos.filter((c) => !hit(c) && c.usable !== false)
      for (const c of left) if (!(Number(c.stockQuantity) > 0)) c.stockQuantity = 100
      op.stockQuantity = combos.reduce((s, c) => s + Number(c.stockQuantity || 0), 0)
      op.statusType = "SALE"
      g.smartstoreChannelProduct.channelProductDisplayStatusType = "ON"
      try { await ncall("PUT", `/v2/products/origin-products/${p.no}`, "", { originProduct: op, smartstoreChannelProduct: g.smartstoreChannelProduct }); (info as any).result = "수정 완료" } catch (e: any) { (info as any).result = String(e?.message || e) }
      const a: any = await ncall("GET", `/v2/products/origin-products/${p.no}`)
      ;(info as any).after = { status: a.originProduct.statusType, options: (a.originProduct.detailAttribute.optionInfo?.optionCombinations || []).map((c: any) => `${[c.optionName1, c.optionName2].filter(Boolean).join(" / ")}: 재고 ${c.stockQuantity}`) }
    }
  }
  return Response.json(out)
}
export const config: Config = { path: "/api/onetime-pear" }
