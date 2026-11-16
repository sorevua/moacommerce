// 임시: 인스타 초안 시험 — 확인 후 삭제
import type { Config } from "@netlify/functions"
import { getStore } from "@netlify/blobs"
import { internalKey } from "./_lib/auth.mts"
export default async (req: Request) => {
  const u = new URL(req.url)
  const tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || u.searchParams.get("t") !== tok) return new Response("no", { status: 403 })
  if (u.searchParams.get("run") === "1") { await fetch(new URL("/.netlify/functions/insta-draft-background", req.url), { method: "POST", headers: { "x-internal": internalKey() }, body: JSON.stringify({ force: true }) }); return Response.json({ started: true }) }
  const list: any[] = ((await getStore({ name: "admin-promo", consistency: "strong" }).get("posts", { type: "json" })) as any[]) || []
  const p = list.find((x) => x.auto)
  if (p && u.searchParams.get("img") === "1") return new Response(`<html><body>${p.photos.map((s: string) => `<img src="${s}" style="width:300px">`).join("")}<pre style="white-space:pre-wrap;font:16px sans-serif">${p.body}\n\n${p.tags.map((t: string) => "#" + t).join(" ")}</pre></body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } })
  return Response.json({ last: await getStore({ name: "admin-promo", consistency: "strong" }).get("ig-last", { type: "json" }), post: p || null })
}
export const config: Config = { path: "/api/onetime-ig" }
