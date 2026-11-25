// 임시: 곶감 선물세트에서 25호 대봉곶감을 별도 쿠팡 상품으로 분리. 끝나면 지운다.
// 이유: 호두말이(개당 15~17g)와 대봉곶감이 한 상품 옵션으로 묶여 쿠팡이 1개당 가격을 비교해 대봉을 노출제한함
import { getStore } from "@netlify/blobs"
import { internalKey } from "./_lib/auth.mts"
import { getProduct, stopSale } from "./_lib/coupang.mts"
const ID = "01M0H8HT0TF3A7HFB56Q9GFRVY"
const F = "https://drive.google.com/drive/folders/1dkDnjX582ZKSCMyWGhXkR6lj0Yy9TbvG"
const PARTS = [
  { suffix: "A", name: "청도 반건시 곶감 선물세트", match: "^\\[[1-9]호\\]", folder: "https://drive.google.com/drive/folders/1-KelEHzLyK1WfSGh3BJ-2rTPO1QfXRB4", main: "^청도반건시 선물세트\\.png$" },
  { suffix: "B", name: "청도 반건시 곶감 선물세트 1+1", match: "1\\+1", folder: "https://drive.google.com/drive/folders/1-KelEHzLyK1WfSGh3BJ-2rTPO1QfXRB4", main: "^청도반건시 선물세트-1\\.png$" },
  { suffix: "C", name: "곶감 호두말이 대봉곶감 선물세트", match: "호두말이", folder: F, main: "^호두말이 20구 선물세트\\.jpg$" },
  { suffix: "D", name: "영동 대봉곶감 반건시 선물세트", match: "대봉", folder: F, main: "^대봉곶감 선물세트\\.png$", only: "대봉", facts: "대봉곶감 반건시(25호): 곶감 국내산(충북 영동군), 보자기 없음." },
]
export default async (req: Request) => {
  const u = new URL(req.url)
  const tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || u.searchParams.get("t") !== tok) return new Response("no", { status: 404 })
  const settings = getStore({ name: "admin-settings", consistency: "strong" })
  const a = u.searchParams.get("a"), out: any = {}
  try {
    const st: any = (await settings.get("lucky-reg", { type: "json" })) || { done: {} }
    if (a === "reg") {
      const d = st.done[ID]; if (d?.parts?.D) return Response.json({ already: d.parts.D })
      st.done[ID] = { ...d, ok: false, error: "대봉 분리", tries: 0 }; await settings.setJSON("lucky-reg", st)
      const body = { retry: true, once: true, batch: 1, productIds: [ID], parts: { [ID]: PARTS }, templateId: "16419735114", requestApproval: true, shipDays: 2, outboundShippingPlaceCode: 25572192, returnCenterCode: "1002729419", deliveryCompanyCode: "CJGLS" }
      out.started = (await fetch(u.origin + "/.netlify/functions/lucky-register-background", { method: "POST", headers: { "x-internal": internalKey(), "content-type": "application/json" }, body: JSON.stringify(body) })).status
    }
    if (a === "st") { const d = st.done[ID]; out.ok = d?.ok; out.parts = d?.parts; out.error = d?.error; out.running = st.running }
    if (a === "post") {
      // C 상품의 대봉 옵션은 판매중지, 업체 상품의 대봉 옵션은 새 D 상품 옵션으로 연결
      const d = st.done[ID]; if (!d?.parts?.D) return Response.json({ error: "D 없음" })
      const C: any = await getProduct(String(d.parts.C)), D: any = await getProduct(String(d.parts.D))
      out.stopped = []
      for (const it of C.items || []) if (/대봉/.test(String(it.itemName))) { await stopSale(String(it.vendorItemId)); out.stopped.push(it.itemName) }
      const vs = getStore({ name: "admin-vendors", consistency: "strong" })
      const { blobs } = await vs.list(); out.linked = []
      for (const b of blobs) {
        const v: any = await vs.get(b.key, { type: "json" }); let ch = false
        for (const vp of v?.products || []) if (vp.luckyProductId === ID && /대봉/.test(vp.name)) {
          const o = (d.options || []).find((x: any) => x.id === vp.luckyOptionId); const it = (D.items || []).find((x: any) => x.itemName === o?.name)
          if (it) { vp.coupangItemId = String(it.vendorItemId); ch = true; out.linked.push(it.itemName) }
        }
        if (ch) await vs.setJSON(b.key, v)
      }
      out.D = { status: D.statusName, items: (D.items || []).map((x: any) => `${x.itemName} ${x.salePrice}`) }
    }
  } catch (e: any) { out.err = String(e?.message || e).slice(0, 400) }
  return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json; charset=utf-8" } })
}
