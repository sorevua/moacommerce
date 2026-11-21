// 2026-11-21 사장님 요청: 11-20에 바꾼 행운 상품 사진을 원래대로 되돌린다
//  - 대표사진: fp/mNN.jpg → 처음 등록 때 쓴 사진 (공개 이미지 lk-<상품ID>[-묶음]-main.jpg)
//  - 상세페이지: 맨 앞에 넣은 배송 지연 이미지·상품 사진(fp/)을 빼고, 원래 있던 출고 안내 문구(lk-notice)를 다시 넣는다
//  - 상품명(2026년 햇양파)은 그대로 둔다
// job.dry=true 면 바꾸지 않고 상태만 기록한다
import { getStore } from "@netlify/blobs"
import { isInternal } from "./_lib/auth.mts"
import { getProduct, call } from "./_lib/coupang.mts"

const ORIGIN = "https://volqavo.com"
export default async (req: Request) => {
  if (!isInternal(req)) return
  const job: any = await req.json().catch(() => ({}))
  const st = getStore({ name: "admin-settings", consistency: "strong" })
  const pub = getStore({ name: "public-images", consistency: "strong" })
  const reg: any = (await st.get("lucky-reg", { type: "json" })) || { done: {} }
  const prog: any = (await st.get("lucky-photos", { type: "json" })) || { done: {} }
  const rv: any = (await st.get("lucky-photos-revert", { type: "json" })) || { done: {}, fail: {} }
  rv.status = {}; rv.running = true; await st.setJSON("lucky-photos-revert", rv)
  const started = Date.now()
  for (const [id, d] of Object.entries<any>(reg.done || {})) {
    if (!d?.ok) continue
    const spids: string[] = (d.sellerProductIds?.length ? d.sellerProductIds : [d.sellerProductId]).filter(Boolean).map(String)
    const notice = String(d.shipKey || "").split("|").slice(1).join("|").trim()
    for (const [gi, sp] of spids.entries()) {
      const pr = prog.done[sp]
      if (!pr || rv.done[sp] || Date.now() - started > 13 * 60e3) continue
      try {
        const p: any = await getProduct(sp)
        rv.status[sp] = p.statusName || p.status || ""
        let mainKey = ""
        for (const k of [`lk-${id}-${gi}-main.jpg`, `lk-${id}-main.jpg`]) { if (await pub.getMetadata(k)) { mainKey = k; break } }
        if (pr.num && !mainKey) throw new Error("원래 대표사진을 찾지 못함")
        for (const it of p.items || []) {
          if (pr.num) it.images = [{ imageOrder: 0, imageType: "REPRESENTATION", vendorPath: `${ORIGIN}/img/${mainKey}` }, ...(it.images || []).filter((x: any) => x.imageType !== "REPRESENTATION")]
          const added = pr.num ? 2 : 1
          const rest = (it.contents || []).slice(added).filter((c: any) => !(c.contentDetails || []).some((x: any) => /\/fp\/|lk-notice/.test(String(x.content || ""))))
          const html = notice ? `<div class="lk-notice" style="text-align:center;padding:18px 12px;font-size:18px;line-height:1.7;color:#222">${notice.split("\n").map((l) => l.replace(/[<>&]/g, "")).join("<br>")}</div>` : ""
          it.contents = [...(html ? [{ contentsType: "TEXT", contentDetails: [{ content: html, detailType: "TEXT" }] }] : []), ...rest]
        }
        if (job.dry) { rv.status[sp] += ` | 대표:${pr.num ? mainKey : "그대로"} | 문구:${notice ? "O" : "X"}`; continue }
        p.requested = true
        const r: any = await call("PUT", "/v2/providers/seller_api/apis/api/v1/marketplace/seller-products", "", p)
        if (r && r.code && !/SUCCESS|200/i.test(String(r.code))) throw new Error(JSON.stringify(r).slice(0, 160))
        rv.done[sp] = { id, at: new Date().toISOString() }; delete rv.fail[sp]
      } catch (e: any) { rv.fail[sp] = String(e?.message || e).slice(0, 200) }
      await st.setJSON("lucky-photos-revert", rv)
    }
  }
  rv.running = false; rv.finished = new Date().toISOString(); await st.setJSON("lucky-photos-revert", rv)
}
