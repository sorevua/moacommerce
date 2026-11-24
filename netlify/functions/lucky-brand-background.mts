// 2026-11-24 사장님 요청
//  1) 가을단감 특대과 옵션 쿠팡 판매중지 (행운 11/25 마감 후 품절 예정)
//  2) 행운 상품의 쿠팡 브랜드 "브랜드 없음(GENERIC)" → "모아커머스"
//     쿠팡이 제안한 브랜드(갭·돌·부사 등)는 인증마크·남의 상표·품종명이라 쓰지 않는다
import { getStore } from "@netlify/blobs"
import { isInternal } from "./_lib/auth.mts"
import { getProduct, call, stopSale } from "./_lib/coupang.mts"

export default async (req: Request) => {
  if (!isInternal(req)) return
  const st = getStore({ name: "admin-settings", consistency: "strong" })
  const reg: any = (await st.get("lucky-reg", { type: "json" })) || { done: {} }
  const rv: any = (await st.get("lucky-brand", { type: "json" })) || { done: {}, fail: {}, stopped: [] }
  rv.running = true; await st.setJSON("lucky-brand", rv)
  const started = Date.now()
  for (const d of Object.values<any>(reg.done || {})) {
    if (!d?.ok) continue
    const spids: string[] = (d.sellerProductIds?.length ? d.sellerProductIds : [d.sellerProductId]).filter(Boolean).map(String)
    for (const sp of spids) {
      if (rv.done[sp] || Date.now() - started > 13 * 60e3) continue
      try {
        const p: any = await getProduct(sp)
        const nm = String(p.sellerProductName || "")
        if (/단감/.test(nm)) for (const it of p.items || []) {
          if (/특대/.test(String(it.itemName || "")) && !rv.stopped.includes(String(it.vendorItemId))) { await stopSale(String(it.vendorItemId)); rv.stopped.push(String(it.vendorItemId)); rv.stoppedNames = [...(rv.stoppedNames || []), `${nm} / ${it.itemName}`] }
        }
        if (p.brand !== "모아커머스") {
          p.brand = "모아커머스"; p.requested = true
          const r: any = await call("PUT", "/v2/providers/seller_api/apis/api/v1/marketplace/seller-products", "", p)
          if (r && r.code && !/SUCCESS|200/i.test(String(r.code))) throw new Error(JSON.stringify(r).slice(0, 160))
        }
        rv.done[sp] = nm; delete rv.fail[sp]
      } catch (e: any) { rv.fail[sp] = String(e?.message || e).slice(0, 200) }
      await st.setJSON("lucky-brand", rv)
    }
  }
  rv.running = false; rv.finished = new Date().toISOString(); await st.setJSON("lucky-brand", rv)
}
