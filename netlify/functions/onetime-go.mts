// 임시 (확인 후 삭제): 행운프레시 상품 중 쿠팡에 아직 없는 것 확인·등록
import { getStore } from "@netlify/blobs"
import { internalKey } from "./_lib/auth.mts"
import { luckyProducts } from "./_lib/luckyfresh.mts"
export default async (req: Request) => {
  const u = new URL(req.url), t = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!t || u.searchParams.get("t") !== t) return new Response("no", { status: 404 })
  const out: any = {}
  const a = u.searchParams.get("a") || "status"
  if (a === "reg") {
    const ids = (u.searchParams.get("ids") || "").split(",").filter(Boolean)
    const body = { token: t, retry: true, once: true, batch: Number(u.searchParams.get("batch") || 4), productIds: ids, split: u.searchParams.get("split") === "1", templateId: "16419735114", requestApproval: true, shipDays: 2, outboundShippingPlaceCode: 25572192, returnCenterCode: "1002729419", deliveryCompanyCode: "CJGLS", gradeGrams: { "01KZAJT1N2CGN7010G3N8Q2RCE": { "중소과": 70, "중과": 85, "대과": 95 }, "01KZTCN32HHT1FCYGJ8Q590R56": { "중과": 280, "중대과": 310, "특대과": 400 } } }
    if (u.searchParams.get("reset") === "1") { const s = getStore({ name: "admin-settings", consistency: "strong" }); const st: any = (await s.get("lucky-reg", { type: "json" })) || { done: {} }; for (const id of ids) if (st.done[id] && !st.done[id].ok) delete st.done[id]; await s.setJSON("lucky-reg", st) }
    const r = await fetch(u.origin + "/.netlify/functions/lucky-register-background", { method: "POST", headers: { "x-internal": internalKey(), "content-type": "application/json" }, body: JSON.stringify(body) })
    out.started = r.status
  } else {
    const st: any = (await getStore({ name: "admin-settings", consistency: "strong" }).get("lucky-reg", { type: "json" })) || { done: {} }
    const pl: any[] = (await luckyProducts(u.searchParams.get("fresh") === "1")).data?.products || []
    out.running = st.running; out.at = st.at; out.error = st.error; out.total = pl.length
    out.list = pl.map((p) => { const d = st.done[p.id] || {}; return { id: p.id, name: p.name, opts: (p.options || []).length, sale: (p.options || []).filter((o: any) => o.status === "판매중").length, ok: !!d.ok, spid: d.sellerProductId || "", tries: d.tries || 0, err: d.ok ? "" : String(d.error || "").slice(0, 160) } })
  }
  return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json; charset=utf-8" } })
}
