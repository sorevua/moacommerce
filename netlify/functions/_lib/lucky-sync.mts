// 행운프레시에 넣은 주문의 결제 상태·송장을 가져와 주문에 반영하고, 송장은 쿠팡·네이버에 올린다
import { getStore } from "@netlify/blobs"
import { luckyConfigured, luckyRecentOrders, LUCKY_COURIER } from "./luckyfresh.mts"
import { registerInvoice } from "./invoice.mts"

export async function syncLuckyOrders() {
  if (!luckyConfigured()) return { skipped: "not configured" }
  const orders = getStore({ name: "admin-orders", consistency: "strong" })
  const { blobs } = await orders.list()
  const all: any[] = (await Promise.all(blobs.map((b) => orders.get(b.key, { type: "json" })))).filter(Boolean)
  const open = all.filter((o) => o.lucky?.orderIds?.length && !o.invoice && o.status !== "취소")
  if (!open.length) return { open: 0 } // 기다리는 주문이 없으면 부르지 않는다 (일 50회 제한)
  const lines = await luckyRecentOrders()
  let shipped = 0, updated = 0
  const errors: string[] = []
  for (const o of open) {
    const mine = lines.filter((l) => l.userOrderNumber === o.id || (o.lucky.orderIds || []).includes(l.id))
    if (!mine.length) continue
    const l = mine.find((x) => x.trackingNumber) || mine[0]
    const prev = JSON.stringify([o.lucky.status, o.lucky.paymentStatus])
    o.lucky.status = l.status; o.lucky.paymentStatus = l.paymentStatus; o.lucky.checkedAt = new Date().toISOString()
    if (JSON.stringify([o.lucky.status, o.lucky.paymentStatus]) !== prev) { o.updatedAt = new Date().toISOString(); await orders.setJSON(o.id, o); updated++ }
    if (l.trackingNumber) {
      const code = LUCKY_COURIER[String(l.courier || "").replace(/\s/g, "")]
      if (!code) { o.lucky.trackingNote = `송장 ${l.courier} ${l.trackingNumber} — 택배사를 자동으로 못 맞췄습니다. 직접 등록해 주세요.`; await orders.setJSON(o.id, o); errors.push(o.id + ": 택배사 " + l.courier); continue }
      const r = await registerInvoice(o.id, code, String(l.trackingNumber)).catch((e) => ({ error: String(e?.message || e) }))
      if ((r as any).error) { const cur: any = await orders.get(o.id, { type: "json" }); if (cur) { cur.lucky = { ...cur.lucky, trackingNote: `송장 ${l.courier} ${l.trackingNumber} — 자동 등록 실패: ${(r as any).error}` }; await orders.setJSON(o.id, cur) } errors.push(o.id + ": " + (r as any).error) }
      else shipped++
    }
  }
  return { open: open.length, updated, shipped, errors }
}
