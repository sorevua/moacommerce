// 임시: 네이버 연결 확인 — 확인 후 삭제
import type { Config } from "@netlify/functions"
import { naverConfigured, naverToken, changedOrders, syncNaverOrders, ncall } from "./_lib/naver.mts"
export default async (req: Request) => {
  const u = new URL(req.url)
  const tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || u.searchParams.get("t") !== tok) return new Response("no", { status: 403 })
  const out: any = { configured: naverConfigured(), idLen: (Netlify.env.get("NAVER_CLIENT_ID") || "").length, secretPrefix: (Netlify.env.get("NAVER_CLIENT_SECRET") || "").slice(0, 4) }
  try { await naverToken(true); out.token = "OK" } catch (e: any) { out.token = String(e?.message || e) }
  if (out.token === "OK") { try { const o: any = await changedOrders(24 * 7); out.orders = { count: o?.data?.lastChangeStatuses?.length ?? null, sample: JSON.stringify(o).slice(0, 300) } } catch (e: any) { out.orders = String(e?.message || e) } }
  if (out.token === "OK") {
    try { out.sync = await syncNaverOrders() } catch (e: any) { out.sync = String(e?.message || e) }
    try { const r: any = await ncall("GET", "/v1/products/search", "", undefined).catch(async () => ncall("POST", "/v1/products/search", "", { page: 1, size: 50 })); out.products = JSON.stringify(r).slice(0, 1500) } catch (e: any) { out.products = String(e?.message || e) }
  }
  return Response.json(out)
}
export const config: Config = { path: "/api/onetime-naver" }
