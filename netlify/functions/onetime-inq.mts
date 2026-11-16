// 임시: 문의 수집 확인 — 확인 후 삭제
import type { Config } from "@netlify/functions"
import { syncInquiries, listInquiries } from "./_lib/inquiries.mts"
export default async (req: Request) => {
  const u = new URL(req.url)
  const tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || u.searchParams.get("t") !== tok) return new Response("no", { status: 403 })
  const r = await syncInquiries().catch((e: any) => ({ fatal: String(e?.message || e) }))
  const l = await listInquiries()
  return Response.json({ r, count: l.list.length, sample: l.list.slice(0, 3).map((q: any) => ({ ch: q.channel, kind: q.kind, product: q.product, q: String(q.question).slice(0, 80), draft: String(q.draft || "").slice(0, 300), check: q.check })) })
}
export const config: Config = { path: "/api/onetime-inq" }
