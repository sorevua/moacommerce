// 임시: 사진·상세 일괄 교체 실행·확인. 작업이 끝나면 지운다.
import { getStore } from "@netlify/blobs"
import { internalKey } from "./_lib/auth.mts"
import { getProduct } from "./_lib/coupang.mts"
export default async (req: Request) => {
  const u = new URL(req.url)
  const t = u.searchParams.get("t") || "", tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || t !== tok) return new Response("no", { status: 404 })
  if (u.searchParams.get("a") === "run") {
    const r = await fetch(u.origin + "/.netlify/functions/lucky-photos-background", { method: "POST", headers: { "x-internal": internalKey(), "content-type": "application/json" }, body: JSON.stringify({ limit: Number(u.searchParams.get("limit") || 200), redo: u.searchParams.get("redo") === "1" }) })
    return Response.json({ started: r.status })
  }
  if (u.searchParams.get("a") === "chk") {
    const pr: any = await getStore({ name: "admin-settings", consistency: "strong" }).get("lucky-photos", { type: "json" })
    const sp = u.searchParams.get("sp") || Object.entries<any>(pr?.done || {}).find(([, v]) => v.num)?.[0] || ""
    const g: any = await getProduct(sp)
    const it = (g.items || [])[0] || {}
    return Response.json({ sp, status: g.statusName, name: g.sellerProductName, main: (it.images || []).find((x: any) => x.imageType === "REPRESENTATION"), contents: (it.contents || []).slice(0, 4).map((c: any) => (c.contentDetails || []).map((x: any) => String(x.content).slice(0, 120))) })
  }
  const p: any = await getStore({ name: "admin-settings", consistency: "strong" }).get("lucky-photos", { type: "json" })
  return new Response(JSON.stringify({ done: Object.keys(p?.done || {}).length, withPhoto: Object.values(p?.done || {}).filter((x: any) => x.num).length, fail: p?.fail || {}, finished: p?.finished || "" }, null, 1), { headers: { "content-type": "application/json; charset=utf-8" } })
}
