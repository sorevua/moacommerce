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
  if (u.searchParams.get("fix") === "1") {
    const ROWS: Record<string, [string, string][]> = {
      "13814609094": [["2kg 1박스", "처음 맛보거나 가볍게 드셔 보고 싶은 분"], ["3kg 1박스", "가족이 함께 넉넉히 나눠 드시고 싶은 분"]],
      "13814609279": [["5kg 1박스", "오래 두고 많이 드시거나 여럿이 나누고 싶은 분"]],
    }
    const common: [string, string][] = [
      ["중량 기준", "표기된 중량은 상자를 포함한 무게입니다."],
      ["고르는 법", "껍질에 윤기가 있고 들었을 때 크기에 비해 묵직한 것이 과즙이 많습니다."],
      ["받으면 바로", "상자를 열어 눌리거나 상한 과일을 먼저 골라내 주세요. 상한 과일이 닿아 있으면 옆 과일까지 쉽게 무릅니다."],
      ["보관", "물기를 닦고 서로 겹치지 않게 펼쳐 서늘하고 통풍이 잘 되는 곳에 두세요. 오래 두고 드실 때는 키친타월이나 신문지로 감싸 냉장고 채소칸에 보관합니다."],
      ["드시는 법", "껍질째 흐르는 물에 씻은 뒤 드세요. 차게 두었다가 드시면 더 상큼합니다."],
    ]
    const tr = (k: string, v: string, hi = false) => `<tr><th style="width:28%;text-align:left;vertical-align:top;padding:14px 10px;border-bottom:1px solid #e3cdb4;color:#5a3a22;font-size:16px;${hi ? "color:#b4511f;" : ""}">${k}</th><td style="padding:14px 10px;border-bottom:1px solid #e3cdb4;color:#4a3a30;font-size:16px;line-height:1.6">${v}</td></tr>`
    const out: any = {}
    for (const [pno, rows] of Object.entries(ROWS)) {
      const g: any = await ncall("GET", `/v2/products/origin-products/${pno}`)
      const cur = [...String(g.originProduct.detailContent || "").matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1])
      if (cur.length < 11) { out[pno] = "이미 수정됨 또는 이미지 수가 다름: " + cur.length; continue }
      const img = (u2: string) => `<img src="${u2}" style="width:100%;max-width:860px;display:block;margin:0 auto">`
      const table = `<div style="max-width:860px;margin:0 auto;background:#f3e6d6;padding:36px 28px;box-sizing:border-box;text-align:left"><div style="width:28px;height:3px;background:#b4511f;margin-bottom:14px"></div><h3 style="margin:0 0 18px;font-size:26px;color:#3b2416;font-weight:700">상품 안내</h3><table style="width:100%;border-collapse:collapse;border-top:1px solid #e3cdb4">${rows.map(([k, v]) => tr(k, v, true)).join("")}${common.map(([k, v]) => tr(k, v)).join("")}</table></div>`
      g.originProduct.detailContent = `<div style="text-align:center">${cur.slice(0, 9).map(img).join("")}${table}${cur.slice(10).map(img).join("")}</div>`
      await ncall("PUT", `/v2/products/origin-products/${pno}`, "", { originProduct: g.originProduct, smartstoreChannelProduct: g.smartstoreChannelProduct })
      out[pno] = "수정 완료"
    }
    return Response.json(out)
  }
  const w = Number(u.searchParams.get("w") || 170)
  const cell = (src: string, label: string) => `<div style="display:inline-block;width:${w}px;margin:3px;vertical-align:top;font:bold 14px sans-serif"><div style="background:#000;color:#ff0;padding:2px 4px">${label}</div><img referrerpolicy="no-referrer" src="${src}" style="width:${w}px;display:block"></div>`
  const part = u.searchParams.get("part") || "det"
  const html = `<html><body style="margin:0;background:#ddd">${part === "img" ? imgs.map((s, i) => cell(s, i === 0 ? "대표" : "추가" + i)).join("") : det.map((s, i) => cell(s, "상세" + (i + 1))).join("")}</body></html>`
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } })
}
export const config: Config = { path: "/api/onetime-sheet" }
