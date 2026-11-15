// 1회용: 광양 키위(골드·그린) 쿠팡 임시저장 등록 실행·결과 확인. 사용 후 삭제.
import type { Config } from "@netlify/functions"
import { getStore } from "@netlify/blobs"

const KIWI = [
  { key: "gold", name: "광양 산지직송 골드키위 5kg", displayName: "전남 광양 산지직송 골드키위 5kg 특대 대과 중과 소과", photo: "golden kiwi fruits, several whole fruits with smooth bronze skin and one cut in half showing bright yellow-gold flesh with small black seeds",
    options: [["골드키위 5kg 특대", 56000], ["골드키위 5kg 대과", 53200], ["골드키위 5kg 중과", 46400], ["골드키위 5kg 소과", 32800]] },
  { key: "green", name: "광양 산지직송 그린키위 5kg", displayName: "전남 광양 산지직송 그린키위 참다래 5kg 특대 대과 중과 소과", photo: "green kiwi fruits, several whole fruits with fuzzy brown skin and one cut in half showing bright green flesh with a white core and small black seeds",
    options: [["그린키위 5kg 특대", 41000], ["그린키위 5kg 대과", 38200], ["그린키위 5kg 중과", 35500], ["그린키위 5kg 소과", 31400]] },
]

export default async (req: Request) => {
  const tok = Netlify.env.get("ONETIME_TOKEN") || ""
  const u = new URL(req.url)
  if (!tok || u.searchParams.get("t") !== tok) return new Response("not found", { status: 404 })
  const st = getStore({ name: "admin-settings", consistency: "strong" })
  if (u.searchParams.get("run") === "1") {
    const started: any = (await st.get("kiwi-run", { type: "json" })) || {}
    if (started.at && u.searchParams.get("force") !== "1") return Response.json({ already: started })
    const per: any = JSON.parse(u.searchParams.get("per") || "{}")
    const prevRun: any = (await st.get("kiwi-run", { type: "json" })) || {}
    const photos = [1, 5, 6, 8, 10, 9].map((n) => `${u.origin}/assets/kiwi/farm-${String(n).padStart(2, "0")}.jpg`)
    const run: any = { at: new Date().toISOString(), jobs: {} }
    for (const k of KIWI) {
      const jobId = `kiwi-${k.key}-${Date.now()}`
      const prev: any = prevRun.jobs?.[k.key] ? await st.get(`create-${prevRun.jobs[k.key]}`, { type: "json" }) : null
      const perPieceGram: any = {}
      k.options.forEach(([name], i) => { const g = Number((per[k.key] || [])[i]); if (g > 0) perPieceGram[name] = g })
      run.jobs[k.key] = jobId
      await fetch(`${u.origin}/.netlify/functions/coupang-work-background`, {
        method: "POST",
        body: JSON.stringify({
          type: "create", token: tok, jobId, templateId: "16417633126", name: k.name, displayName: k.displayName,
          options: k.options.map(([name, price]) => ({ name, price })),
          facts: "전라남도 광양시 농가에서 수확해 산지에서 바로 발송. 5kg(상자 포함 중량). 등급: 특대·대과·중과·소과. 무료배송. 신선식품 단순 변심 반품 불가, 반품 배송비 편도 5,000원.",
          photoPrompt: k.photo, photos, mainImage: prev?.mainUrl || "", perPieceGram, brand: "모아커머스", outboundShippingPlaceCode: "25735840",
          returnInfo: { name: "광양 키위농가", phone: "010-8587-0003", zip: "57707", address: "전라남도 광양시 진상면 신시3길", detail: "13-23" },
          returnCharge: 5000,
        }),
      })
    }
    await st.setJSON("kiwi-run", run)
    return Response.json(run)
  }
  const run: any = (await st.get("kiwi-run", { type: "json" })) || {}
  const out: any = { run }
  for (const [k, id] of Object.entries(run.jobs || {})) out[k] = await st.get(`create-${id}`, { type: "json" })
  return Response.json(out)
}
export const config: Config = { path: "/api/onetime-kiwi" }
