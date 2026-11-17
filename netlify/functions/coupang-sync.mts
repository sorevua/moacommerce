import type { Config } from "@netlify/functions"
import { coupangConfigured, syncCoupangOrders, recordSyncError } from "./_lib/coupang.mts"
import { naverConfigured, syncNaverOrders } from "./_lib/naver.mts"
import { internalKey } from "./_lib/auth.mts"
import { syncLuckyOrders } from "./_lib/lucky-sync.mts"

// 30분마다 쿠팡·네이버 결제완료 주문을 가져온다 (Make 중계 사용량 절약을 위해 30분 간격)
export default async () => {
  if (coupangConfigured()) {
    try { console.log("coupang sync", await syncCoupangOrders()) } catch (err) { console.error(err); await recordSyncError(err) }
  }
  if (naverConfigured()) {
    try { console.log("naver sync", await syncNaverOrders()) } catch (err) { console.error("naver sync", err) }
  }
  // 행운프레시(B2B)에 넣은 주문의 결제 상태·송장 가져오기 → 쿠팡·네이버에 송장 등록
  try { console.log("lucky sync", await syncLuckyOrders()) } catch (err) { console.error("lucky sync", err) }
  // 인스타 업로드는 30초 넘게 걸려서 백그라운드 작업으로 넘긴다
  try { await fetch((Netlify.env.get("URL") || "https://volqavo.com") + "/.netlify/functions/insta-publish-background", { method: "POST", headers: { "x-internal": internalKey() }, body: "{}" }) } catch (err) { console.error("insta publish", err) }
  // 고객 문의 수집 + AI 답변 초안 (시간이 걸려서 백그라운드 작업으로 넘긴다)
  try {
    const base = Netlify.env.get("URL") || "https://volqavo.com"
    await fetch(base + "/.netlify/functions/inquiry-sync-background", { method: "POST", headers: { "x-internal": internalKey() }, body: "{}" })
  } catch (err) { console.error("inquiry trigger", err) }
}

export const config: Config = {
  schedule: "*/30 * * * *",
}
