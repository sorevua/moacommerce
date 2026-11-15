// 임시: 네이버 키위 상태 확인 — 확인 후 삭제
import type { Config } from "@netlify/functions"
import { ncall } from "./_lib/naver.mts"
export default async (req: Request) => {
  const u = new URL(req.url)
  const tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || u.searchParams.get("t") !== tok) return new Response("no", { status: 403 })
  const ab: any = await ncall("GET", "/v1/seller/addressbooks-for-page", "page=1&size=100")
  const names = new Map((ab?.addressBooks || []).map((a: any) => [a.addressBookNo, `${a.name} (${a.address})`]))
  const out: any = {}
  for (const no of ["13814619964", "13814620214"]) {
    const o: any = await ncall("GET", `/v2/products/origin-products/${no}`)
    const c = o?.originProduct?.deliveryInfo?.claimDeliveryInfo || {}
    out[no] = { status: o?.originProduct?.statusType, display: o?.smartstoreChannelProduct?.channelProductDisplayStatusType, ship: names.get(c.shippingAddressId) || c.shippingAddressId, ret: names.get(c.returnAddressId) || c.returnAddressId }
  }
  return Response.json(out)
}
export const config: Config = { path: "/api/onetime-chk" }
