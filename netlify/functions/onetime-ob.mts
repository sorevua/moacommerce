// 임시: 제주 옐로향 출고지 주소 수정 — 실행 후 삭제
import type { Config } from "@netlify/functions"
import { outboundPlaces, getProduct, call, vendorId } from "./_lib/coupang.mts"
const e164 = (p: string) => { const d = String(p || "").replace(/\D/g, ""); return d.startsWith("82") ? "+" + d : d ? "+82" + d.replace(/^0/, "") : "" }
export default async (req: Request) => {
  const u = new URL(req.url)
  const tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || u.searchParams.get("t") !== tok) return new Response("no", { status: 403 })
  const code = "25564858"
  const pl: any[] = await outboundPlaces()
  const o = pl.find((x: any) => String(x.outboundShippingPlaceCode) === code)
  if (!o) return Response.json({ error: "출고지 없음" })
  const p: any = await getProduct("16417633126")
  const a = o.placeAddresses?.[0] || {}
  const ph = e164(a.companyContactNumber), ph2 = e164(a.phoneNumber2)
  const addr = (t: string, ad: string, det: string) => ({ addressType: t, countryCode: "KR", companyContactNumber: ph, phoneNumber2: ph2, returnZipCode: "63617", returnAddress: ad, returnAddressDetail: det })
  const body = {
    vendorId: vendorId(), userId: p.vendorUserId, outboundShippingPlaceCode: Number(code), shippingPlaceName: o.shippingPlaceName, usable: true, global: "false",
    placeAddresses: [addr("JIBUN", "제주특별자치도 서귀포시 남원읍 태흥리", "691-1"), addr("ROADNAME", "제주특별자치도 서귀포시 남원읍 태신삼석로73번길", "76-15")],
    remoteInfos: (o.remoteInfos || []).map((r: any) => ({ deliveryCode: r.deliveryCode, jeju: r.jeju, notJeju: r.notJeju, usable: r.usable !== false })),
  }
  if (u.searchParams.get("go") !== "1") return Response.json({ before: o, body })
  const r = await call("PUT", `/v2/providers/openapi/apis/api/v5/vendors/${vendorId()}/outboundShippingCenters/${code}`, "", body).catch((e: any) => ({ error: String(e?.message || e) }))
  const after = (await outboundPlaces()).find((x: any) => String(x.outboundShippingPlaceCode) === code)
  return Response.json({ r, after })
}
export const config: Config = { path: "/api/onetime-ob" }
