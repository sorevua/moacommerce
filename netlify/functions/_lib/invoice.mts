// 송장 등록 (쿠팡·네이버 주문이면 마켓에도 올린다) — 관리자 화면과 자동 수집이 같이 쓴다
import { getStore } from "@netlify/blobs"
import { coupangConfigured, acknowledge, uploadInvoice, COURIERS } from "./coupang.mts"
import { naverConfigured, naverConfirm, naverDispatch } from "./naver.mts"

const orders = () => getStore({ name: "admin-orders", consistency: "strong" })

export async function registerInvoice(orderId: string, courier: string, invoiceNumber: string): Promise<{ error?: string; order?: any }> {
  const o: any = await orders().get(orderId, { type: "json" })
  if (!o) return { error: "주문을 찾을 수 없습니다." }
  const num = String(invoiceNumber || "").replace(/\D/g, "")
  if (!courier || !num) return { error: "택배사와 송장번호를 입력하세요." }
  if (o.market?.name === "coupang") {
    if (!coupangConfigured()) return { error: "쿠팡 API 키가 아직 설정되지 않았습니다." }
    if (!o.market.acknowledged) {
      const a = await acknowledge([o.market.shipmentBoxId])
      const r = a?.data?.responseList?.[0]
      if (r && !r.succeed && !/INSTRUCT|상품준비중/.test(String(r.resultMessage || ""))) return { error: "쿠팡 상품준비중 처리 실패: " + (r.resultMessage || r.resultCode) }
      o.market.acknowledged = true
    }
    const up = await uploadInvoice([{ shipmentBoxId: o.market.shipmentBoxId, orderId: o.market.orderId, vendorItemId: o.market.vendorItemId, courier, invoiceNumber: num }])
    const r = up?.data?.responseList?.[0]
    if (!r?.succeed) return { error: "쿠팡 송장 등록 실패: " + (r?.resultMessage || r?.resultCode || up?.data?.responseMessage || "알 수 없음") }
  }
  if (o.market?.name === "naver") {
    if (!naverConfigured()) return { error: "네이버 API 키가 아직 설정되지 않았습니다." }
    if (!o.market.acknowledged) { await naverConfirm([o.market.productOrderId]).catch(() => null); o.market.acknowledged = true }
    const up: any = await naverDispatch(o.market.productOrderId, courier, num)
    const fail = up?.data?.failProductOrderInfos?.[0]
    if (fail) return { error: "네이버 송장 등록 실패: " + (fail.message || fail.code || "알 수 없음") }
  }
  o.invoice = { courier, courierName: COURIERS[courier] || courier, number: num, at: new Date().toISOString() }
  o.status = "발송"
  o.updatedAt = new Date().toISOString()
  await orders().setJSON(o.id, o)
  return { order: o }
}
