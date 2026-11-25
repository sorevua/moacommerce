// 임시: 11/25 행운 공지 — 무농약 제주레몬 → 국내산 레몬 (대구 산지 추가) + 대추방울토마토 특대과 재오픈 점검. 끝나면 지운다.
import { getStore } from "@netlify/blobs"
import { internalKey } from "./_lib/auth.mts"
import { getProduct, call } from "./_lib/coupang.mts"
const RX: [RegExp, string][] = [[/제주\s?레몬/g, "국내산 레몬"], [/국산\s*\(\s*제주[^)]*\)/g, "국산"], [/제주산/g, "국내산"], [/제주특별자치도/g, "국내산"]]
export default async (req: Request) => {
  const u = new URL(req.url)
  const tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || u.searchParams.get("t") !== tok) return new Response("no", { status: 404 })
  const st = getStore({ name: "admin-settings", consistency: "strong" })
  const a = u.searchParams.get("a"), out: any = {}
  try {
    if (a === "dry" || a === "apply") {
      const reg: any = (await st.get("lucky-reg", { type: "json" })) || { done: {} }
      const hits = Object.values<any>(reg.done).filter((d) => d?.ok && /제주\s?레몬/.test(String(d.name)))
      out.products = []
      for (const d of hits) for (const sp of (d.sellerProductIds?.length ? d.sellerProductIds : [d.sellerProductId]).map(String)) {
        const p: any = await getProduct(sp)
        let s = JSON.stringify(p); const found: string[] = []
        for (const [re, to] of RX) s = s.replace(re, (m: string, ...r: any[]) => { const i = r[r.length - 2]; found.push(JSON.stringify(s.slice(Math.max(0, i - 25), i + m.length + 15))); return to })
        out.products.push({ sp, name: p.sellerProductName, found: found.slice(0, 20), count: found.length })
        if (a === "apply" && found.length) {
          const np = JSON.parse(s); np.requested = true
          const r: any = await call("PUT", "/v2/providers/seller_api/apis/api/v1/marketplace/seller-products", "", np)
          out.products[out.products.length - 1].result = String(r?.code || r?.message || "").slice(0, 120)
        }
      }
    }
    if (a === "watch") out.started = (await fetch(u.origin + "/.netlify/functions/lucky-watch-background", { method: "POST", headers: { "x-internal": internalKey() }, body: "{}" })).status
    if (a === "wlog") out.last = ((await st.get("lucky-watch", { type: "json" })) || [])[0]
  } catch (e: any) { out.err = String(e?.message || e).slice(0, 400) }
  return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json; charset=utf-8" } })
}
