import type { Config } from "@netlify/functions"
import { coupangConfigured, syncCoupangOrders, recordSyncError } from "./_lib/coupang.mts"
import { naverConfigured, syncNaverOrders } from "./_lib/naver.mts"
import { internalKey } from "./_lib/auth.mts"
import { getStore } from "@netlify/blobs"
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
  // 예약해 둔 홍보 게시물(/promo/schedule.json): 시간이 되면 한 번만 인스타에 올린다
  try {
    const base = Netlify.env.get("URL") || "https://volqavo.com"
    const list: any[] = await (await fetch(base + "/promo/schedule.json", { headers: { "cache-control": "no-cache" } })).json()
    for (const p of Array.isArray(list) ? list : []) {
      const at = Date.parse(p.at || "")
      if (!p.key || !(at <= Date.now()) || Date.now() - at > 6 * 3600e3) continue // 6시간 넘게 지난 예약은 올리지 않음
      await fetch(base + "/.netlify/functions/promo-post-background", { method: "POST", headers: { "x-internal": internalKey() }, body: JSON.stringify({ key: p.key, files: (p.files || []).map((f: string) => (f.startsWith("http") ? f : base + f)), caption: p.caption }) })
    }
  } catch (err) { console.error("promo schedule", err) }
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
  // 쿠팡에 올린 행운프레시 상품 중 옵션 연결이 안 끝난 것이 있으면(승인 지연·반려 후 재승인) 이어서 연결한다
  try {
    const reg: any = await getStore({ name: "admin-settings", consistency: "strong" }).get("lucky-reg", { type: "json" })
    if (Object.values(reg?.done || {}).some((d: any) => d.ok && !d.linked)) {
      for (const d of Object.values(reg.done) as any[]) if (d.ok && !d.linked) delete d.linkError
      await getStore({ name: "admin-settings", consistency: "strong" }).setJSON("lucky-reg", reg)
      await fetch((Netlify.env.get("URL") || "https://volqavo.com") + "/.netlify/functions/lucky-register-background", { method: "POST", headers: { "x-internal": internalKey() }, body: JSON.stringify({ mode: "link", once: true, shipDays: 2 }) })
    }
  } catch (err) { console.error("lucky link", err) }
  // 행운프레시(B2B)에 넣은 주문의 결제 상태·송장 가져오기 → 쿠팡·네이버에 송장 등록
  try { console.log("lucky sync", await syncLuckyOrders()) } catch (err) { console.error("lucky sync", err) }
}

// 2026-11-25 오너 요청으로 자동 실행 중지(넷리파이 크레딧 절약). 다시 켜려면 아래 주석을 푼다.
// export const config: Config = {
//   schedule: "*/30 * * * *",
// }
