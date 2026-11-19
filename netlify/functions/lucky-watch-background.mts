// 행운프레시 공급 상태를 보고 쿠팡 판매를 자동으로 멈추고·되살린다.
//  - 행운프레시에서 일시품절되거나 목록에서 사라진 옵션(시즌 종료 포함) → 쿠팡 판매중지 (삭제하지 않음)
//  - 다시 판매중이 되면 → 자동으로 멈췄던 것만 판매재개
//  - 공급가가 오르면 → 마진이 지켜지도록 판매가를 올림 (내리지는 않음)
import { getStore } from "@netlify/blobs"
import { isLoggedIn, isInternal } from "./_lib/auth.mts"
import { luckyConfigured, luckyProducts } from "./_lib/luckyfresh.mts"
import { coupangConfigured, stopSale, resumeSale, changePrice } from "./_lib/coupang.mts"

const settings = () => getStore({ name: "admin-settings", consistency: "strong" })
const vendors = () => getStore({ name: "admin-vendors", consistency: "strong" })
function priceOf(supply: number, s: any) {
  const d = { marginRate: 0.15, extraShipping: 0, coupangFee: 0.106, naverSalesFee: 0.0273, naverPayFee: 0.033, vatOnFee: 0.1, roundUnit: 100, sameMarketPrice: 1, ...(s || {}) }
  const cost = supply + Number(d.extraShipping || 0), unit = Number(d.roundUnit || 100), up = (x: number) => Math.ceil(x / unit) * unit
  const cp = up(cost / (1 - d.coupangFee * (1 + d.vatOnFee) - d.marginRate)), np = up(cost / (1 - (d.naverSalesFee + d.naverPayFee) * (1 + d.vatOnFee) - d.marginRate))
  return Number(d.sameMarketPrice) ? Math.max(cp, np) : cp
}
const okRes = (r: any) => !r || /SUCCESS/i.test(String(r.code || "")) || r.code === 200 || r.code === "200"

export default async (req: Request) => {
  if (!isLoggedIn(req) && !isInternal(req)) return
  if (!luckyConfigured() || !coupangConfigured()) return
  const report: any = { at: new Date().toISOString(), stopped: [], resumed: [], raised: [], errors: [] }
  try {
    const plist: any[] = (await luckyProducts(true)).data?.products || []
    if (plist.length < 5) throw new Error("행운프레시 상품 목록이 비정상적으로 적습니다(" + plist.length + "개). 잘못 멈추지 않도록 이번에는 아무것도 바꾸지 않습니다.")
    const by = new Map<string, any>(); for (const p of plist) for (const o of p.options || []) by.set(o.id, o)
    const cfg: any = await settings().get("settings", { type: "json" })
    const { blobs } = await vendors().list()
    const v: any = (await Promise.all(blobs.map((b) => vendors().get(b.key, { type: "json" })))).filter(Boolean).find((x: any) => x.lucky)
    if (!v) return
    let calls = 0
    for (const x of v.products || []) {
      if (!x.luckyOptionId || !x.coupangItemId) continue
      if (calls >= 100) { report.errors.push("한 번에 바꿀 수 있는 수(100)를 넘어 나머지는 다음 점검 때 처리합니다."); break }
      const o = by.get(x.luckyOptionId), soldOut = !o || o.status !== "판매중"
      try {
        if (soldOut && !x.autoStopped) {
          const r: any = await stopSale(String(x.coupangItemId)); calls++
          if (!okRes(r)) throw new Error("판매중지 실패: " + JSON.stringify(r).slice(0, 120))
          x.autoStopped = true; x.autoStoppedAt = report.at; x.luckySoldOut = true
          report.stopped.push(`${x.name} (${o ? "일시품절" : "공급 목록에서 사라짐"})`)
        } else if (!soldOut && x.autoStopped) {
          const r: any = await resumeSale(String(x.coupangItemId)); calls++
          if (!okRes(r)) throw new Error("판매재개 실패: " + JSON.stringify(r).slice(0, 120))
          x.autoStopped = false; x.luckySoldOut = false
          report.resumed.push(x.name)
        }
        if (o) {
          const supply = Number(o.price) + Number(o.shippingFee || 0)
          if (supply > Number(x.supplyPrice || 0) && !soldOut) {
            const np = priceOf(supply, cfg)
            const r: any = await changePrice(String(x.coupangItemId), np); calls++
            if (!okRes(r)) throw new Error("가격 변경 실패: " + JSON.stringify(r).slice(0, 120))
            report.raised.push(`${x.name}: 공급가 ${x.supplyPrice} → ${supply}, 판매가 ${np}`)
          } else if (supply < Number(x.supplyPrice || 0) && !soldOut) {
            // 2026-11-19: 공급가가 내리면 같은 마진으로 판매가도 내린다 (가격 경쟁력)
            const np = priceOf(supply, cfg)
            const r: any = await changePrice(String(x.coupangItemId), np); calls++
            if (!okRes(r)) throw new Error("가격 변경 실패: " + JSON.stringify(r).slice(0, 120))
            report.raised.push(`${x.name}: 공급가 ${x.supplyPrice} → ${supply} (인하), 판매가 ${np}`)
          }
          x.supplyPrice = supply
        }
      } catch (e: any) { report.errors.push(`${x.name}: ${String(e?.message || e).slice(0, 160)}`) }
    }
    v.updatedAt = report.at; await vendors().setJSON(v.id, v)
  } catch (e: any) { report.errors.push(String(e?.message || e)) }
  const log: any[] = ((await settings().get("lucky-watch", { type: "json" })) as any[]) || []
  if (report.stopped.length || report.resumed.length || report.raised.length || report.errors.length) log.unshift(report)
  await settings().setJSON("lucky-watch", log.slice(0, 60))
  await settings().setJSON("lucky-watch-last", { at: report.at, stopped: report.stopped.length, resumed: report.resumed.length, raised: report.raised.length, errors: report.errors.length })
}
