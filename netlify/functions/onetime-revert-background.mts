// 임시: 오늘(11/19) 점검에서 내린 판매가를 원래 가격으로 되돌린다 (배경 작업). 작업이 끝나면 지운다.
import { getStore } from "@netlify/blobs"
import { isInternal } from "./_lib/auth.mts"
import { changePrice } from "./_lib/coupang.mts"
function priceOf(supply: number, s: any) {
  const d = { marginRate: 0.15, extraShipping: 0, coupangFee: 0.106, naverSalesFee: 0.0273, naverPayFee: 0.033, vatOnFee: 0.1, roundUnit: 100, sameMarketPrice: 1, ...(s || {}) }
  const cost = supply + Number(d.extraShipping || 0), u = Number(d.roundUnit || 100)
  const cp = Math.ceil(cost / (1 - d.coupangFee * (1 + d.vatOnFee) - d.marginRate) / u) * u
  const np = Math.ceil(cost / (1 - (d.naverSalesFee + d.naverPayFee) * (1 + d.vatOnFee) - d.marginRate) / u) * u
  return Number(d.sameMarketPrice) ? Math.max(cp, np) : cp
}
export default async (req: Request) => {
  if (!isInternal(req)) return
  const st = getStore({ name: "admin-settings", consistency: "strong" })
  const cfg: any = await st.get("settings", { type: "json" })
  const log: any[] = ((await st.get("lucky-watch", { type: "json" })) as any[]) || []
  const vs = getStore({ name: "admin-vendors", consistency: "strong" })
  const { blobs } = await vs.list()
  const v: any = (await Promise.all(blobs.map((b) => vs.get(b.key, { type: "json" })))).filter(Boolean).find((x: any) => x.lucky)
  const prog: any = (await st.get("revert-1119", { type: "json" })) || { done: {}, fail: [] }
  for (const rep of log.filter((r) => String(r.at) > "2026-11-19T08:30")) for (const line of rep.raised || []) {
    const m = String(line).match(/^(.*): 공급가 (\d+) → (\d+) \(인하\), 판매가 (\d+)$/)
    if (!m || prog.done[m[1]]) continue
    const x = (v?.products || []).find((p: any) => p.name === m[1])
    if (!x?.coupangItemId) { prog.fail.push(m[1] + ": 옵션 없음"); continue }
    const back = priceOf(Number(m[2]), cfg)
    try { const r: any = await changePrice(String(x.coupangItemId), back); if (r && r.code && !/SUCCESS|200/i.test(String(r.code))) throw new Error(JSON.stringify(r).slice(0, 100)); prog.done[m[1]] = back }
    catch (e: any) { prog.fail.push(m[1] + ": " + String(e?.message || e).slice(0, 100)) }
    await st.setJSON("revert-1119", prog)
  }
  prog.finished = new Date().toISOString(); await st.setJSON("revert-1119", prog)
}
