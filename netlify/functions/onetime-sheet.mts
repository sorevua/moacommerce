// 임시: 네이버 귤 상세 사진 모아보기 — 작업 후 삭제
import type { Config } from "@netlify/functions"
import { ncall } from "./_lib/naver.mts"
export default async (req: Request) => {
  const u = new URL(req.url)
  const tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || u.searchParams.get("t") !== tok) return new Response("no", { status: 403 })
  const no = u.searchParams.get("no") || "13814609094"
  const o: any = await ncall("GET", `/v2/products/origin-products/${no}`)
  const op = o.originProduct
  const det = [...String(op.detailContent || "").matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1])
  const imgs = [op.images?.representativeImage?.url, ...(op.images?.optionalImages || []).map((x: any) => x.url)].filter(Boolean)
  if (u.searchParams.get("json")) return Response.json({ imgs, det })
  const w = Number(u.searchParams.get("w") || 170)
  const cell = (src: string, label: string) => `<div style="display:inline-block;width:${w}px;margin:3px;vertical-align:top;font:bold 14px sans-serif"><div style="background:#000;color:#ff0;padding:2px 4px">${label}</div><img src="${src}?type=w500" style="width:${w}px;display:block"></div>`
  const part = u.searchParams.get("part") || "det"
  const html = `<html><body style="margin:0;background:#ddd">${part === "img" ? imgs.map((s, i) => cell(s, i === 0 ? "대표" : "추가" + i)).join("") : det.map((s, i) => cell(s, "상세" + (i + 1))).join("")}</body></html>`
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } })
}
export const config: Config = { path: "/api/onetime-sheet" }
