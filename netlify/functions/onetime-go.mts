// 임시 (2026-11-25): 설향 딸기 2종 쿠팡·네이버 등록 + 전 상품 당일 출고 안내 + 판매가 점검. 끝나면 지운다.
import { getStore } from "@netlify/blobs"
import { internalKey } from "./_lib/auth.mts"
import { luckyProducts } from "./_lib/luckyfresh.mts"
import { ncall } from "./_lib/naver.mts"
const O = "https://volqavo.com/sb"
const M = ["03", "04", "05", "02", "06", "07", "08", "09", "10", "11"].map((n) => `${O}/m/${n}.jpg`)
const N = ["01", "02", "03", "04", "05", "06", "07", "08", "09"].map((n) => `${O}/n/${n}.jpg`)
const NOTICE = "[출고 안내]\n평일 오전 7시까지 주문하신 상품은 당일 출고됩니다.\n오전 7시 이후 주문은 다음 영업일에 출고됩니다.\n토·일·공휴일 주문은 다음 영업일에 출고됩니다.\n산지 수확·날씨 사정으로 출고가 하루 늦어질 수 있습니다."
const parts = (name: string) => /무농약/.test(name)
  ? [
    { suffix: "S", name: "무농약 인증 설향 딸기 상 500g", match: "(^|\\s)상(\\s|$)", mainUrl: `${O}/m-main.jpg`, contentUrls: [`${O}/berry-notice.jpg`, ...M], facts: "무농약 인증 설향 딸기. 원산지 국내산(경북 고령, 경남 진주). 무농약 인증번호(농림축산식품부): 제16302303호/제17303427호, 제16302308호/제16303663호, 제16302341호/제16302390호. 당일 수확 후 출고. 제주·도서산간 배송 불가. 받는 즉시 냉장 보관, 2~3일 안에 섭취." },
    { suffix: "T", name: "무농약 인증 설향 딸기 특 500g", match: "(^|\\s)특(\\s|$)", mainUrl: `${O}/m-main.jpg`, contentUrls: [`${O}/berry-notice.jpg`, ...M], facts: "무농약 인증 설향 딸기. 원산지 국내산(경북 고령, 경남 진주). 무농약 인증번호(농림축산식품부): 제16302303호/제17303427호, 제16302308호/제16303663호, 제16302341호/제16302390호. 당일 수확 후 출고. 제주·도서산간 배송 불가. 받는 즉시 냉장 보관, 2~3일 안에 섭취." },
  ]
  : [
    { suffix: "H", name: "논산 설향딸기 한입 350g (팩당 20~24구)", match: "한입", mainUrl: `${O}/n-main.jpg`, contentUrls: [`${O}/berry-notice.jpg`, ...N], facts: "논산 설향딸기. 원산지 국내산(충남 논산). 당일 수확 후 출고. 제주·도서산간 배송 불가. 받는 즉시 냉장 보관, 2~3일 안에 섭취." },
    { suffix: "T", name: "논산 설향딸기 특 350g (팩당 12~15구)", match: "(^|\\s)특(\\s|$)", mainUrl: `${O}/n-main.jpg`, contentUrls: [`${O}/berry-notice.jpg`, ...N], facts: "논산 설향딸기. 원산지 국내산(충남 논산). 당일 수확 후 출고. 제주·도서산간 배송 불가. 받는 즉시 냉장 보관, 2~3일 안에 섭취." },
  ]
export default async (req: Request) => {
  const u = new URL(req.url)
  const tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || u.searchParams.get("t") !== tok) return new Response("no", { status: 404 })
  const st = getStore({ name: "admin-settings", consistency: "strong" })
  const a = u.searchParams.get("a"), out: any = {}
  const bg = (fn: string, body: any) => fetch(`${u.origin}/.netlify/functions/${fn}`, { method: "POST", headers: { "x-internal": internalKey(), "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.status)
  const berries = async () => ((await luckyProducts(a === "lk")).data?.products || []).filter((p: any) => /설향/.test(p.name))
  try {
    if (a === "lk") out.products = (await berries()).map((p: any) => ({ id: p.id, name: p.name, opts: (p.options || []).map((o: any) => `${o.name} ${o.prefixName || ""}|${o.price}+${o.shippingFee}|${o.status}`) }))
    if (a === "creg") {
      const bs = await berries(); const ids = bs.map((p: any) => p.id)
      out.ids = ids
      out.started = await bg("lucky-register-background", { retry: true, batch: 2, productIds: ids, parts: Object.fromEntries(bs.map((p: any) => [p.id, parts(p.name)])), noRemote: ids, templateId: "16419735114", requestApproval: true, shipDays: 1, outboundShippingPlaceCode: 25572192, returnCenterCode: "1002729419", deliveryCompanyCode: "CJGLS" })
    }
    if (a === "cst") { const r: any = await st.get("lucky-reg", { type: "json" }); out.running = r.running; out.error = r.error; out.items = Object.values<any>(r.done).filter((d) => /설향/.test(String(d.name))) }
    if (a === "ship") { const r: any = await st.get("lucky-reg", { type: "json" }); out.started = await bg("lucky-register-background", { mode: "ship", shipDays: 1, notice: NOTICE, skipIds: Object.entries<any>(r.done).filter(([, d]) => /설향/.test(String(d.name))).map(([k]) => k) }) }
    if (a === "shst") { const r: any = await st.get("lucky-reg", { type: "json" }); out.running = r.running; out.ship = r.ship; out.error = r.error; out.errs = Object.values<any>(r.done).filter((d) => d.shipError).map((d) => `${d.name}: ${d.shipError}`).slice(0, 15) }
    if (a === "audit") out.started = await bg("lucky-price-audit-background", {})
    if (a === "ast") { const r: any = await st.get("lucky-price-audit", { type: "json" }); out.r = r ? { running: r.running, finished: r.finished, left: r.left, total: r.total, seen: Object.keys(r.seen || {}).length, raised: r.raised, loss: r.loss, errors: (r.errors || []).slice(0, 10), nerr: (r.errors || []).length } : null }
    if (a === "nraw") {
      const r: any = await ncall("GET", u.searchParams.get("p") || "", u.searchParams.get("q") || "")
      const f = u.searchParams.get("f"); const arr = Array.isArray(r) ? r : r?.contents || [r]
      out.n = arr.length; out.rows = (f ? arr.filter((x: any) => new RegExp(f).test(JSON.stringify(x))) : arr).slice(0, 60)
    }
    if (a === "nreg") out.started = await bg("lucky-naver-background", JSON.parse(u.searchParams.get("job") || "{}"))
    if (a === "nst") { const r: any = await st.get("lucky-naver", { type: "json" }); out.running = r.running; out.log = r.log; out.items = Object.values<any>(r.done).filter((d) => /설향/.test(String(d.name))) }
  } catch (e: any) { out.err = String(e?.message || e).slice(0, 500) }
  return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json; charset=utf-8" } })
}
