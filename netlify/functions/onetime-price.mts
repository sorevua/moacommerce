// 임시: 가격 엔진 시험 — 확인 후 삭제
import type { Config } from "@netlify/functions"
import { getStore } from "@netlify/blobs"
import { internalKey } from "./_lib/auth.mts"
export default async (req: Request) => {
  const u = new URL(req.url)
  const tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || u.searchParams.get("t") !== tok) return new Response("no", { status: 403 })
  const S = getStore({ name: "admin-settings", consistency: "strong" })
  if (u.searchParams.get("auto")) await S.setJSON("price-config", { auto: u.searchParams.get("auto") === "1" })
  if (u.searchParams.get("run") === "1") { await fetch(new URL("/.netlify/functions/price-run-background", req.url), { method: "POST", headers: { "x-internal": internalKey() }, body: "{}" }); return Response.json({ started: true }) }
  const r: any = await S.get("price-report", { type: "json" })
  return Response.json(r ? { at: r.at, running: r.running, errors: r.errors, changes: r.changes, rows: (r.rows || []).map((x: any) => ({ p: x.product, supply: x.supply, n: x.n, med: x.marketMedian, min: x.marketMin, note: x.note, cp: x.cp, floorCp: x.floorCp, nv: x.nv, floorNv: x.floorNv, s: (x.samples || []).map((s: any) => `${s.market}/${s.seller}/${s.price}/${s.kg}kg`) })) } : null)
}
export const config: Config = { path: "/api/onetime-price" }
