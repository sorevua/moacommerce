// 임시: 단감 특대과 중지 + 브랜드 수정 실행·확인. 끝나면 지운다.
import { getStore } from "@netlify/blobs"
import { internalKey } from "./_lib/auth.mts"
export default async (req: Request) => {
  const u = new URL(req.url)
  const tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || u.searchParams.get("t") !== tok) return new Response("no", { status: 404 })
  const a = u.searchParams.get("a"), out: any = {}
  if (a === "run") out.started = (await fetch(u.origin + "/.netlify/functions/lucky-brand-background", { method: "POST", headers: { "x-internal": internalKey() }, body: "{}" })).status
  if (a === "st") { const v: any = await getStore({ name: "admin-settings", consistency: "strong" }).get("lucky-brand", { type: "json" }); out.running = v?.running; out.finished = v?.finished; out.done = Object.keys(v?.done || {}).length; out.stopped = v?.stoppedNames; out.fail = v?.fail }
  return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json; charset=utf-8" } })
}
