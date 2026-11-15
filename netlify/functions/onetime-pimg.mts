// 임시: 귤 상품사진 확인·교체 — 작업 후 삭제
import type { Config } from "@netlify/functions"
import { ncall, naverUploadImage } from "./_lib/naver.mts"
import { getProduct, normImg } from "./_lib/coupang.mts"
export default async (req: Request) => {
  const u = new URL(req.url)
  const tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || u.searchParams.get("t") !== tok) return new Response("no", { status: 403 })
  const p: any = await getProduct("16417633126")
  const opts = (p.items || []).map((it: any) => ({ name: it.itemName, imgs: (it.images || []).map((x: any) => ({ type: x.imageType, url: normImg(x.cdnPath || x.vendorPath) })) }))
  if (u.searchParams.get("show") === "1") {
    const cell = (src: string, label: string) => `<div style="display:inline-block;width:150px;margin:3px;vertical-align:top;font:bold 13px sans-serif"><div style="background:#000;color:#ff0;padding:2px 4px">${label}</div><img referrerpolicy="no-referrer" src="${src}" style="width:150px;display:block"></div>`
    const html = opts.map((o: any) => `<div style="padding:4px;background:#fff;margin:4px 0"><b style="font:bold 16px sans-serif">${o.name}</b><br>${o.imgs.map((im: any, i: number) => cell(im.url, `${i + 1} ${im.type === "REPRESENTATION" ? "대표" : "추가"}`)).join("")}</div>`).join("")
    return new Response(`<html><body style="margin:0;background:#ddd">${html}</body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } })
  }
  if (u.searchParams.get("apply") === "1") {
    // 네이버 상품별: 대표 = 해당 옵션들의 쿠팡 대표사진, 추가 = 그 다음 옵션 대표 + 공통 추가사진 (제외 목록 빼고)
    const skip = new Set((u.searchParams.get("skip") || "").split(",").filter(Boolean))
    const byName = (k: string) => opts.find((o: any) => String(o.name).includes(k))
    const rep = (o: any) => o?.imgs.find((x: any) => x.type === "REPRESENTATION")?.url
    const plan: Record<string, string[]> = { "13814609094": ["2kg", "3kg"], "13814609279": ["5kg"] }
    const out: any = {}
    for (const [no, kgs] of Object.entries(plan)) {
      const mains = kgs.map((k) => rep(byName(k))).filter(Boolean)
      const extras: string[] = []
      for (const k of kgs) for (const [i, im] of (byName(k)?.imgs || []).entries()) if (im.type !== "REPRESENTATION" && !skip.has(`${k}-${i + 1}`) && !extras.includes(im.url) && !mains.includes(im.url)) extras.push(im.url)
      const list = [...new Set([...mains, ...extras])].slice(0, 10)
      const up: string[] = []
      for (const [i, s] of list.entries()) up.push(await naverUploadImage(s, `yura-${no}-${i}.jpg`))
      const g: any = await ncall("GET", `/v2/products/origin-products/${no}`)
      g.originProduct.images = { representativeImage: { url: up[0] }, optionalImages: up.slice(1).map((url) => ({ url })) }
      await ncall("PUT", `/v2/products/origin-products/${no}`, "", { originProduct: g.originProduct, smartstoreChannelProduct: g.smartstoreChannelProduct })
      out[no] = { count: up.length, source: list }
    }
    return Response.json(out)
  }
  return Response.json(opts)
}
export const config: Config = { path: "/api/onetime-pimg" }
