// 임시: 11/20 행운 공지 반영 (타이벡 로얄과 옵션명, 감자 제주·도서산간 불가, 가격 점검 실행). 작업이 끝나면 지운다.
import { internalKey } from "./_lib/auth.mts"
import { getStore } from "@netlify/blobs"
import { getProduct, call } from "./_lib/coupang.mts"
const PUT = (p: any) => { p.requested = true; return call("PUT", "/v2/providers/seller_api/apis/api/v1/marketplace/seller-products", "", p) }
export default async (req: Request) => {
  const u = new URL(req.url)
  const t = u.searchParams.get("t") || "", tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || t !== tok) return new Response("no", { status: 404 })
  const a = u.searchParams.get("a") || ""
  const out: any = {}
  try {
    if (a === "look" || a === "tibek") {
      const p: any = await getProduct("16460091645")
      const rows = (p.items || []).map((it: any) => it.itemName)
      if (a === "tibek") {
        for (const it of p.items || []) if (/로얄과/.test(it.itemName)) it.itemName = String(it.itemName).replace("로얄과", "로얄소과").replace(/2S\s*[-~]\s*M/g, "2S-S")
        const r: any = await PUT(p); out.res = String(r?.code || r?.message || "").slice(0, 120)
      }
      out.before = rows; out.after = (p.items || []).map((it: any) => it.itemName)
    }
    if (a === "potato") {
      const p: any = await getProduct("16460052465")
      out.before = p.remoteAreaDeliverable
      p.remoteAreaDeliverable = "N"
      const r: any = await PUT(p); out.res = String(r?.code || r?.message || "").slice(0, 120)
    }
    if (a === "wlog") { const st = getStore({ name: "admin-settings", consistency: "strong" }); const l: any = await st.get("lucky-watch", { type: "json" }); out.latest = (l || [])[0] }
    if (a === "watch") {
      const r = await fetch(u.origin + "/.netlify/functions/lucky-watch-background", { method: "POST", headers: { "x-internal": internalKey() }, body: "{}" })
      out.started = r.status
    }
  } catch (e: any) { out.err = String(e?.message || e).slice(0, 300) }
  return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json; charset=utf-8" } })
}
