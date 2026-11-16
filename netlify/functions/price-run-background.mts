// 가격 조사·자동 조정 (하루 1번 예약 + 관리자 버튼)
import { isLoggedIn, isInternal } from "./_lib/auth.mts"
import { runPricing } from "./_lib/pricing.mts"
import { getStore } from "@netlify/blobs"
export default async (req: Request) => {
  if (!isLoggedIn(req) && !isInternal(req)) return
  try { const r = await runPricing(); console.log("pricing", r.changes) } catch (e: any) {
    console.error("pricing", e)
    await getStore({ name: "admin-settings", consistency: "strong" }).setJSON("price-report", { at: new Date().toISOString(), running: false, rows: [], changes: [], errors: [String(e?.message || e).slice(0, 300)] })
  }
}
