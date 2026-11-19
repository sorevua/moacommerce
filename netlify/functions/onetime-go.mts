// 임시: 행운 점검(품절·가격)을 지금 한 번 돌리고 결과 확인. 작업이 끝나면 지운다.
import { getStore } from "@netlify/blobs"
import { internalKey } from "./_lib/auth.mts"
export default async (req: Request) => {
  const u = new URL(req.url)
  const t = u.searchParams.get("t") || "", tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || t !== tok) return new Response("no", { status: 404 })
  if (u.searchParams.get("a") === "run") {
    const r = await fetch(u.origin + "/.netlify/functions/lucky-watch-background", { method: "POST", headers: { "x-internal": internalKey() }, body: "{}" })
    return Response.json({ started: r.status })
  }
  if (u.searchParams.get("a") === "revert") {
    const r = await fetch(u.origin + "/.netlify/functions/onetime-revert-background", { method: "POST", headers: { "x-internal": internalKey() }, body: "{}" })
    return Response.json({ started: r.status })
  }
  if (u.searchParams.get("a") === "rst") {
    const p: any = await getStore({ name: "admin-settings", consistency: "strong" }).get("revert-1119", { type: "json" })
    return Response.json({ done: Object.keys(p?.done || {}).length, fail: p?.fail || [], finished: p?.finished || "" })
  }
  const s = getStore({ name: "admin-settings", consistency: "strong" })
  const last = await s.get("lucky-watch-last", { type: "json" })
  const log: any = await s.get("lucky-watch", { type: "json" })
  return new Response(JSON.stringify({ last, latest: (log || [])[0] }, null, 1), { headers: { "content-type": "application/json; charset=utf-8" } })
}
