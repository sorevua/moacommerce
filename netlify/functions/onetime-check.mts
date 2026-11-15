// 임시: 쿠팡 반려 사유 확인용 — 확인 후 삭제
import type { Config } from "@netlify/functions"
import { productHistory } from "./_lib/coupang.mts"
export default async (req: Request) => {
  const u = new URL(req.url)
  const tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || u.searchParams.get("t") !== tok) return new Response("no", { status: 403 })
  const ids = (u.searchParams.get("ids") || "").split(",").filter((x) => /^\d+$/.test(x)).slice(0, 5)
  const out: any = {}
  for (const id of ids) out[id] = await productHistory(id)
  return Response.json(out)
}
export const config: Config = { path: "/api/onetime-check" }
