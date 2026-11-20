// 임시: 네이버 감귤 6개 상품에 판매자 태그 등록. 작업이 끝나면 지운다.
import { ncall } from "./_lib/naver.mts"
const NOS = ["13824869699", "13824874194", "13824874246", "13824869856", "13824874374", "13824874416"]
export default async (req: Request) => {
  const u = new URL(req.url)
  const t = u.searchParams.get("t") || "", tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || t !== tok) return new Response("no", { status: 404 })
  const a = u.searchParams.get("a") || ""
  const out: any = {}
  try {
    if (a === "rec") {
      for (const k of (u.searchParams.get("k") || "").split(",")) {
        const r: any = await ncall("GET", "/v2/tags/recommend-tags", "keyword=" + encodeURIComponent(k))
        out[k] = (r || []).slice(0, 15).map((x: any) => `${x.code}:${x.text}`)
      }
    }
    if (a === "look") {
      for (const no of NOS) { const c: any = await ncall("GET", "/v2/products/origin-products/" + no); out[no] = c.originProduct.name + " | " + (c.originProduct.detailAttribute.seoInfo?.sellerTags || []).map((x: any) => x.text).join(",") }
    }
    if (a === "apply") {
      const tags = JSON.parse(u.searchParams.get("tags") || "[]")
      const only = u.searchParams.get("no")
      for (const no of only ? [only] : NOS) {
        try {
          const p: any = await ncall("GET", "/v2/products/origin-products/" + no)
          const op = p.originProduct, d = op.detailAttribute
          d.seoInfo = { ...(d.seoInfo || {}), sellerTags: tags }
          delete p.originProduct.detailAttribute.optionInfo?.optionStandards
          await ncall("PUT", "/v2/products/origin-products/" + no, "", p)
          const c: any = await ncall("GET", "/v2/products/origin-products/" + no)
          out[no] = (c.originProduct.detailAttribute.seoInfo?.sellerTags || []).map((x: any) => x.text).join(",")
        } catch (e: any) { out[no] = "실패: " + String(e?.message || e).slice(0, 300) }
      }
    }
  } catch (e: any) { out.err = String(e?.message || e).slice(0, 500) }
  return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json; charset=utf-8" } })
}
