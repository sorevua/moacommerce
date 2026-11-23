// 임시: 11/23 행운 공지 반영(가격 점검 실행) + 사진 되돌리기 나머지. 작업이 끝나면 지운다.
import { getStore } from "@netlify/blobs"
import { internalKey } from "./_lib/auth.mts"
export default async (req: Request) => {
  const u = new URL(req.url)
  const t = u.searchParams.get("t") || "", tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || t !== tok) return new Response("no", { status: 404 })
  const a = u.searchParams.get("a") || ""
  const st = getStore({ name: "admin-settings", consistency: "strong" })
  const out: any = {}
  try {
    if (a === "watch") out.started = (await fetch(u.origin + "/.netlify/functions/lucky-watch-background", { method: "POST", headers: { "x-internal": internalKey() }, body: "{}" })).status
    if (a === "revert") out.started = (await fetch(u.origin + "/.netlify/functions/lucky-photos-revert-background", { method: "POST", headers: { "x-internal": internalKey() }, body: "{}" })).status
    if (a === "wlog") { const l: any = await st.get("lucky-watch", { type: "json" }); out.last = await st.get("lucky-watch-last", { type: "json" }); out.recent = (l || []).slice(0, 3) }
    if (a === "rst") { const v: any = await st.get("lucky-photos-revert", { type: "json" }); out.running = v?.running; out.finished = v?.finished; out.done = Object.keys(v?.done || {}).length; out.fail = v?.fail }
  } catch (e: any) { out.err = String(e?.message || e).slice(0, 500) }
  return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json; charset=utf-8" } })
}
