// 임시: 네이버 등록 준비 — 작업 후 삭제
import type { Config } from "@netlify/functions"
import { ncall } from "./_lib/naver.mts"
import { getProduct } from "./_lib/coupang.mts"
export default async (req: Request) => {
  const u = new URL(req.url)
  const tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || u.searchParams.get("t") !== tok) return new Response("no", { status: 403 })
  const q = u.searchParams.get("q"), off = Number(u.searchParams.get("o") || 0), len = Number(u.searchParams.get("n") || 6000)
  let r: any
  try {
    if (q === "origin") r = await ncall("GET", `/v2/products/origin-products/${u.searchParams.get("id") || "13763431198"}`)
    else if (q === "addr") r = await ncall("GET", "/v1/seller/addressbooks-for-page", "page=1&size=50")
    else if (q === "cat") { const all: any[] = await ncall("GET", "/v1/categories", "last=true"); const k = u.searchParams.get("k") || "키위"; r = all.filter((c: any) => String(c.wholeCategoryName).includes(k)) }
    else if (q === "cp") { const p: any = await getProduct(u.searchParams.get("id") || "16417633126"); r = { name: p.sellerProductName, display: p.displayProductName, items: (p.items || []).map((i: any) => ({ n: i.itemName, price: i.salePrice, img: (i.images || []).map((x: any) => x.cdnPath || x.vendorPath) })), contents: JSON.stringify(p.items?.[0]?.contents || []).slice(0, 3000) } }
    else r = { error: "q?" }
  } catch (e: any) { r = { error: String(e?.message || e) } }
  const s = JSON.stringify(r)
  return new Response(s.slice(off, off + len) + `\n[len=${s.length}]`, { headers: { "content-type": "text/plain; charset=utf-8" } })
}
export const config: Config = { path: "/api/onetime-nv" }
