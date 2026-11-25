// 행운 상품 쿠팡 판매가 점검 (2026-11-25 사장님 요청: 손해는 절대 안 됨)
//  - 쿠팡의 지금 판매가(자동가격조정으로 내려간 값 포함)를 옵션마다 읽는다
//  - 공급가 기준 마진 15% 판매가보다 낮으면 그 가격으로 올린다. 높은 가격은 건드리지 않는다 (내리지 않음)
import { getStore } from "@netlify/blobs"
import { isInternal, isLoggedIn } from "./_lib/auth.mts"
import { getInventory, changePrice } from "./_lib/coupang.mts"
const settings = () => getStore({ name: "admin-settings", consistency: "strong" })
const vendors = () => getStore({ name: "admin-vendors", consistency: "strong" })
function priceOf(supply: number, s: any) {
  const d = { marginRate: 0.15, extraShipping: 0, coupangFee: 0.106, naverSalesFee: 0.0273, naverPayFee: 0.033, vatOnFee: 0.1, roundUnit: 100, sameMarketPrice: 1, ...(s || {}) }
  const cost = supply + Number(d.extraShipping || 0), unit = Number(d.roundUnit || 100), up = (x: number) => Math.ceil(x / unit) * unit
  const cp = up(cost / (1 - d.coupangFee * (1 + d.vatOnFee) - d.marginRate)), np = up(cost / (1 - (d.naverSalesFee + d.naverPayFee) * (1 + d.vatOnFee) - d.marginRate))
  return Number(d.sameMarketPrice) ? Math.max(cp, np) : cp
}
export default async (req: Request) => {
  if (!isInternal(req) && !isLoggedIn(req)) return
  const cfg: any = await settings().get("settings", { type: "json" })
  const { blobs } = await vendors().list()
  const v: any = (await Promise.all(blobs.map((b) => vendors().get(b.key, { type: "json" })))).filter(Boolean).find((x: any) => x.lucky)
  const rp: any = (await settings().get("lucky-price-audit", { type: "json" })) || {}
  // 이어서 하기: 같은 날 이미 본 옵션은 건너뛴다
  const day = new Date().toISOString().slice(0, 10)
  const seen: Record<string, number> = rp.day === day ? rp.seen || {} : {}
  const out: any = { day, seen, running: true, raised: rp.day === day ? rp.raised || [] : [], loss: rp.day === day ? rp.loss || [] : [], errors: [] }
  await settings().setJSON("lucky-price-audit", out)
  const started = Date.now()
  const list = (v?.products || []).filter((x: any) => x.coupangItemId && !x.autoStopped && !x.luckySoldOut && Number(x.supplyPrice) > 0 && !seen[x.coupangItemId])
  let i = 0
  const work = async () => {
    while (i < list.length && Date.now() - started < 12.5 * 60e3) {
      const x = list[i++]
      try {
        const inv: any = await getInventory(String(x.coupangItemId))
        const cur = Number(inv?.salePrice || 0), need = priceOf(Number(x.supplyPrice), cfg)
        if (!cur) throw new Error("판매가를 읽지 못함")
        if (cur < need) {
          // 수수료(부가세 포함)를 떼고 공급가보다 적게 남으면 '손해'
          const net = cur * (1 - 0.106 * 1.1) - Number(x.supplyPrice)
          await changePrice(String(x.coupangItemId), need)
          const line = `${x.name}: 공급가 ${x.supplyPrice}, 판매가 ${cur} → ${need}`
          out.raised.push(line); if (net < 0) out.loss.push(`${line} (팔 때마다 ${Math.round(-net)}원 손해였음)`)
        }
        seen[x.coupangItemId] = cur
      } catch (e: any) { out.errors.push(`${x.name}: ${String(e?.message || e).slice(0, 120)}`) }
      if (i % 20 === 0) await settings().setJSON("lucky-price-audit", out)
    }
  }
  await Promise.all([work(), work(), work()])
  out.running = false; out.left = list.length - i; out.total = (v?.products || []).filter((x: any) => x.coupangItemId).length; out.finished = new Date().toISOString()
  await settings().setJSON("lucky-price-audit", out)
}
