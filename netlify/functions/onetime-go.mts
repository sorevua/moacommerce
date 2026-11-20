// 임시: 점검 즉시 실행 / 타이벡 감귤 옵션명 변경 / 네이버 상품 확인. 작업이 끝나면 지운다.
import { getStore } from "@netlify/blobs"
import { internalKey } from "./_lib/auth.mts"
import { getProduct, call } from "./_lib/coupang.mts"
import { ncall } from "./_lib/naver.mts"
export default async (req: Request) => {
  const u = new URL(req.url)
  const t = u.searchParams.get("t") || "", tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || t !== tok) return new Response("no", { status: 404 })
  const a = u.searchParams.get("a") || ""
  const J = (x: any) => new Response(JSON.stringify(x, null, 1), { headers: { "content-type": "application/json; charset=utf-8" } })
  const st = getStore({ name: "admin-settings", consistency: "strong" })
  try {
    if (a === "watch") { const r = await fetch(u.origin + "/.netlify/functions/lucky-watch-background", { method: "POST", headers: { "x-internal": internalKey() }, body: "{}" }); return J({ started: r.status }) }
    if (a === "wlog") { const log: any = await st.get("lucky-watch", { type: "json" }); return J((log || [])[0]) }
    if (a === "tybek") {
      const sp = "16460091645", p: any = await getProduct(sp)
      const rows: any[] = []
      for (const it of p.items || []) {
        const from = String(it.itemName)
        const to = from.replace("로얄과", "로얄소과").replace(/2S\s*[~-]\s*M/g, "2S-S")
        rows.push({ from, to })
        if (u.searchParams.get("go") === "1" && to !== from) { it.itemName = to; for (const at of it.attributes || []) if (String(at.attributeValueName || "").includes("로얄과")) at.attributeValueName = String(at.attributeValueName).replace("로얄과", "로얄소과").replace(/2S\s*[~-]\s*M/g, "2S-S") }
      }
      let res = ""
      if (u.searchParams.get("go") === "1") {
        p.requested = true; const r: any = await call("PUT", "/v2/providers/seller_api/apis/api/v1/marketplace/seller-products", "", p); res = String(r?.code || r?.message || "")
        const reg: any = await st.get("lucky-reg", { type: "json" }); const d = reg?.done?.["01M4QSD8F3EPE1JN31AWK08C8F"]
        if (d?.options) { for (const o of d.options) o.name = String(o.name).replace("로얄과", "로얄소과").replace(/2S\s*[~-]\s*M/g, "2S-S"); await st.setJSON("lucky-reg", reg) }
      }
      return J({ status: p.statusName, res, rows })
    }
    if (a === "nsearch") { const r: any = await ncall("POST", "/v1/products/search", "", { page: 1, size: 100 }); return J(r) }
    if (a === "nget") return J(await ncall("GET", `/v2/products/origin-products/${u.searchParams.get("no")}`))
    if (a === "nraw") return J(await ncall((u.searchParams.get("m") as any) || "GET", u.searchParams.get("p") || "/", u.searchParams.get("q") || ""))
    return J({ ok: true })
  } catch (e: any) { return J({ error: String(e?.message || e) }) }
}
