// 임시: 네이버 "주요정보 검토필요" 원인 조사. 작업이 끝나면 지운다.
import { ncall } from "./_lib/naver.mts"
export default async (req: Request) => {
  const u = new URL(req.url)
  const t = u.searchParams.get("t") || "", tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || t !== tok) return new Response("no", { status: 404 })
  const a = u.searchParams.get("a") || ""
  const out: any = {}
  try {
    if (a === "list") {
      const r: any = await ncall("POST", "/v1/products/search", "", { page: 1, size: 50 })
      out.items = (r.contents || []).map((c: any) => ({ o: c.originProductNo, ch: (c.channelProducts || []).map((x: any) => ({ no: x.channelProductNo, name: x.name, st: x.statusType, cat: x.categoryId, disp: x.channelProductDisplayStatusType })) }))
    }
    if (a === "get") {
      const p: any = await ncall("GET", "/v2/products/origin-products/" + u.searchParams.get("o"))
      const op = p.originProduct || {}, d = op.detailAttribute || {}
      out.name = op.name; out.cat = op.leafCategoryId
      out.search = d.naverShoppingSearchInfo; out.attrs = d.productAttributes; out.origin = d.originAreaInfo
      out.notice = d.productInfoProvidedNotice; out.cert = d.productCertificationInfos; out.certEx = d.certificationTargetExcludeContent
      out.other = Object.keys(d)
    }
    if (a === "cattr") {
      const c = u.searchParams.get("c") || ""
      const at: any = await ncall("GET", "/v1/product-attributes/attributes", "categoryId=" + c)
      out.attrs = (at || []).map((x: any) => ({ s: x.attributeSeq, n: x.attributeName, t: x.attributeType, c: x.attributeClassificationType, req: x.requiredYn ?? x.mandatory }))
      const vals: any = await ncall("GET", "/v1/product-attributes/attribute-values", "categoryId=" + c)
      out.vals = (vals || []).map((v: any) => ({ s: v.attributeSeq, vs: v.attributeValueSeq, n: v.minAttributeValue || v.attributeValueName, u: v.minAttributeValueUnitCode }))
    }
  } catch (e: any) { out.err = String(e?.message || e).slice(0, 500) }
  return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json; charset=utf-8" } })
}
