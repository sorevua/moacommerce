// 임시: 행운 신규 상품(개별망포장 실속형 부사사과) 확인·등록용. 작업이 끝나면 지운다.
import { getStore } from "@netlify/blobs"
import { internalKey } from "./_lib/auth.mts"
import { luckyProducts } from "./_lib/luckyfresh.mts"
export default async (req: Request) => {
  const u = new URL(req.url)
  const t = u.searchParams.get("t") || "", tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || t !== tok) return new Response("no", { status: 404 })
  const a = u.searchParams.get("a") || ""
  if (a === "find") {
    const list: any[] = (await luckyProducts(true)).data?.products || []
    const q = u.searchParams.get("q") || ""
    const hit = list.filter((p) => String(p.name).includes(q) || String(p.title || "").includes(q))
    return new Response(JSON.stringify(hit.map((p) => ({ ...p, detail: undefined, description: String(p.description || "").slice(0, 300) })), null, 1), { headers: { "content-type": "application/json; charset=utf-8" } })
  }
  if (a === "reg") {
    const id = u.searchParams.get("id") || ""
    const parts = id === "01M7SC8J1AA90CVJCARJEKX5BH" ? { [id]: [{ suffix: "A", name: "개별망 포장 실속형 부사사과 (박스포함 중량)", match: ".", folder: "https://drive.google.com/drive/folders/1vLK36-PfduiDtCZpkdOohWTXDtoLor0M", main: "개별망", facts: "실속형 품위(외관상 일부 흠결). 소과~중소과 혼합. 사과마다 개별 망 포장. 중량은 박스 포함: 2kg→실중량 1.7kg 이상, 3kg→2.7kg 이상, 4kg→3.7kg 이상, 5kg→4.5kg 이상. 원산지 국내산(경북 안동·청송·문경 등). 제주·도서산간 배송 불가." }] } : undefined
    const body = { retry: true, once: true, batch: 1, productIds: [id], noRemote: [id], parts, templateId: "16419735114", requestApproval: true, shipDays: 2, outboundShippingPlaceCode: 25572192, returnCenterCode: "1002729419", deliveryCompanyCode: "CJGLS" }
    const r = await fetch(u.origin + "/.netlify/functions/lucky-register-background", { method: "POST", headers: { "x-internal": internalKey(), "content-type": "application/json" }, body: JSON.stringify(body) })
    return Response.json({ started: r.status })
  }
  const st: any = (await getStore({ name: "admin-settings", consistency: "strong" }).get("lucky-reg", { type: "json" })) || { done: {} }
  const id = u.searchParams.get("id") || ""
  return new Response(JSON.stringify({ running: st.running, at: st.at, item: st.done[id] }, null, 1), { headers: { "content-type": "application/json; charset=utf-8" } })
}
