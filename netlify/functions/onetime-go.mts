// 임시: 네이버 감귤 상품 속성 조사·등록. 작업이 끝나면 지운다.
import { ncall } from "./_lib/naver.mts"
export default async (req: Request) => {
  const u = new URL(req.url)
  const t = u.searchParams.get("t") || "", tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || t !== tok) return new Response("no", { status: 404 })
  const a = u.searchParams.get("a") || ""
  const out: any = {}
  try {
    if (a === "cattr") {
      const c = u.searchParams.get("c") || "50002163"
      const at: any = await ncall("GET", "/v1/product-attributes/attributes", "categoryId=" + c)
      const vals: any = await ncall("GET", "/v1/product-attributes/attribute-values", "categoryId=" + c)
      out.attrs = (at || []).map((x: any) => {
        const vs = (vals || []).filter((v: any) => v.attributeSeq === x.attributeSeq).map((v: any) => `${v.attributeValueSeq}:${v.minAttributeValue ?? v.attributeValueName ?? ""}${v.minAttributeValueUnitCode ? "(" + v.minAttributeValueUnitCode + ")" : ""}`)
        return `${x.attributeSeq} ${x.attributeName} [${x.attributeType}/${x.attributeClassificationType}] ${vs.slice(0, 40).join(", ")}`
      })
    }
    if (a === "get") {
      const p: any = await ncall("GET", "/v2/products/origin-products/" + u.searchParams.get("no"))
      out.attrs = p.originProduct.detailAttribute.productAttributes; out.tags = p.originProduct.detailAttribute.seoInfo
    }
    if (a === "set") {
      const attrs = JSON.parse(u.searchParams.get("attrs") || "[]")
      for (const no of (u.searchParams.get("nos") || "").split(",").filter(Boolean)) {
        try {
          const p: any = await ncall("GET", "/v2/products/origin-products/" + no)
          p.originProduct.detailAttribute.productAttributes = attrs
          await ncall("PUT", "/v2/products/origin-products/" + no, "", p)
          const c: any = await ncall("GET", "/v2/products/origin-products/" + no)
          out[no] = c.originProduct.detailAttribute.productAttributes
        } catch (e: any) { out[no] = "실패: " + String(e?.message || e).slice(0, 400) }
      }
    }
  } catch (e: any) { out.err = String(e?.message || e).slice(0, 500) }
  return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json; charset=utf-8" } })
}
