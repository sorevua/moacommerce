// 임시: 반려된 곶감 선물세트 3개 다시 승인 요청. 작업이 끝나면 지운다.
import { getProduct, updateProductContent } from "./_lib/coupang.mts"
const SP = ["16463593433", "16463587697", "16463594245"]
export default async (req: Request) => {
  const u = new URL(req.url)
  const t = u.searchParams.get("t") || "", tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || t !== tok) return new Response("no", { status: 404 })
  const out: any[] = []
  for (const sp of SP) {
    try {
      const p: any = await getProduct(sp)
      const st = String(p.statusName || "")
      if (u.searchParams.get("a") === "req" && /반려|임시/.test(st)) { const r: any = await updateProductContent(sp, {}); out.push({ sp, before: st, r: String(r?.code || r?.message || "").slice(0, 120) }) }
      else out.push({ sp, name: p.sellerProductName, status: st })
    } catch (e: any) { out.push({ sp, err: String(e?.message || e).slice(0, 200) }) }
  }
  return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json; charset=utf-8" } })
}
