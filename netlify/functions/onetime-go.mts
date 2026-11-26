// 임시 (2026-11-26): 알타리무 쿠팡 신규 등록. 끝나면 지운다.
import { getStore } from "@netlify/blobs"
import { internalKey } from "./_lib/auth.mts"
import { luckyProducts } from "./_lib/luckyfresh.mts"
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
    if (a === "creg") {
      const p = ((await luckyProducts(true)).data?.products || []).find((x: any) => /알타리/.test(x.name)); if (!p) throw new Error("행운 목록에 알타리무 없음")
      out.p = { id: p.id, name: p.name, already: !!reg.done[p.id]?.ok, opts: (p.options || []).map((o: any) => `${o.name} ${o.prefixName || ""}|${o.price}+${o.shippingFee}|${o.status}`) }
      if (!out.p.already) out.started = await bg("lucky-register-background", {
        retry: true, batch: 1, productIds: [p.id], noRemote: [p.id],
        rename: { [p.id]: [["5단\\s*$", "5단 11.5kg내외 (1단 2.3kg내외)"], ["3단\\s*$", "3단 6.9kg내외 (1단 2.3kg내외)"], ["2단\\s*$", "2단 4.6kg내외 (1단 2.3kg내외)"], ["1단\\s*$", "1단 2.3kg내외"]] },
        parts: { [p.id]: [{ suffix: "A", name: "국내산 알타리무 총각무 김장용 총각김치 2.3kg", match: ".", main: "썸네일", facts: "국내산 알타리무(총각무). 1단 2.3kg 내외. 총각김치·김장용. 제주·도서산간 배송 불가.", files: [{ id: "1Ix8kkYyYZ3mP8kfvD1QkGHA4I5bkHcT5", name: "알타리무 썸네일.png" }, { id: "1UiIGBg8ze7PK-qy_fPbjyA_tsiJx_jIH", name: "알타리무_상세.jpg" }] }] },
        templateId: "16419735114", requestApproval: true, shipDays: 1, outboundShippingPlaceCode: 25572192, returnCenterCode: "1002729419", deliveryCompanyCode: "CJGLS" })
    }
    if (a === "cst") { out.running = reg.running; out.error = reg.error; out.items = Object.values<any>(reg.done).filter((d) => /알타리/.test(String(d.name))) }
    if (a === "ship") out.started = await bg("lucky-register-background", { mode: "ship", shipDays: 1, notice: NOTICE, only: (u.searchParams.get("sp") || "").split(",") })
  } catch (e: any) { out.err = String(e?.message || e).slice(0, 400) }
  return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json; charset=utf-8" } })
}
