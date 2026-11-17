// 임시 확인용 (확인 후 삭제)
import { luckyConfigured, luckyWallet, luckyProducts } from "./_lib/luckyfresh.mts"
export default async (req: Request) => {
  const u = new URL(req.url), t = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!t || u.searchParams.get("t") !== t) return new Response("no", { status: 404 })
  const out: any = { configured: luckyConfigured() }
  try { out.wallet = await luckyWallet() } catch (e: any) { out.walletError = e.message }
  try { const p = await luckyProducts(u.searchParams.get("force") === "1"); out.at = p.at; out.products = p.data } catch (e: any) { out.productsError = e.message }
  return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json; charset=utf-8" } })
}
