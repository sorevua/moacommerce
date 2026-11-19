// 임시: 곶감 선물세트 등록용. 작업이 끝나면 지운다.
import { getStore } from "@netlify/blobs"
import { internalKey } from "./_lib/auth.mts"

const ID = "01M0H8HT0TF3A7HFB56Q9GFRVY"
const PARTS = [
  { suffix: "A", name: "청도 반건시 곶감 선물세트", match: "^\\[[1-9]호\\]", folder: "https://drive.google.com/drive/folders/1-KelEHzLyK1WfSGh3BJ-2rTPO1QfXRB4", main: "^청도반건시 선물세트\\.png$", facts: "곶감 반건시 선물세트. 원산지 국내산." },
  { suffix: "B", name: "청도 반건시 곶감 선물세트 1+1", match: "1\\+1", folder: "https://drive.google.com/drive/folders/1-KelEHzLyK1WfSGh3BJ-2rTPO1QfXRB4", main: "^청도반건시 선물세트-1\\.png$", facts: "곶감 반건시 선물세트 2박스(1+1). 원산지 국내산." },
  { suffix: "C", name: "곶감 호두말이 대봉곶감 선물세트", match: "호두말이|대봉", folder: "https://drive.google.com/drive/folders/1dkDnjX582ZKSCMyWGhXkR6lj0Yy9TbvG", main: "^호두말이 20구 선물세트\\.jpg$", grams: { "호두말이 20입": 17, "호두말이 30입": 15 }, facts: "호두말이(23·24호): 곶감 국내산(충북 영동군), 호두 미국산, 보자기 포장 포함. 대봉곶감(25호): 국내산(충북 영동군), 보자기 없음." },
]

export default async (req: Request) => {
  const u = new URL(req.url)
  const t = u.searchParams.get("t") || "", tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || t !== tok) return new Response("no", { status: 404 })
  const settings = getStore({ name: "admin-settings", consistency: "strong" })
  if (u.searchParams.get("a") === "reg") {
    const st: any = (await settings.get("lucky-reg", { type: "json" })) || { done: {} }
    if (st.done[ID] && !st.done[ID].ok) { delete st.done[ID]; await settings.setJSON("lucky-reg", st) }
    const body = { retry: true, once: true, batch: 1, productIds: [ID], parts: { [ID]: PARTS }, templateId: "16419735114", requestApproval: true, shipDays: 2, outboundShippingPlaceCode: 25572192, returnCenterCode: "1002729419", deliveryCompanyCode: "CJGLS" }
    const r = await fetch(u.origin + "/.netlify/functions/lucky-register-background", { method: "POST", headers: { "x-internal": internalKey(), "content-type": "application/json" }, body: JSON.stringify(body) })
    return Response.json({ started: r.status })
  }
  const st: any = (await settings.get("lucky-reg", { type: "json" })) || { done: {} }
  return new Response(JSON.stringify({ running: st.running, at: st.at, item: st.done[ID] }, null, 1), { headers: { "content-type": "application/json; charset=utf-8" } })
}
