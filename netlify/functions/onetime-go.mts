// 임시: 네이버 상품 태그 채우기. 작업이 끝나면 지운다.
import { ncall } from "./_lib/naver.mts"
export default async (req: Request) => {
  const u = new URL(req.url)
  const t = u.searchParams.get("t") || "", tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || t !== tok) return new Response("no", { status: 404 })
  const a = u.searchParams.get("a") || ""
  const J = (x: any) => new Response(JSON.stringify(x, null, 1), { headers: { "content-type": "application/json; charset=utf-8" } })
  try {
    if (a === "rec") {
      const out: any = {}
      for (const k of (u.searchParams.get("k") || "").split(",")) {
        const r: any = await ncall("GET", "/v2/tags/recommend-tags", "keyword=" + encodeURIComponent(k))
        out[k] = (r || []).slice(0, 10).map((x: any) => `${x.code}:${x.text}`)
      }
      return J(out)
    }
    if (a === "scan") {
      const r: any = await ncall("POST", "/v1/products/search", "", { page: 1, size: 100 })
      const out: any[] = []
      for (const c of r.contents || []) {
        const p: any = await ncall("GET", "/v2/products/origin-products/" + c.originProductNo)
        out.push({ no: c.originProductNo, name: p.originProduct?.name, tags: (p.originProduct?.detailAttribute?.seoInfo?.sellerTags || []).map((x: any) => x.text) })
      }
      return J(out)
    }
    if (a === "apply") {
      // nos=1,2,3 & tags=code:text|code:text
      const tags = (u.searchParams.get("tags") || "").split("|").filter(Boolean).map(s => { const i = s.indexOf(":"); return { code: Number(s.slice(0, i)), text: s.slice(i + 1) } })
      const res: any = {}
      for (const no of (u.searchParams.get("nos") || "").split(",").filter(Boolean)) {
        try {
          const p: any = await ncall("GET", "/v2/products/origin-products/" + no)
          const d = p.originProduct.detailAttribute
          d.seoInfo = { ...(d.seoInfo || {}), sellerTags: tags }
          await ncall("PUT", "/v2/products/origin-products/" + no, "", p)
          res[no] = "ok"
        } catch (e: any) { res[no] = String(e?.message || e).slice(0, 300) }
      }
      return J(res)
    }
    return J({ ok: true })
  } catch (e: any) { return J({ error: String(e?.message || e) }) }
}
