// 임시: 사진·상세 일괄 교체 실행·확인. 작업이 끝나면 지운다.
import { getStore } from "@netlify/blobs"
import { internalKey } from "./_lib/auth.mts"
export default async (req: Request) => {
  const u = new URL(req.url)
  const t = u.searchParams.get("t") || "", tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || t !== tok) return new Response("no", { status: 404 })
  if (u.searchParams.get("a") === "run") {
    const r = await fetch(u.origin + "/.netlify/functions/lucky-photos-background", { method: "POST", headers: { "x-internal": internalKey(), "content-type": "application/json" }, body: JSON.stringify({ limit: Number(u.searchParams.get("limit") || 200) }) })
    return Response.json({ started: r.status })
  }
  const p: any = await getStore({ name: "admin-settings", consistency: "strong" }).get("lucky-photos", { type: "json" })
  return new Response(JSON.stringify({ done: Object.keys(p?.done || {}).length, withPhoto: Object.values(p?.done || {}).filter((x: any) => x.num).length, fail: p?.fail || {}, finished: p?.finished || "" }, null, 1), { headers: { "content-type": "application/json; charset=utf-8" } })
}
