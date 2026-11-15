// 1회용: 광양 키위 농가 출고지를 쿠팡에 등록하고 결과를 저장한다. 사용 후 삭제할 파일.
import type { Config } from "@netlify/functions"
import { getStore } from "@netlify/blobs"
import { call, vendorId, getProduct } from "./_lib/coupang.mts"

export default async (req: Request) => {
  const token = Netlify.env.get("ONETIME_TOKEN") || ""
  const u = new URL(req.url)
  if (!token || u.searchParams.get("t") !== token) return new Response("not found", { status: 404 })
  const st = getStore({ name: "admin-settings", consistency: "strong" })
  const done: any = await st.get("outbound-gwangyang", { type: "json" })
  if (done?.code) return Response.json({ already: done })
  try {
    const cache: any = (await st.get("coupang-products", { type: "json" })) || {}
    const sp = (cache.products || []).find((p: any) => p.sellerProductId)?.sellerProductId
    if (!sp) throw new Error("쿠팡 상품 목록이 없어 WING 아이디를 알 수 없습니다.")
    const p = await getProduct(String(sp))
    const userId = p.vendorUserId
    if (!userId) throw new Error("WING 아이디(vendorUserId)를 찾지 못했습니다.")
    const body = {
      vendorId: vendorId(),
      userId,
      shippingPlaceName: "광양 키위농가",
      global: "false",
      usable: "true",
      placeAddresses: [{ addressType: "JIBUN", countryCode: "KR", companyContactNumber: "010-8587-0003", phoneNumber2: "", returnZipCode: "57707", returnAddress: "전라남도 광양시 진상면 신시3길", returnAddressDetail: "13-23" }],
    }
    const r = await call("POST", `/v2/providers/openapi/apis/api/v5/vendors/${vendorId()}/outboundShippingCenters`, "", body)
    const code = r?.data?.resultCode === "SUCCESS" ? String(r.data.resultMessage) : ""
    const out = { at: new Date().toISOString(), code, raw: r }
    await st.setJSON("outbound-gwangyang", out)
    return Response.json(out)
  } catch (e: any) {
    const out = { at: new Date().toISOString(), error: String(e?.message || e) }
    await st.setJSON("outbound-gwangyang-error", out)
    return Response.json(out, { status: 500 })
  }
}

export const config: Config = { path: "/api/onetime-outbound" }
