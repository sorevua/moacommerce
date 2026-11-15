// 임시: 네이버 등록 준비 — 작업 후 삭제
import type { Config } from "@netlify/functions"
import { ncall } from "./_lib/naver.mts"
import { getProduct } from "./_lib/coupang.mts"
export default async (req: Request) => {
  const u = new URL(req.url)
  const tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || u.searchParams.get("t") !== tok) return new Response("no", { status: 403 })
  const q = u.searchParams.get("q"), off = Number(u.searchParams.get("o") || 0), len = Number(u.searchParams.get("n") || 6000)
  let r: any
  try {
    if (q === "origin") r = await ncall("GET", `/v2/products/origin-products/${u.searchParams.get("id") || "13763431198"}`)
    else if (q === "addr") r = await ncall("GET", "/v1/seller/addressbooks-for-page", "page=1&size=50")
    else if (q === "cat") { const all: any[] = await ncall("GET", "/v1/categories", "last=true"); const k = u.searchParams.get("k") || "키위"; r = all.filter((c: any) => String(c.wholeCategoryName).includes(k)) }
    else if (q === "cp") { const p: any = await getProduct(u.searchParams.get("id") || "16417633126"); r = { name: p.sellerProductName, display: p.displayProductName, items: (p.items || []).map((i: any) => ({ n: i.itemName, price: i.salePrice, img: (i.images || []).map((x: any) => x.cdnPath || x.vendorPath) })), contents: JSON.stringify(p.items?.[0]?.contents || []).slice(0, 3000) } }
    else if (q === "all") {
      const o: any = await ncall("GET", "/v2/products/origin-products/13763431198"); delete o.originProduct.detailContent
      const addr: any = await ncall("GET", "/v1/seller/addressbooks-for-page", "page=1&size=50")
      const all: any[] = await ncall("GET", "/v1/categories", "last=true")
      const cats = all.filter((c: any) => /키위|감귤|귤|한라봉|만감/.test(String(c.wholeCategoryName)) && /과일/.test(String(c.wholeCategoryName))).map((c: any) => [c.id, c.wholeCategoryName])
      r = { origin: o, addr, cats }
    }
    else if (q === "run") {
      const only = (u.searchParams.get("only") || "").split(",").filter(Boolean)
      await fetch(new URL("/.netlify/functions/onetime-nvreg-background", req.url), { method: "POST", body: JSON.stringify({ token: tok, only: only.length ? only : undefined }) })
      r = { started: true }
    }
    else if (q === "status") { const { getStore } = await import("@netlify/blobs"); r = await getStore({ name: "admin-settings", consistency: "strong" }).get("nvreg", { type: "json" }) }
    else if (q === "addaddr") {
      const body = { name: "광양 키위농가", addressType: "GENERAL", postalCode: "57707", baseAddress: "전라남도 광양시 진상면 신시3길", detailAddress: "13-23", phoneNumber1: "010-8587-0003", roadNameAddress: true }
      r = {}
      for (const [m, path] of [["POST", "/v1/seller/addressbooks"], ["POST", "/v1/seller/addressbook"], ["POST", "/v1/seller/address-books"]] as const) {
        try { r[path] = await ncall(m, path, "", body) ; break } catch (e: any) { r[path] = String(e?.message || e).slice(0, 300) }
      }
    }
    else if (q === "map") {
      const { getStore } = await import("@netlify/blobs")
      const V = getStore({ name: "admin-vendors", consistency: "strong" })
      const plan: Record<string, string[]> = { "jeju-dameun": ["13814609094", "13814609279"], "gwangyang-kiwi": ["13814619964", "13814620214"] }
      r = {}
      for (const [vid, nos] of Object.entries(plan)) {
        const v: any = await V.get(vid, { type: "json" }); if (!v) { r[vid] = "업체 없음"; continue }
        const combos: any[] = []
        for (const no of nos) { const o: any = await ncall("GET", `/v2/products/origin-products/${no}`); for (const c of o?.originProduct?.detailAttribute?.optionInfo?.optionCombinations || []) combos.push({ id: String(c.id), name: c.optionName1, price: o.originProduct.salePrice + Number(c.price) }) }
        const done: any[] = []
        for (const p of v.products || []) {
          const kg = (String(p.name).match(/\d+kg/i) || [""])[0].toLowerCase()
          const hit = combos.find((c) => c.name === p.name) || (vid === "jeju-dameun" ? combos.find((c) => String(c.name).toLowerCase().includes(kg)) : null)
          if (hit) { p.naverItemId = hit.id; done.push([p.name, hit.name, hit.id, hit.price]) }
        }
        v.updatedAt = new Date().toISOString(); await V.setJSON(vid, v)
        r[vid] = { done, combos }
      }
    }
    else r = { error: "q?" }
  } catch (e: any) { r = { error: String(e?.message || e) } }
  const s = JSON.stringify(r)
  return new Response(s.slice(off, off + len) + `\n[len=${s.length}]`, { headers: { "content-type": "text/plain; charset=utf-8" } })
}
export const config: Config = { path: "/api/onetime-nv" }
