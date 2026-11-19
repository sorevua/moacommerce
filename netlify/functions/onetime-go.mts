// 임시: 네이버 등록 작업용. 작업이 끝나면 지운다.
import { getStore } from "@netlify/blobs"
import { internalKey } from "./_lib/auth.mts"
import { ncall } from "./_lib/naver.mts"

export default async (req: Request) => {
  const u = new URL(req.url)
  const t = u.searchParams.get("t") || "", tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || t !== tok) return new Response("no", { status: 404 })
  const a = u.searchParams.get("a") || ""
  const J = (x: any) => new Response(JSON.stringify(x, null, 1), { headers: { "content-type": "application/json; charset=utf-8" } })
  try {
    if (a === "nlist") {
      const r: any = await ncall("POST", "/v1/products/search", "", { page: 1, size: 100 })
      return J((r.contents || []).map((c: any) => ({ no: c.originProductNo, ch: (c.channelProducts || []).map((p: any) => ({ cno: p.channelProductNo, name: p.name, st: p.statusType, cat: p.categoryId, wc: p.wholeCategoryName, price: p.salePrice })) })))
    }
    if (a === "nget") return J(await ncall("GET", `/v2/products/origin-products/${u.searchParams.get("no")}`))
    if (a === "ncat") {
      const r: any = await ncall("GET", "/v1/categories", "last=true")
      const q = u.searchParams.get("q") || ""
      return J((r || []).filter((c: any) => String(c.wholeCategoryName).includes(q)).slice(0, 50))
    }
    if (a === "nreg") {
      const body = { ids: (u.searchParams.get("ids") || "").split(",").filter(Boolean), dry: u.searchParams.get("dry") === "1" }
      const r = await fetch(u.origin + "/.netlify/functions/lucky-naver-background", { method: "POST", headers: { "x-internal": internalKey(), "content-type": "application/json" }, body: JSON.stringify(body) })
      return J({ started: r.status })
    }
    if (a === "nst") return J(await getStore({ name: "admin-settings", consistency: "strong" }).get("lucky-naver", { type: "json" }))
    return J({ ok: true })
  } catch (e: any) { return J({ error: String(e?.message || e) }) }
}
