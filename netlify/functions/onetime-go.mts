// 임시: 행운 사진 되돌리기 실행·확인용. 작업이 끝나면 지운다.
import { getStore } from "@netlify/blobs"
import { internalKey } from "./_lib/auth.mts"
export default async (req: Request) => {
  const u = new URL(req.url)
  const t = u.searchParams.get("t") || "", tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || t !== tok) return new Response("no", { status: 404 })
  const a = u.searchParams.get("a") || ""
  const out: any = {}
  try {
    if (a === "run" || a === "dry") {
      const r = await fetch(u.origin + "/.netlify/functions/lucky-photos-revert-background", { method: "POST", headers: { "x-internal": internalKey() }, body: JSON.stringify({ dry: a === "dry" }) })
      out.started = r.status
    }
    if (a === "st") {
      const v: any = await getStore({ name: "admin-settings", consistency: "strong" }).get("lucky-photos-revert", { type: "json" })
      out.running = v?.running; out.finished = v?.finished; out.done = Object.keys(v?.done || {}).length; out.fail = v?.fail
      const s = Object.values<string>(v?.status || {}); out.statusCount = s.reduce((m: any, x) => { const k = x.split(" | ")[0]; m[k] = (m[k] || 0) + 1; return m }, {}); out.sample = s.slice(0, 8)
    }
  } catch (e: any) { out.err = String(e?.message || e).slice(0, 500) }
  return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json; charset=utf-8" } })
}
