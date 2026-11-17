// 임시 확인용 (확인 후 삭제)
import { luckyProducts } from "./_lib/luckyfresh.mts"
export default async (req: Request) => {
  const u = new URL(req.url), t = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!t || u.searchParams.get("t") !== t) return new Response("no", { status: 404 })
  const p: any = await luckyProducts(false)
  const list: any[] = p.data?.products || []
  const keys = new Set<string>(); list.forEach((x) => Object.keys(x).forEach((k) => keys.add(k)))
  const lines = list.map((x) => {
    const o: any[] = x.options || []
    const pr = o.map((y) => y.price), sf = [...new Set(o.map((y) => y.shippingFee))]
    return `${x.name.trim()} | ${o.length}옵션 | ${Math.min(...pr)}~${Math.max(...pr)} | 배송비 ${sf.join(",")} | 품절 ${o.filter((y) => y.status !== "판매중").length} | 마감 ${x.orderCutoffTime} | 희망일 ${x.allowsDesiredShippingDate ? "O" : "X"}`
  })
  return new Response([`상품 ${list.length}개, 옵션 ${list.reduce((a, x) => a + (x.options || []).length, 0)}개, 키: ${[...keys].join(",")}`, ...lines].join("\n"), { headers: { "content-type": "text/plain; charset=utf-8" } })
}
