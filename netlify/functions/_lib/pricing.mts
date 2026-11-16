// 가격 엔진: 시장가 조사(AI 웹 검색) → 최소 마진을 지키는 범위에서 자동으로 가격을 내린다
import { getStore } from "@netlify/blobs"
import Anthropic from "@anthropic-ai/sdk"
import { aiCreate } from "./ai.mts"
import { getInventory, changePrice, coupangConfigured } from "./coupang.mts"
import { ncall, naverConfigured } from "./naver.mts"

const S = () => getStore({ name: "admin-settings", consistency: "strong" })
const V = () => getStore({ name: "admin-vendors", consistency: "strong" })
const up100 = (x: number) => Math.ceil(x / 100) * 100
const dn100 = (x: number) => Math.floor(x / 100) * 100
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }

export const PRICE_DEFAULT = { auto: true, minMargin: 0.1, undercut: 0.03, maxDropPerRun: 0.1, minSamples: 3 }
export async function priceConfig() { return { ...PRICE_DEFAULT, ...(((await S().get("price-config", { type: "json" })) as any) || {}) } }

// 한 상품의 시장가 조사
async function research(client: any, vendor: string, product: string) {
  const msg: any = await aiCreate(client, {
    model: process.env.AI_MODEL || "claude-sonnet-5-5", max_tokens: 3000,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
    system: `한국 온라인 과일 시세 조사원입니다. 웹 검색으로 지금 쿠팡·네이버 스마트스토어·기타 오픈마켓에서 팔리는 같은 품종·같은 중량·비슷한 등급 상품의 판매가(배송비 포함 기준)를 찾습니다.
규칙: 검색 결과에 실제로 보이는 가격만 적는다. 추측·평균 추정 금지. 중량이 다르면 넣지 않는다(±10%까지만). 도매·경매 시세, 1년 넘은 글, 품절 상품 제외. 못 찾으면 빈 목록.
마지막에 아래 JSON만 출력: {"items":[{"seller":"판매처","market":"쿠팡|네이버|기타","price":숫자(원),"kg":숫자,"shippingIncluded":true|false,"url":"출처"}],"note":"한 줄 메모"}`,
    messages: [{ role: "user", content: `상품: ${product}\n(공급 농가: ${vendor})\n이 상품과 같은 품종·중량·등급의 현재 온라인 판매가를 조사해 주세요.` }],
  })
  const text = msg.content.map((b: any) => (b.type === "text" ? b.text : "")).join("")
  const m = text.match(/\{[\s\S]*"items"[\s\S]*\}\s*$/) || text.match(/\{[\s\S]*"items"[\s\S]*\}/)
  let j: any = { items: [], note: "" }
  try { if (m) j = JSON.parse(m[0]) } catch {}
  const items = (j.items || []).map((x: any) => ({ seller: String(x.seller || "").slice(0, 40), market: String(x.market || ""), price: Number(x.price) || 0, kg: Number(x.kg) || 0, url: /^https?:\/\//.test(String(x.url || "")) ? String(x.url) : "" })).filter((x: any) => x.price >= 3000 && x.price <= 500000)
  return { items, note: String(j.note || "").slice(0, 200) }
}

async function naverIndex() {
  // 옵션코드 → { 원상품번호, 현재가 }
  const map = new Map<string, { no: string; price: number }>()
  const prods = new Map<string, any>()
  for (let page = 1; page <= 5; page++) {
    const r: any = await ncall("POST", "/v1/products/search", "", { page, size: 50 })
    for (const c of r?.contents || []) {
      const no = String(c.originProductNo)
      if (!(c.channelProducts || []).some((ch: any) => ch.statusType === "SALE")) continue
      const g: any = await ncall("GET", `/v2/products/origin-products/${no}`)
      prods.set(no, g)
      for (const o of g?.originProduct?.detailAttribute?.optionInfo?.optionCombinations || []) map.set(String(o.id), { no, price: Number(g.originProduct.salePrice) + Number(o.price || 0) })
    }
    if (!r?.contents?.length || page >= (r.totalPages || 1)) break
  }
  return { map, prods }
}

export async function runPricing() {
  const cfg = await priceConfig()
  const set: any = (await S().get("settings", { type: "json" })) || {}
  const vat = 1 + Number(set.vatOnFee ?? 0.1)
  const cpFee = Number(set.coupangFee ?? 0.106) * vat
  const nvFee = (Number(set.naverSalesFee ?? 0.0273) + Number(set.naverPayFee ?? 0.033)) * vat
  const report: any = { at: new Date().toISOString(), running: true, cfg, rows: [] as any[], changes: [] as string[], errors: [] as string[] }
  const save = () => S().setJSON("price-report", report)
  await save()
  const client = new Anthropic()
  const nv = naverConfigured() ? await naverIndex().catch((e: any) => { report.errors.push("네이버 상품 조회: " + String(e?.message || e).slice(0, 150)); return null }) : null
  const nvNew = new Map<string, number>() // 옵션코드 → 새 가격
  const { blobs } = await V().list()
  for (const b of blobs) {
    const v: any = await V().get(b.key, { type: "json" })
    if (!v || v.status === "중지") continue
    for (const p of v.products || []) {
      const supply = Number(p.supplyPrice || 0)
      if (!supply || (!p.coupangItemId && !p.naverItemId)) continue
      const row: any = { vendor: v.name, product: p.name, supply, floorCp: up100(supply / (1 - cpFee - cfg.minMargin)), floorNv: up100(supply / (1 - nvFee - cfg.minMargin)) }
      try {
        const r = await research(client, v.name, p.name)
        const prices = r.items.map((x: any) => x.price)
        row.samples = r.items; row.note = r.note; row.n = prices.length
        if (prices.length) { row.marketMedian = Math.round(median(prices)); row.marketMin = Math.min(...prices) }
      } catch (e: any) { row.note = "조사 실패: " + String(e?.message || e).slice(0, 120) }
      const decide = (cur: number, floor: number) => {
        if (!cur) return { cur, action: "현재가 모름" }
        if (cur < floor) return { cur, action: `⚠ 현재가가 최소마진가(${floor.toLocaleString()}원)보다 낮음 — 올려야 함`, suggest: floor }
        if (!row.marketMedian || row.n < cfg.minSamples) return { cur, action: "비교 자료 부족 — 유지" }
        const want = dn100(row.marketMedian * (1 - cfg.undercut))
        if (want >= cur) return { cur, action: cur <= row.marketMedian ? "시장가 이하 — 유지" : "유지", suggest: want > cur * 1.03 ? want : undefined }
        const target = Math.max(floor, want, up100(cur * (1 - cfg.maxDropPerRun)))
        if (target >= cur || (cur - target) / cur < 0.02) return { cur, action: floor >= cur ? "최소마진가에 도달 — 더 못 내림 (공급가 협의 필요)" : "차이 2% 미만 — 유지" }
        return { cur, target, action: `인하 ${cur.toLocaleString()} → ${target.toLocaleString()}원` }
      }
      if (p.coupangItemId && coupangConfigured()) {
        const inv: any = await getInventory(String(p.coupangItemId)).catch(() => null)
        row.cp = decide(Number(inv?.salePrice || 0), row.floorCp)
        if (row.cp.target && cfg.auto) {
          try { await changePrice(String(p.coupangItemId), row.cp.target); row.cp.applied = true; report.changes.push(`쿠팡 ${p.name}: ${row.cp.cur.toLocaleString()} → ${row.cp.target.toLocaleString()}원`) } catch (e: any) { row.cp.error = String(e?.message || e).slice(0, 150) }
        }
      }
      if (p.naverItemId && nv) {
        const cur = nv.map.get(String(p.naverItemId))
        row.nv = decide(Number(cur?.price || 0), row.floorNv)
        if (row.nv.target && cfg.auto && cur) nvNew.set(String(p.naverItemId), row.nv.target)
        row.nvId = String(p.naverItemId)
      }
      report.rows.push(row); await save()
    }
  }
  // 네이버: 상품 단위로 묶어서 한 번에 수정 (옵션가는 기준가의 ±50% 안)
  if (nv && nvNew.size) {
    for (const [no, g] of nv.prods) {
      const op = g.originProduct, combos: any[] = op.detailAttribute?.optionInfo?.optionCombinations || []
      if (!combos.some((c) => nvNew.has(String(c.id)))) continue
      const abs = combos.map((c) => nvNew.get(String(c.id)) ?? Number(op.salePrice) + Number(c.price || 0))
      const baseIdx = Math.max(0, combos.findIndex((c) => Number(c.price || 0) === 0))
      const base = abs[baseIdx]
      const rows = report.rows.filter((r: any) => combos.some((c) => String(c.id) === r.nvId) && r.nv?.target)
      if (abs.some((a) => Math.abs(a - base) > base * 0.5)) { for (const r of rows) r.nv.error = "옵션가 범위(±50%) 초과로 보류"; continue }
      op.salePrice = base; combos.forEach((c, i) => (c.price = abs[i] - base))
      try {
        await ncall("PUT", `/v2/products/origin-products/${no}`, "", { originProduct: op, smartstoreChannelProduct: g.smartstoreChannelProduct })
        for (const r of rows) { r.nv.applied = true; report.changes.push(`네이버 ${r.product}: ${r.nv.cur.toLocaleString()} → ${r.nv.target.toLocaleString()}원`) }
      } catch (e: any) { for (const r of rows) r.nv.error = String(e?.message || e).slice(0, 150) }
    }
  }
  report.running = false
  await save()
  // 변경 기록 (최근 200건)
  if (report.changes.length) {
    const log: any[] = ((await S().get("price-log", { type: "json" })) as any) || []
    await S().setJSON("price-log", [...report.changes.map((c: string) => ({ at: report.at, text: c })), ...log].slice(0, 200))
  }
  return report
}
