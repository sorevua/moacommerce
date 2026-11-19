// 행운 상품의 쿠팡 대표사진을 AI 사진으로 바꾼다. 두 단계로 나눈다.
//  1) gen  : 대상 상품마다 AI 대표사진을 만들어 저장만 한다 (쿠팡은 건드리지 않음) → 사장님이 미리보기로 확인
//  2) apply: 사장님이 고른 상품만 쿠팡 대표사진을 바꾸고 다시 승인 요청
// 가정용·실속·못난이 등 흠과가 섞이는 상품과 수박, 채소·해조류는 대상에서 뺀다 (실제보다 좋아 보이면 클레임 위험)
import { getStore } from "@netlify/blobs"
import { isLoggedIn, isInternal } from "./_lib/auth.mts"
import { getProduct, updateProductContent, normImg } from "./_lib/coupang.mts"
import { makeMainImage } from "./_lib/image-gen.mts"

const settings = () => getStore({ name: "admin-settings", consistency: "strong" })
export const EXCLUDE = /가정용|실속|못난이|흠과|B급|파지|봉지|수박|세척/
export const FRUIT = /레몬|단감|감귤|키위|참다래|망고|석류|블루베리|사과|체리|용과|자몽|라임|황금향|샤인머스켓|무화과|아보카도|시나노골드|배$|배\s|추황배|신고배|대봉감|반시|감홍|토마토/

export function eligible(name: string) {
  return !EXCLUDE.test(name) && FRUIT.test(name)
}

export default async (req: Request) => {
  if (!isLoggedIn(req) && !isInternal(req)) return
  const job = await req.json().catch(() => ({}))
  const origin = new URL(req.url).origin
  const started = Date.now()
  const reg: any = (await settings().get("lucky-reg", { type: "json" })) || { done: {} }
  const st: any = (await settings().get("lucky-mainimg", { type: "json" })) || { items: {} }
  const save = () => settings().setJSON("lucky-mainimg", { ...st, at: new Date().toISOString() })
  st.running = true; await save()
  try {
    const only: string[] = Array.isArray(job.ids) ? job.ids : []
    const targets = Object.entries(reg.done || {}).filter(([id, d]: any) => d.ok && eligible(String(d.name || "")) && (!only.length || only.includes(id)))
    if (job.mode === "gen") {
      const limit = Number(job.limit || 5)
      let n = 0
      for (const [id, d] of targets as any) {
        if (n >= limit || Date.now() - started > 12 * 60e3) break
        const cur = st.items[id]
        if (cur?.url && !job.redo) continue
        const spids: string[] = (d.sellerProductIds?.length ? d.sellerProductIds : [d.sellerProductId]).map(String)
        let oldUrl: any = ""
        try { const cp: any = await getProduct(spids[0]); oldUrl = cp.items?.[0]?.images?.find((x: any) => x.imageType === "REPRESENTATION"); oldUrl = normImg(oldUrl?.cdnPath || oldUrl?.vendorPath || "") } catch {}
        const what = `${String(d.name).replace(/GAP|HACCP|인증|정품|프리미엄|특품|,/g, " ").replace(/\s+/g, " ").trim()} (Korean fresh produce, as sold in Korea)`
        const r = await makeMainImage(what, origin)
        st.items[id] = { name: d.name, spids, oldUrl, url: r.url || "", score: r.score || 0, err: r.ok ? "" : String(r.error || "").slice(0, 160), at: new Date().toISOString() }
        n++; await save()
      }
    }
    if (job.mode === "apply") {
      for (const id of only) {
        const it = st.items[id]
        if (!it?.url || it.applied) continue
        try {
          for (const sp of it.spids) {
            const cp: any = await getProduct(sp)
            const mainImages = Object.fromEntries((cp.items || []).map((x: any) => [String(x.vendorItemId), it.url]))
            const r: any = await updateProductContent(sp, { mainImages })
            if (r && r.code && !/SUCCESS|200/i.test(String(r.code))) throw new Error(JSON.stringify(r).slice(0, 160))
          }
          it.applied = new Date().toISOString(); delete it.applyErr
        } catch (e: any) { it.applyErr = String(e?.message || e).slice(0, 200) }
        await save()
      }
    }
  } finally {
    st.running = false; await save()
  }
}
