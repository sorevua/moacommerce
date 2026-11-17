import type { Config } from "@netlify/functions"
import { coupangConfigured, syncCoupangOrders, recordSyncError } from "./_lib/coupang.mts"
import { naverConfigured, syncNaverOrders } from "./_lib/naver.mts"
import { internalKey } from "./_lib/auth.mts"
import { syncLuckyOrders } from "./_lib/lucky-sync.mts"

// 30분마다 쿠팡·네이버 결제완료 주문을 가져온다 (Make 중계 사용량 절약을 위해 30분 간격)
// Make 중계는 호출 1번에 3크레딧을 쓴다 (월 한도 10,000). 30분마다 전부 돌리면 한도를 넘어서 중계가 멈춘다.
// → 주문 수집: 아침(06~10시)에는 30분마다, 그 밖에는 3시간마다. 문의 수집: 하루 3번(7·13·19시).
export default async () => {
  const k = new Date(Date.now() + 9 * 3600e3), h = k.getUTCHours(), m = k.getUTCMinutes()
  const syncNow = (h >= 6 && h < 10) || (h % 3 === 0 && m < 30)
  const inquiryNow = [7, 13, 19].includes(h) && m < 30
  // 인스타 업로드는 30초 넘게 걸려서 백그라운드 작업으로 넘긴다 (예약 시간이 됐을 때만 실제로 올림)
  try { await fetch((Netlify.env.get("URL") || "https://volqavo.com") + "/.netlify/functions/insta-publish-background", { method: "POST", headers: { "x-internal": internalKey() }, body: "{}" }) } catch (err) { console.error("insta publish", err) }
  if (inquiryNow) {
    try { await fetch((Netlify.env.get("URL") || "https://volqavo.com") + "/.netlify/functions/inquiry-sync-background", { method: "POST", headers: { "x-internal": internalKey() }, body: "{}" }) } catch (err) { console.error("inquiry trigger", err) }
  }
  if (!syncNow) return
  if (coupangConfigured()) {
    try { console.log("coupang sync", await syncCoupangOrders()) } catch (err) { console.error(err); await recordSyncError(err) }
  }
  if (naverConfigured()) {
    try { console.log("naver sync", await syncNaverOrders()) } catch (err) { console.error("naver sync", err) }
  }
  // 행운프레시(B2B)에 넣은 주문의 결제 상태·송장 가져오기 → 쿠팡·네이버에 송장 등록
  try { console.log("lucky sync", await syncLuckyOrders()) } catch (err) { console.error("lucky sync", err) }
}

export const config: Config = {
  schedule: "*/30 * * * *",
}
