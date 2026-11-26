// 임시 (2026-11-26): 청송 특등급 부사·시나노골드 쿠팡 신규 등록. 끝나면 지운다.
import { getStore } from "@netlify/blobs"
import { internalKey } from "./_lib/auth.mts"
import { luckyProducts } from "./_lib/luckyfresh.mts"
const O = "https://volqavo.com/sb/cs"
const NOTICE = "[출고 안내]\n평일 오전 7시까지 주문하신 상품은 당일 출고됩니다.\n오전 7시 이후 주문은 다음 영업일에 출고됩니다.\n토·일·공휴일 주문은 다음 영업일에 출고됩니다.\n산지 수확·날씨 사정으로 출고가 하루 늦어질 수 있습니다."
const FACT = "경북 청송산. 청송 지역 농협 APC(산지유통센터)에서 직접 선별·포장·출고. 공급처 기준 특등급 선별 상품. 제주·도서산간 배송 불가."
const BU_FILES = [{ id: "1mtv5Hmyppk5ElHvJFG0iQhJnzmCQL83V", name: "청송농협 부사사과 상세페이지.jpg" }]
const SH_FILES = [{ id: "1BuuOjQAi37SNeNG7-wHyaJfHLEayvcsL", name: "청송농협 시나노골드 상세페이지.jpg" }]
const parts = (name: string) => /시나노/.test(name)
  ? [{ suffix: "A", name: "청송 특등급 시나노골드 사과 산지직출고 중대과", match: ".", mainUrl: `${O}/sh-main.jpg`, files: SH_FILES, facts: "시나노골드(노란 사과). " + FACT }]
  : [
    { suffix: "S", name: "청송 특등급 부사사과 산지직출고 중소과", match: "중소과", mainUrl: `${O}/bu-main.jpg`, files: BU_FILES, facts: "부사 사과. " + FACT },
    { suffix: "M", name: "청송 특등급 부사사과 산지직출고 중과", match: "kg\\s*중과", mainUrl: `${O}/bu-main.jpg`, files: BU_FILES, facts: "부사 사과. " + FACT },
    { suffix: "L", name: "청송 특등급 부사사과 산지직출고 중대과", match: "중대과", mainUrl: `${O}/bu-main.jpg`, files: BU_FILES, facts: "부사 사과. " + FACT },
  ]
export default async (req: Request) => {
  const u = new URL(req.url)
  const tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || u.searchParams.get("t") !== tok) return new Response("no", { status: 404 })
  const st = getStore({ name: "admin-settings", consistency: "strong" })
  const a = u.searchParams.get("a"), out: any = {}
  const bg = (fn: string, body: any) => fetch(`${u.origin}/.netlify/functions/${fn}`, { method: "POST", headers: { "x-internal": internalKey(), "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.status)
  try {
    const reg: any = (await st.get("lucky-reg", { type: "json" })) || { done: {} }
    if (a === "names") out.names = ((await luckyProducts(true)).data?.products || []).map((p: any) => p.name).filter((n: string) => /사과|시나노|부사|청송/.test(n))
    if (a === "creg") {
      const ps = ((await luckyProducts(true)).data?.products || []).filter((x: any) => new RegExp(u.searchParams.get("q") || "청송").test(x.name))
      out.ps = ps.map((p: any) => ({ id: p.id, name: p.name, already: !!reg.done[p.id]?.ok, opts: (p.options || []).map((o: any) => `${o.name} ${o.prefixName || ""}|${o.price}+${o.shippingFee}|${o.status}`) }))
      const ids = ps.filter((p: any) => !reg.done[p.id]?.ok).map((p: any) => p.id)
      if (ids.length && u.searchParams.get("go")) out.started = await bg("lucky-register-background", {
        retry: true, batch: 2, productIds: ids, noRemote: ids, parts: Object.fromEntries(ps.map((p: any) => [p.id, parts(p.name)])),
        templateId: "16419735114", requestApproval: true, shipDays: 1, outboundShippingPlaceCode: 25572192, returnCenterCode: "1002729419", deliveryCompanyCode: "CJGLS" })
    }
    if (a === "cst") { out.running = reg.running; out.error = reg.error; out.items = Object.values<any>(reg.done).filter((d) => /청송/.test(String(d.name))).map((d) => ({ ok: d.ok, name: d.name, parts: d.parts, error: d.error, ship: d.shipKey ? "ok" : d.shipError })) }
    if (a === "ship") out.started = await bg("lucky-register-background", { mode: "ship", shipDays: 1, notice: NOTICE, only: (u.searchParams.get("sp") || "").split(",") })
  } catch (e: any) { out.err = String(e?.message || e).slice(0, 400) }
  return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json; charset=utf-8" } })
}
