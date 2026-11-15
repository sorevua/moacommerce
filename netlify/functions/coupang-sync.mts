import type { Config } from "@netlify/functions"
import { coupangConfigured, syncCoupangOrders, recordSyncError } from "./_lib/coupang.mts"

// 30분마다 쿠팡 결제완료 주문을 가져온다 (Make 중계 사용량 절약을 위해 30분 간격)
export default async () => {
  if (!coupangConfigured()) return
  try {
    const r = await syncCoupangOrders()
    console.log("coupang sync", r)
  } catch (err) {
    console.error(err)
    await recordSyncError(err)
  }
}

export const config: Config = {
  schedule: "*/30 * * * *",
}
