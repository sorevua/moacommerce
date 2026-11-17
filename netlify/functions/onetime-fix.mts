// 임시 (확인 후 삭제): 반려된 상품의 상세 이미지를 가볍게 다시 만들고 승인 재요청
import { getStore } from "@netlify/blobs"
import { getProduct, call, productHistory } from "./_lib/coupang.mts"
export default async (req: Request) => {
  const u = new URL(req.url), t = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!t || u.searchParams.get("t") !== t) return new Response("no", { status: 404 })
  const id = u.searchParams.get("id") || "", out: any = { id }
  const pub = getStore({ name: "public-images", consistency: "strong" })
  try {
    if (u.searchParams.get("a") === "check") { const p: any = await getProduct(id); out.status = p.statusName; out.history = JSON.stringify(await productHistory(id)).slice(0, 500) }
    else {
      const p: any = await getProduct(id)
      out.before = p.statusName
      const urls = new Set<string>()
      for (const it of p.items || []) { for (const c of it.contents || []) for (const d of c.contentDetails || []) if (/\/img\/lk-/.test(d.content || "")) urls.add(d.content); for (const im of it.images || []) if (/\/img\/lk-/.test(im.vendorPath || "")) urls.add(im.vendorPath) }
      out.images = []
      for (const url of urls) {
        const key = url.split("/").pop() as string
        const cur = await pub.get(key, { type: "arrayBuffer" })
        const row: any = { key, bytes: cur?.byteLength || 0 }
        if (cur && cur.byteLength > 1_800_000) {
          for (const q of [60, 45]) {
            const r = await fetch(`${u.origin}/.netlify/images?url=${encodeURIComponent("/img/" + key)}&fm=jpg&q=${q}`)
            if (!r.ok) { row.err = r.status; continue }
            const ab = await r.arrayBuffer()
            if (ab.byteLength > 2000 && ab.byteLength < cur.byteLength) { await pub.set(key, ab, { metadata: { type: "image/jpeg" } }); row.after = ab.byteLength; if (ab.byteLength < 1_800_000) break }
          }
        }
        out.images.push(row)
      }
      p.requested = true
      const r: any = await call("PUT", "/v2/providers/seller_api/apis/api/v1/marketplace/seller-products", "", p)
      out.put = JSON.stringify(r).slice(0, 300)
    }
  } catch (e: any) { out.error = e.message }
  return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json; charset=utf-8" } })
}
