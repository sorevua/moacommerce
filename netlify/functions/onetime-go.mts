// 임시: 곶감 선물세트 상태 확인·수정용. 작업이 끝나면 지운다.
import { getProduct } from "./_lib/coupang.mts"
const SP = ["16463593433", "16463587697", "16463594245"]
export default async (req: Request) => {
  const u = new URL(req.url)
  const t = u.searchParams.get("t") || "", tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || t !== tok) return new Response("no", { status: 404 })
  const out: any[] = []
  for (const sp of SP) {
    const p: any = await getProduct(sp)
    out.push({ sp, status: p.statusName, name: p.sellerProductName, disp: p.displayProductName, cat: p.displayCategoryCode, items: (p.items || []).map((it: any) => ({ n: it.itemName, price: it.salePrice, vid: it.vendorItemId, attrs: (it.attributes || []).map((a: any) => `${a.attributeTypeName}=${a.attributeValueName}`).join(" / "), img: (it.images || []).length, tags: (it.searchTags || []).slice(0, 5) })) })
  }
  return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json; charset=utf-8" } })
}
