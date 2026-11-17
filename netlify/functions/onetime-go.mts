// 임시 (확인 후 삭제)
import { getStore } from "@netlify/blobs"
import { internalKey } from "./_lib/auth.mts"
export default async (req: Request) => {
  const u = new URL(req.url), t = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!t || u.searchParams.get("t") !== t) return new Response("no", { status: 404 })
  const out: any = {}
  const NOTICE = "평일 오전 8시 이전 주문은 당일 출고를 목표로 합니다.\n이후 주문은 다음 영업일에 출고합니다.\n산지 사정에 따라 1~2일 늦어질 수 있습니다."
  if (u.searchParams.get("a") === "ship") { const ids = (u.searchParams.get("ids") || "").split(",").filter(Boolean); const r = await fetch(u.origin + "/.netlify/functions/lucky-register-background", { method: "POST", headers: { "x-internal": internalKey() }, body: JSON.stringify({ mode: "ship", shipDays: 2, notice: NOTICE, productIds: ids }) }); out.started = r.status }
  else { const st: any = await getStore({ name: "admin-settings", consistency: "strong" }).get("lucky-reg", { type: "json" }); out.running = st?.running; out.at = st?.at; out.ship = st?.ship; out.error = st?.error; const d = Object.values(st?.done || {}) as any[]; out.progress = `${d.filter((x) => x.ok && x.shipKey).length}/${d.filter((x) => x.ok).length}`; out.errs = d.filter((x) => x.shipError).map((x) => `${x.name}: ${x.shipError}`) }
  return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json; charset=utf-8" } })
}
