// 임시: 행운 점검(품절·가격)을 지금 한 번 돌리고 결과 확인. 작업이 끝나면 지운다.
import { getStore } from "@netlify/blobs"
import { internalKey } from "./_lib/auth.mts"
import { changePrice } from "./_lib/coupang.mts"
function priceOf(supply: number, s: any) {
  const d = { marginRate: 0.15, extraShipping: 0, coupangFee: 0.106, naverSalesFee: 0.0273, naverPayFee: 0.033, vatOnFee: 0.1, roundUnit: 100, sameMarketPrice: 1, ...(s || {}) }
  const cost = supply + Number(d.extraShipping || 0), u = Number(d.roundUnit || 100)
  const cp = Math.ceil(cost / (1 - d.coupangFee * (1 + d.vatOnFee) - d.marginRate) / u) * u
  const np = Math.ceil(cost / (1 - (d.naverSalesFee + d.naverPayFee) * (1 + d.vatOnFee) - d.marginRate) / u) * u
  return Number(d.sameMarketPrice) ? Math.max(cp, np) : cp
}
export default async (req: Request) => {
  const u = new URL(req.url)
  const t = u.searchParams.get("t") || "", tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || t !== tok) return new Response("no", { status: 404 })
  if (u.searchParams.get("a") === "run") {
    const r = await fetch(u.origin + "/.netlify/functions/lucky-watch-background", { method: "POST", headers: { "x-internal": internalKey() }, body: "{}" })
    return Response.json({ started: r.status })
  }
  if (u.searchParams.get("a") === "revert") {
    // 오늘 점검에서 내린 판매가를 원래 가격(예전 공급가 기준 마진 15%)으로 되돌린다
    const st = getStore({ name: "admin-settings", consistency: "strong" })
    const cfg: any = await st.get("settings", { type: "json" })
    const log: any[] = ((await st.get("lucky-watch", { type: "json" })) as any[]) || []
    const vs = getStore({ name: "admin-vendors", consistency: "strong" })
    const { blobs } = await vs.list()
    const v: any = (await Promise.all(blobs.map((b) => vs.get(b.key, { type: "json" })))).filter(Boolean).find((x: any) => x.lucky)
    const out: any[] = []
    for (const rep of log.filter((r) => String(r.at) > "2026-11-19T08:30")) for (const line of rep.raised || []) {
      const m = String(line).match(/^(.*): 공급가 (\d+) → (\d+) \(인하\), 판매가 (\d+)$/)
      if (!m) continue
      const x = (v?.products || []).find((p: any) => p.name === m[1])
      if (!x?.coupangItemId) { out.push({ name: m[1], err: "옵션 없음" }); continue }
      const back = priceOf(Number(m[2]), cfg)
      const r: any = await changePrice(String(x.coupangItemId), back).catch((e: any) => ({ err: String(e?.message || e) }))
      out.push({ name: m[1], from: Number(m[4]), back, r: String(r?.code || r?.err || r?.message || "").slice(0, 80) })
    }
    return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json; charset=utf-8" } })
  }
  const s = getStore({ name: "admin-settings", consistency: "strong" })
  const last = await s.get("lucky-watch-last", { type: "json" })
  const log: any = await s.get("lucky-watch", { type: "json" })
  return new Response(JSON.stringify({ last, latest: (log || [])[0] }, null, 1), { headers: { "content-type": "application/json; charset=utf-8" } })
}
