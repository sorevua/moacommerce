// 임시 (2026-11-26): 청무화과 재오픈 반영(등록 또는 판매재개) + 곶감 4개 상품명 변경. 끝나면 지운다.
import { getStore } from "@netlify/blobs"
import { internalKey } from "./_lib/auth.mts"
import { luckyProducts } from "./_lib/luckyfresh.mts"
import { getProduct, call } from "./_lib/coupang.mts"
const NOTICE = "[출고 안내]\n평일 오전 7시까지 주문하신 상품은 당일 출고됩니다.\n오전 7시 이후 주문은 다음 영업일에 출고됩니다.\n토·일·공휴일 주문은 다음 영업일에 출고됩니다.\n산지 수확·날씨 사정으로 출고가 하루 늦어질 수 있습니다."
const RENAME: Record<string, string> = {
  "청도 반건시 곶감 선물세트 1+1": "청도 반건시 곶감 선물세트 1+1 2상자",
  "청도 반건시 곶감 선물세트": "청도 반건시 곶감 선물세트 1상자",
  "영동 대봉곶감 반건시 선물세트": "영동 대봉 반건시 곶감 선물세트",
  "실속형 봉지 곶감": "실속형 봉지 곶감 가정용",
}
export default async (req: Request) => {
  const u = new URL(req.url)
  const tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || u.searchParams.get("t") !== tok) return new Response("no", { status: 404 })
  const st = getStore({ name: "admin-settings", consistency: "strong" })
  const a = u.searchParams.get("a"), out: any = {}
  const bg = (fn: string, body: any) => fetch(`${u.origin}/.netlify/functions/${fn}`, { method: "POST", headers: { "x-internal": internalKey(), "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.status)
  try {
    const reg: any = (await st.get("lucky-reg", { type: "json" })) || { done: {} }
    if (a === "lk") {
      const ps = ((await luckyProducts(true)).data?.products || []).filter((p: any) => /청무화과/.test(p.name))
      out.fig = ps.map((p: any) => ({ id: p.id, name: p.name, reg: reg.done[p.id] ? { ok: reg.done[p.id].ok, sp: reg.done[p.id].sellerProductIds || reg.done[p.id].sellerProductId, err: reg.done[p.id].error } : null, opts: (p.options || []).map((o: any) => `${o.name} ${o.prefixName || ""}|${o.price}+${o.shippingFee}|${o.status}`) }))
      out.gam = Object.entries<any>(reg.done).filter(([, d]) => /곶감/.test(String(d.name))).map(([id, d]) => ({ id, name: d.name, sp: d.sellerProductIds || d.sellerProductId, parts: d.parts }))
    }
    if (a === "creg") {
      const id = u.searchParams.get("id") || ""
      out.started = await bg("lucky-register-background", { retry: true, batch: 1, productIds: [id], parts: { [id]: [{ suffix: "A", name: "프리미엄 청무화과", match: ".", files: [{ id: "1YGsnVQC9fXiMe1os8-eAEtF-QqPJIO6t", name: "청무화과 썸네일.png" }, { id: "1bTxG1k6s0V1-3U3o_lp4Ivz95otF9gjA", name: "청무화과 상세페이지.png" }], main: "썸네일" }] }, templateId: "16419735114", requestApproval: true, shipDays: 1, outboundShippingPlaceCode: 25572192, returnCenterCode: "1002729419", deliveryCompanyCode: "CJGLS" })
    }
    if (a === "cst") { out.running = reg.running; out.error = reg.error; out.items = Object.values<any>(reg.done).filter((d) => /청무화과/.test(String(d.name))) }
    if (a === "ship") out.started = await bg("lucky-register-background", { mode: "ship", shipDays: 1, notice: NOTICE, only: (u.searchParams.get("sp") || "").split(",") })
    if (a === "watch") out.started = await bg("lucky-watch-background", {})
    if (a === "wlog") out.last = ((await st.get("lucky-watch", { type: "json" })) || [])[0]
    if (a === "rename") {
      out.res = []
      for (const sp of (u.searchParams.get("sp") || "").split(",").filter(Boolean)) {
        try {
          const p: any = await getProduct(sp); const from = String(p.sellerProductName), to = RENAME[from]
          if (!to) { out.res.push(`${sp}: 건너뜀 (지금 이름: ${from})`); continue }
          const np = JSON.parse(JSON.stringify(p).split(JSON.stringify(from).slice(1, -1)).join(JSON.stringify(to).slice(1, -1)))
          np.requested = true
          const r: any = await call("PUT", "/v2/providers/seller_api/apis/api/v1/marketplace/seller-products", "", np)
          out.res.push(`${sp}: ${from} → ${to} (${String(r?.code || r?.message).slice(0, 80)})`)
        } catch (e: any) { out.res.push(`${sp}: 실패 ${String(e?.message || e).slice(0, 150)}`) }
      }
    }
  } catch (e: any) { out.err = String(e?.message || e).slice(0, 400) }
  return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json; charset=utf-8" } })
}
