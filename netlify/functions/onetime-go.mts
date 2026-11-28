// 임시 (2026-11-28): 위너 하한가 목록용 — 행운 옵션의 쿠팡 ID·공급가만 읽는다(쿠팡 호출 없음). 끝나면 지운다.
import { getStore } from "@netlify/blobs"
import { internalKey } from "./_lib/auth.mts"
export default async (req: Request) => {
  const u = new URL(req.url)
  const tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || u.searchParams.get("t") !== tok) return new Response("no", { status: 404 })
  const a = u.searchParams.get("a")
  if (a === "link") return Response.json({ started: (await fetch(u.origin + "/.netlify/functions/lucky-register-background", { method: "POST", headers: { "x-internal": internalKey(), "content-type": "application/json" }, body: JSON.stringify({ mode: "link", shipDays: 1 }) })).status })
  if (a === "lst") { const r: any = await getStore({ name: "admin-settings", consistency: "strong" }).get("lucky-reg", { type: "json" }); return Response.json({ running: r.running, error: r.error, notLinked: Object.values<any>(r.done).filter((d) => d.ok && !d.linked).map((d) => `${d.name} ${d.cpStatus || ""}`) }) }
  const vs = getStore({ name: "admin-vendors", consistency: "strong" })
  const { blobs } = await vs.list()
  const v: any = (await Promise.all(blobs.map((b) => vs.get(b.key, { type: "json" })))).filter(Boolean).find((x: any) => x.lucky)
  const cfg: any = await getStore({ name: "admin-settings", consistency: "strong" }).get("settings", { type: "json" })
  const rows = (v?.products || []).filter((x: any) => a === "empty" ? !x.coupangItemId : x.coupangItemId).map((x: any) => [x.luckyProductName || "", x.name, String(x.coupangItemId), Number(x.supplyPrice || 0), x.autoStopped || x.luckySoldOut ? 1 : 0])
  return new Response(JSON.stringify({ cfg, rows }), { headers: { "content-type": "application/json; charset=utf-8" } })
}
