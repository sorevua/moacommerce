// 임시 (확인 후 삭제)
import { getStore } from "@netlify/blobs"
import { getProduct } from "./_lib/coupang.mts"
import { internalKey } from "./_lib/auth.mts"
const CAPTION = `같은 5kg인데 큰 귤은 9,600원, 작은 귤은 17,400원입니다.

귤은 크기에 따라 값이 다릅니다.
그래서 크기별로 나눠서 올렸습니다.

제주 조생 노지감귤 5kg
· 대과(2L 이상) 9,600원
· 중과(S-M) 16,000원
· 프리미엄과(S) 17,400원
3kg, 10kg도 있습니다. 전부 무료배송입니다.

아침 9시 30분 전에 주문하면 그날 출고를 목표로 보냅니다.
산지 사정에 따라 2~3일 걸릴 수 있습니다.

받으면 이렇게 두세요.
1. 상자를 열어 무른 귤부터 골라냅니다.
2. 서로 겹치지 않게 펼쳐 둡니다.
3. 서늘한 곳에 둡니다.

집에서는 어떤 크기를 더 좋아하세요? 댓글로 알려 주세요.

주문: volqavo.com/gyul

#제주감귤 #조생귤 #노지감귤 #제주귤 #귤5kg #귤보관법 #제철과일 #11월제철`
export default async (req: Request) => {
  const u = new URL(req.url), t = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!t || u.searchParams.get("t") !== t) return new Response("no", { status: 404 })
  const a = u.searchParams.get("a"), out: any = {}
  try {
    if (a === "url") { const p: any = await getProduct(u.searchParams.get("id") || ""); out.productId = p.productId; out.status = p.statusName; out.items = (p.items || []).map((i: any) => `${i.itemName}|${i.vendorItemId}|${i.itemId}|${i.salePrice}`) }
    if (a === "post") {
      const files = [1, 2, 3].map((n) => `${u.origin}/promo/gyul-${n}.jpg`)
      const r = await fetch(u.origin + "/.netlify/functions/promo-post-background", { method: "POST", headers: { "x-internal": internalKey() }, body: JSON.stringify({ key: "gyul-1", files, caption: CAPTION }) })
      out.started = r.status
    }
    if (a === "status") out.post = await getStore({ name: "admin-promo", consistency: "strong" }).get("manual-post-gyul-1", { type: "json" })
  } catch (e: any) { out.error = e.message }
  return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json; charset=utf-8" } })
}
