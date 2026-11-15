// 1회용: 광양 키위 출고지(25735840)에 도로명+지번 주소를 함께 넣어 고친다. 사용 후 삭제.
import type { Config } from "@netlify/functions"
import { getStore } from "@netlify/blobs"
import { call, vendorId, getProduct } from "./_lib/coupang.mts"

export default async (req: Request) => {
  const token = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!token || new URL(req.url).searchParams.get("t") !== token) return new Response("not found", { status: 404 })
  const st = getStore({ name: "admin-settings", consistency: "strong" })
  try {
    const cache: any = (await st.get("coupang-products", { type: "json" })) || {}
    const sp = (cache.products || []).find((p: any) => p.sellerProductId)?.sellerProductId
    const userId = (await getProduct(String(sp))).vendorUserId
    const addr = (type: string, a: string, d: string, ph: string) => ({ addressType: type, countryCode: "KR", companyContactNumber: ph, phoneNumber2: "", returnZipCode: "57707", returnAddress: a, returnAddressDetail: d })
    let r: any = null, lastErr = ""
    for (const ph of ["010-8587-0003", "+82-10-8587-0003", "+821085870003"]) {
      const body = {
        vendorId: vendorId(), userId, outboundShippingPlaceCode: 25735840, shippingPlaceName: "광양 키위농가", usable: true, global: false,
        placeAddresses: [addr("JIBUN", "전라남도 광양시 진상면 섬거리", "458-3", ph), addr("ROADNAME", "전라남도 광양시 진상면 신시3길", "13-23", ph)],
      }
      try { r = await call("PUT", `/v2/providers/openapi/apis/api/v5/vendors/${vendorId()}/outboundShippingCenters/25735840`, "", body); break }
      catch (e: any) { lastErr = String(e?.message || e); if (!/phone|E\.164|전화/i.test(lastErr)) break }
    }
    const out = { at: new Date().toISOString(), ok: !!r, raw: r, error: r ? "" : lastErr }
    await st.setJSON("outbound-gwangyang-fix", out)
    return Response.json(out)
  } catch (e: any) {
    return Response.json({ error: String(e?.message || e) }, { status: 500 })
  }
}
export const config: Config = { path: "/api/onetime-outbound-fix" }
