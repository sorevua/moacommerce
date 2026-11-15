// 임시: 쿠팡 반려 사유 확인용 — 확인 후 삭제
import type { Config } from "@netlify/functions"
import { productHistory, fixDeliveryCompany, outboundPlaces, getProduct } from "./_lib/coupang.mts"
export default async (req: Request) => {
  const u = new URL(req.url)
  const tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || u.searchParams.get("t") !== tok) return new Response("no", { status: 403 })
  const ids = (u.searchParams.get("ids") || "").split(",").filter((x) => /^\d+$/.test(x)).slice(0, 5)
  const out: any = {}
  if (u.searchParams.get("dbg") === "1") {
    const pl: any = await outboundPlaces()
    const p: any = await getProduct(ids[0])
    return Response.json({ productPlace: p.outboundShippingPlaceCode, delivery: p.deliveryCompanyCode, places: JSON.stringify(pl).slice(0, 4000) })
  }
  const fix = u.searchParams.get("fix") === "1"
  for (const id of ids) out[id] = fix ? await fixDeliveryCompany(id).catch((e: any) => ({ error: String(e?.message || e) })) : await productHistory(id)
  return Response.json(out)
}
export const config: Config = { path: "/api/onetime-check" }
