// 임시 (확인 후 삭제)
import { getStore } from "@netlify/blobs"
import { internalKey } from "./_lib/auth.mts"
export default async (req: Request) => {
  const u = new URL(req.url), t = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!t || u.searchParams.get("t") !== t) return new Response("no", { status: 404 })
  const out: any = {}
  if (u.searchParams.get("a") === "ship") { const r = await fetch(u.origin + "/.netlify/functions/lucky-register-background", { method: "POST", headers: { "x-internal": internalKey() }, body: JSON.stringify({ mode: "ship", shipDays: 2 }) }); out.started = r.status }
  else { const st: any = await getStore({ name: "admin-settings", consistency: "strong" }).get("lucky-reg", { type: "json" }); out.running = st?.running; out.at = st?.at; out.ship = st?.ship; out.error = st?.error; const d = Object.values(st?.done || {}) as any[]; out.progress = `${d.filter((x) => x.ok && x.shipDays === 2).length}/${d.filter((x) => x.ok).length}`; out.errs = d.filter((x) => x.shipError).map((x) => `${x.name}: ${x.shipError}`) }
  return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json; charset=utf-8" } })
}
