// 임시 (2026-11-27): 행운 공지 반영 — 콜라비 신규, 흑대추방울토마토 이름 변경, 남해 보물초 단가 인상(점검). 끝나면 지운다.
import { getStore } from "@netlify/blobs"
import { internalKey } from "./_lib/auth.mts"
import { luckyProducts } from "./_lib/luckyfresh.mts"
import { getProduct, call } from "./_lib/coupang.mts"
const NOTICE = "[출고 안내]\n평일 오전 7시까지 주문하신 상품은 당일 출고됩니다.\n오전 7시 이후 주문은 다음 영업일에 출고됩니다.\n토·일·공휴일 주문은 다음 영업일에 출고됩니다.\n산지 수확·날씨 사정으로 출고가 하루 늦어질 수 있습니다."
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
      const ps = ((await luckyProducts(true)).data?.products || []).filter((p: any) => /콜라비|흑대추|보물초|키위/.test(p.name))
      out.ps = ps.map((p: any) => ({ id: p.id, name: p.name, reg: reg.done[p.id] ? { ok: reg.done[p.id].ok, sp: reg.done[p.id].sellerProductIds || reg.done[p.id].sellerProductId } : null, opts: (p.options || []).map((o: any) => `${o.name} ${o.prefixName || ""}|${o.price}+${o.shippingFee}|${o.status}`) }))
    }
    if (a === "creg") {
      const p = ((await luckyProducts(true)).data?.products || []).find((x: any) => /콜라비/.test(x.name)); if (!p) throw new Error("콜라비 없음")
      if (reg.done[p.id]?.ok) return Response.json({ already: reg.done[p.id] })
      out.started = await bg("lucky-register-background", { retry: true, batch: 1, productIds: [p.id], noRemote: [p.id],
        parts: { [p.id]: [{ suffix: "A", name: "제주 햇콜라비 정품 로얄과", match: ".", main: "썸네일", facts: "제주 서귀포산 콜라비. 2026년 11월부터 수확한 햇콜라비. 정품 로얄과, 개당 400~800g. 제주·도서산간 배송 불가.", files: [{ id: "14FXNW4ptShfFX66oVtteJFlF19_mZS4u", name: "콜라비 썸네일.png" }, { id: "1FdpF04TgVfIDJYLHIybFXFiQPu87thXw", name: "제주_콜라비_상세.jpg" }] }] },
        templateId: "16419735114", requestApproval: true, shipDays: 1, outboundShippingPlaceCode: 25572192, returnCenterCode: "1002729419", deliveryCompanyCode: "CJGLS" })
    }
    if (a === "cst") { out.running = reg.running; out.error = reg.error; out.items = Object.values<any>(reg.done).filter((d) => /콜라비/.test(String(d.name))) }
    if (a === "ship") out.started = await bg("lucky-register-background", { mode: "ship", shipDays: 1, notice: NOTICE })
    if (a === "tom") {
      const d: any = Object.values<any>(reg.done).find((x) => x.ok && /흑대추/.test(String(x.name))); if (!d) throw new Error("흑대추 등록 정보 없음")
      out.res = []
      for (const sp of (d.sellerProductIds?.length ? d.sellerProductIds : [d.sellerProductId]).map(String)) {
        const p: any = await getProduct(sp); const from = String(p.sellerProductName)
        if (/GAP/.test(from)) { out.res.push(`${sp}: 이미 GAP 포함 (${from})`); continue }
        const to = /흑대추방울토마토/.test(from) ? from.replace("흑대추방울토마토", "GAP인증 흑대추방울토마토") : `GAP인증 ${from}`
        const np = JSON.parse(JSON.stringify(p).split(JSON.stringify(from).slice(1, -1)).join(JSON.stringify(to).slice(1, -1))); np.requested = true
        const r: any = await call("PUT", "/v2/providers/seller_api/apis/api/v1/marketplace/seller-products", "", np)
        out.res.push(`${sp}: ${from} → ${to} (${String(r?.code || r?.message).slice(0, 80)})`)
      }
    }
    if (a === "watch") out.started = await bg("lucky-watch-background", {})
    if (a === "wlog") out.last = ((await st.get("lucky-watch", { type: "json" })) || [])[0]
  } catch (e: any) { out.err = String(e?.message || e).slice(0, 400) }
  return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json; charset=utf-8" } })
}
