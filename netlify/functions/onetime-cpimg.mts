// 임시: 쿠팡 유라귤에서 13.7 Brix 당도계 사진 제거 — 작업 후 삭제
import type { Config } from "@netlify/functions"
import { getProduct, call, normImg, productHistory } from "./_lib/coupang.mts"
const SP = "/v2/providers/seller_api/apis/api/v1/marketplace"
export default async (req: Request) => {
  const u = new URL(req.url)
  const tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || u.searchParams.get("t") !== tok) return new Response("no", { status: 403 })
  if (u.searchParams.get("h") === "1") { const h: any = await productHistory("16417633126"); const p2: any = await getProduct("16417633126"); return Response.json({ status: h.status, last: (h.history || []).slice(0, 3), imgs: (p2.items || []).map((i: any) => [i.itemName, (i.images || []).length]) }) }
  const p: any = await getProduct("16417633126")
  // 옵션별로 화면에서 확인한 당도계 사진 위치 (1부터): 2kg 4번째, 3kg 6번째, 5kg 6번째
  const pos: Record<string, number> = { "2kg": 4, "3kg": 6, "5kg": 6 }
  const target = new Set<string>()
  for (const it of p.items || []) {
    const k = Object.keys(pos).find((x) => String(it.itemName).includes(x))
    const im = k ? (it.images || [])[pos[k] - 1] : null
    if (im) target.add(normImg(im.cdnPath || im.vendorPath))
  }
  const out: any = { target: [...target], items: [] }
  if (target.size !== 1) return Response.json({ ...out, error: "옵션마다 지울 사진이 달라 멈춤" })
  for (const it of p.items || []) {
    const before = (it.images || []).length
    it.images = (it.images || []).filter((im: any) => !target.has(normImg(im.cdnPath || im.vendorPath))).map((im: any, i: number) => ({ ...im, imageOrder: i }))
    out.items.push({ name: it.itemName, before, after: it.images.length })
  }
  if (u.searchParams.get("go") !== "1") return Response.json(out)
  p.requested = true
  out.result = await call("PUT", `${SP}/seller-products`, "", p)
  return Response.json(out)
}
export const config: Config = { path: "/api/onetime-cpimg" }
