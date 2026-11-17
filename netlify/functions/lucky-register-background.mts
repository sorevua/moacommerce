// 행운프레시(B2B) 상품을 쿠팡에 한꺼번에 등록한다. 한 번에 몇 개씩 하고 스스로 다음 묶음을 부른다.
import { getStore } from "@netlify/blobs"
import { isLoggedIn, isInternal, internalKey } from "./_lib/auth.mts"
import { luckyProducts } from "./_lib/luckyfresh.mts"
import { getProduct, call } from "./_lib/coupang.mts"
import { createNew } from "./coupang-work-background.mts"

const settings = () => getStore({ name: "admin-settings", consistency: "strong" })
const vendors = () => getStore({ name: "admin-vendors", consistency: "strong" })
const pub = () => getStore({ name: "public-images", consistency: "strong" })
const SKIP = /택배\s*박스|리뷰\s*마케팅|절임\s*배추/ // 절임배추는 출고희망일을 받아야 해서 자동 등록에서 뺀다

async function driveList(id: string) {
  const r = await fetch(`https://drive.google.com/embeddedfolderview?id=${id}#list`, { headers: { "accept-language": "ko" } })
  const html = await r.text()
  const files = [...html.matchAll(/\/file\/d\/([\w-]+)\/[^"]*"[\s\S]*?flip-entry-title">([^<]+)</g)].map((m) => ({ id: m[1], name: m[2].normalize("NFC") })).filter((f) => /\.(png|jpe?g|webp)$/i.test(f.name))
  const folders = [...html.matchAll(/\/drive\/folders\/([\w-]+)"[\s\S]*?flip-entry-title">([^<]+)</g)].map((m) => ({ id: m[1], name: m[2].normalize("NFC") }))
  return { files, folders }
}
// 사진이 하위 폴더에 나뉘어 있으면 상품 이름과 가장 비슷한 폴더를 고른다
async function driveFiles(link: string, productName: string) {
  const id = (String(link).match(/folders\/([\w-]+)/) || [])[1]
  if (!id) return []
  const top = await driveList(id)
  if (top.files.length || !top.folders.length) return top.files
  const norm = (x: string) => x.replace(/[^가-힣a-zA-Z0-9]/g, "")
  const pn = norm(productName)
  const score = (n: string) => { const a = norm(n); if (!a) return 0; if (pn.includes(a)) return 100 + a.length; let c = 0; for (const ch of new Set(a)) if (pn.includes(ch)) c++; return c / a.length }
  const best = top.folders.map((f) => ({ f, sc: score(f.name) })).sort((a, b) => b.sc - a.sc)[0]
  if (!best || best.sc < 0.6) return []
  return (await driveList(best.f.id)).files
}
function jpegSize(ab: ArrayBuffer) {
  const b = new Uint8Array(ab); let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue }
    const m = b[i + 1]
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] }
    i += 2 + ((b[i + 2] << 8) | b[i + 3])
  }
  return { w: 0, h: 0 }
}
// 드라이브 사진을 JPG로 줄여 우리 저장소에 복사한다 (원본이 지워져도 상세페이지가 깨지지 않게)
async function copyImage(origin: string, fileId: string, key: string, opt: string) {
  const have: any = await pub().getMetadata(key).catch(() => null)
  if (have) return `${origin}/img/${key}`
  const src = `https://lh3.googleusercontent.com/d/${fileId}=s0`
  let lastErr = ""
  for (const q of [85, 72, 58]) {
    const r = await fetch(`${origin}/.netlify/images?url=${encodeURIComponent(src)}&${opt}&fm=jpg&q=${q}`)
    if (!r.ok) { lastErr = `변환 실패 ${r.status}`; continue }
    const ab = await r.arrayBuffer()
    if (ab.byteLength > 4_200_000) { lastErr = `너무 큼 ${ab.byteLength}`; continue }
    if (ab.byteLength < 2000) { lastErr = "빈 사진"; continue }
    const sz = jpegSize(ab)
    await pub().set(key, ab, { metadata: { type: "image/jpeg", w: sz.w, h: sz.h } })
    return `${origin}/img/${key}`
  }
  throw new Error("사진 준비 실패: " + lastErr)
}
function priceOf(supply: number, s: any) {
  const d = { marginRate: 0.15, extraShipping: 0, coupangFee: 0.106, naverSalesFee: 0.0273, naverPayFee: 0.033, vatOnFee: 0.1, roundUnit: 100, sameMarketPrice: 1, ...(s || {}) }
  const cost = supply + Number(d.extraShipping || 0), unit = Number(d.roundUnit || 100), up = (x: number) => Math.ceil(x / unit) * unit
  const cp = up(cost / (1 - d.coupangFee * (1 + d.vatOnFee) - d.marginRate)), np = up(cost / (1 - (d.naverSalesFee + d.naverPayFee) * (1 + d.vatOnFee) - d.marginRate))
  return Number(d.sameMarketPrice) ? Math.max(cp, np) : cp
}
// 옵션 이름에서 개당 중량(g)을 읽는다: "(60-69g)" → 65, "(130g 이상)" → 130, "5kg (25과 내외)" → 200. 못 읽으면 0
function pieceGram(nm: string) {
  const t = String(nm)
  const rg = t.match(/(\d+)\s*[-~]\s*(\d+)\s*g(?!\w)/i); if (rg) return Math.round((Number(rg[1]) + Number(rg[2])) / 2)
  const one = t.match(/(\d+)\s*g\s*(?:이상|이하|내외)/i); if (one) return Number(one[1])
  const kg = t.match(/(\d+(?:\.\d+)?)\s*kg/i), cnt = t.match(/(\d+)\s*(?:[-~]\s*(\d+))?\s*(?:과|입|수|개|통)(?!\w)/)
  if (kg && cnt) { const c = cnt[2] ? (Number(cnt[1]) + Number(cnt[2])) / 2 : Number(cnt[1]); if (c > 0) return Math.round(Number(kg[1]) * 1000 / c) }
  return 0
}
// 옵션 전체 무게(g): "5kg" → 5000, "750g 2팩" → 1500, "300g*4팩" → 1200. 못 읽으면 0
function totalGram(nm: string) {
  const t = String(nm), kg = t.match(/(\d+(?:\.\d+)?)\s*kg/i)
  if (kg) return Math.round(Number(kg[1]) * 1000)
  const g = t.match(/(\d+)\s*g(?!\w)/i), pk = t.match(/(\d+)\s*(?:팩|봉|박스|개)(?!\w)/)
  if (g) return Number(g[1]) * (pk ? Number(pk[1]) : 1)
  return 0
}
const clean = (x: string) => String(x || "").replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}✅]/gu, "").replace(/맛없으면\s*환불/g, "").replace(/\s{2,}/g, " ").trim()

export default async (req: Request) => {
  const job = await req.json().catch(() => ({}))
  const tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!isLoggedIn(req) && !isInternal(req) && !(tok && job.token === tok)) return
  const origin = new URL(req.url).origin
  const st: any = (await settings().get("lucky-reg", { type: "json" })) || { done: {} }
  const save = () => settings().setJSON("lucky-reg", { ...st, at: new Date().toISOString() })
  const started = Date.now()
  try {
    st.running = true; st.error = ""; await save()
    const plist: any[] = (await luckyProducts(false)).data?.products || []
    const cfg: any = await settings().get("settings", { type: "json" })
    // 행운프레시 업체(없으면 만든다)에 모든 옵션을 담아 둔다 → 주문이 들어오면 자동 연결
    const { blobs } = await vendors().list()
    const vlist: any[] = (await Promise.all(blobs.map((b) => vendors().get(b.key, { type: "json" })))).filter(Boolean)
    let v = vlist.find((x) => x.lucky)
    if (!v) { v = { id: crypto.randomUUID(), name: "행운프레시", status: "거래 중", kind: "B2B", lucky: true, products: [], sender: {}, order: { method: "API", cutoff: "09:30", prepay: true }, photoIds: [], listing: null, createdAt: new Date().toISOString() } }
    // 연결 단계: 승인된 상품의 쿠팡 옵션ID를 업체 상품에 넣는다 (주문 자동 연결). 출고 소요일이 다르면 고쳐서 다시 요청
    if (job.mode === "link") {
      let n = 0
      for (const [pid, d] of Object.entries(st.done) as any) {
        if (!d.ok || d.linked || Date.now() - started > 11 * 60e3) continue
        try {
          const cp: any = await getProduct(String(d.sellerProductId))
          d.cpStatus = cp.statusName
          const items: any[] = cp.items || []
          let filled = 0
          for (const o of d.options || []) {
            const it = items.find((x) => x.itemName === o.name)
            const vp = v.products.find((x: any) => x.luckyOptionId === o.id)
            if (it?.vendorItemId && vp) { vp.coupangItemId = String(it.vendorItemId); filled++ }
          }
          if (filled) { v.updatedAt = new Date().toISOString(); await vendors().setJSON(v.id, v) }
          const days = Number(job.shipDays || 0)
          if (days && items.some((x) => Number(x.outboundShippingTimeDay) !== days)) {
            for (const x of items) x.outboundShippingTimeDay = days
            cp.requested = true
            const r: any = await call("PUT", "/v2/providers/seller_api/apis/api/v1/marketplace/seller-products", "", cp)
            d.shipFix = String(r?.code || r?.message || "").slice(0, 80)
          }
          d.linkedCount = filled; d.linked = filled === (d.options || []).length; n++
        } catch (e: any) { d.linkError = String(e?.message || e).slice(0, 200) }
        await save()
      }
      const left = (Object.values(st.done) as any[]).filter((d) => d.ok && !d.linked && !d.linkError).length
      st.running = false; st.linkLeft = left; await save()
      return
    }
    const want: string[] = (job.productIds?.length ? job.productIds : plist.map((p) => p.id)).filter((id: string) => { const p = plist.find((x) => x.id === id); return p && !SKIP.test(p.name) })
    // 실패한 것은 retry 일 때만 다시, 같은 상품은 최대 3번까지만
    const todo = want.filter((id) => !st.done[id]?.ok && !(st.done[id]?.error && (!job.retry || Number(st.done[id]?.tries || 1) >= 3)))
    st.total = want.length; st.left = todo.length; await save()
    const tpl = await getProduct(String(job.templateId))
    let n = 0
    for (const id of todo) {
      if (Date.now() - started > 11 * 60e3 || n >= Number(job.batch || 8)) break
      n++
      const p = plist.find((x) => x.id === id)
      const name = clean(p.name)
      try {
        const opts = (p.options || []).filter((o: any) => o.status === "판매중")
        if (!opts.length) throw new Error("판매중인 옵션이 없습니다.")
        const files = await driveFiles(p.photoDriveLink || "", String(p.name))
        if (!files.length) throw new Error("사진 폴더에서 이 상품 사진을 찾지 못했습니다.")
        // 이름에 썸네일·대표가 있으면 대표사진. 나머지는 올려 보고 세로로 긴 것(상세페이지)과 일반 사진으로 나눈다
        let thumb = files.find((f) => /썸네일|대표|메인/.test(f.name))
        const rest = files.filter((f) => f !== thumb).sort((a, b) => Number(/상세/.test(b.name)) - Number(/상세/.test(a.name))).slice(0, 8)
        const tall: string[] = [], normal: { url: string; id: string }[] = []
        for (let i = 0; i < rest.length; i++) {
          const key = `lk-${id}-d${i}.jpg`
          const url = await copyImage(origin, rest[i].id, key, "w=860")
          const md: any = (await pub().getMetadata(key).catch(() => null))?.metadata || {}
          if (Number(md.h) > Number(md.w) * 2 || /상세/.test(rest[i].name)) tall.push(url); else normal.push({ url, id: rest[i].id })
        }
        const contentImages: string[] = tall.length ? tall.slice(0, 6) : normal.map((x) => x.url).slice(0, 8)
        if (!contentImages.length && !thumb) throw new Error("사진 폴더에 쓸 수 있는 사진이 없습니다.")
        let mainImage = ""
        if (thumb) mainImage = await copyImage(origin, thumb.id, `lk-${id}-main.jpg`, "w=1000&h=1000&fit=cover")
        else if (normal.length) mainImage = await copyImage(origin, normal[0].id, `lk-${id}-main.jpg`, "w=1000&h=1000&fit=cover")
        else mainImage = await copyImage(origin, rest[0].id, `lk-${id}-main.jpg`, "w=1000&h=1000&fit=cover&position=top") // 상세페이지 맨 위를 잘라 대표사진으로
        if (!contentImages.length) contentImages.push(mainImage)
        // 업체 상품에 담기
        for (const o of p.options || []) {
          const nm = `${String(p.name).trim()} ${String(o.name).trim()}`, supply = Number(o.price) + Number(o.shippingFee || 0)
          const ex = v.products.find((x: any) => x.luckyOptionId === o.id)
          if (ex) { ex.supplyPrice = supply; ex.luckySoldOut = o.status !== "판매중" }
          else v.products.push({ name: nm, supplyPrice: supply, coupangItemId: "", naverItemId: "", luckyProductId: p.id, luckyOptionId: o.id, luckyProductName: String(p.name).trim(), luckyPhotos: p.photoDriveLink || "", luckySoldOut: o.status !== "판매중" })
        }
        v.updatedAt = new Date().toISOString(); await vendors().setJSON(v.id, v)
        const jobId = `lk-${id}-${Date.now()}`
        const optNames = opts.map((o: any) => clean(`${o.name}${o.prefixName ? " " + o.prefixName : ""}`).slice(0, 60))
        await createNew({
          jobId, origin, tpl, templateId: job.templateId, name, displayName: name,
          options: opts.map((o: any, i: number) => ({ name: optNames[i], price: priceOf(Number(o.price) + Number(o.shippingFee || 0), cfg) })),
          facts: `도매 공급 상품. 상품명: ${name}. 원산지·생산자 등 확인되지 않은 정보는 '상세페이지 참조'로 적는다. 무료배송.`,
          // 개당 중량을 못 읽으면 '1박스 = 전체 무게'로 적는다 (수량 1개 × 전체 무게, 지어낸 숫자를 쓰지 않음)
          perPieceGram: Object.fromEntries(optNames.map((n: string) => [n, pieceGram(n) || totalGram(n)]).filter((x: any) => x[1] > 0)),
          mainImage, contentImages, photos: [], vendorId: v.id, fullAttr: true, requestApproval: !!job.requestApproval, shipDays: Number(job.shipDays || 0),
          outboundShippingPlaceCode: job.outboundShippingPlaceCode, returnCenterCode: job.returnCenterCode, deliveryCompanyCode: job.deliveryCompanyCode,
        })
        const r: any = await settings().get(`create-${jobId}`, { type: "json" })
        if (!r?.ok) throw new Error((r?.error || "등록 실패") + " | " + (r?.log || []).slice(-3).join(" / "))
        st.done[id] = { ok: true, name, sellerProductId: r.sellerProductId, options: opts.map((o: any, i: number) => ({ id: o.id, name: optNames[i] })), at: new Date().toISOString(), log: (r.log || []).slice(-4) }
      } catch (e: any) {
        st.done[id] = { ok: false, name, error: String(e?.message || e).slice(0, 600), at: new Date().toISOString(), tries: Number(st.done[id]?.tries || 0) + 1 }
      }
      st.left = want.filter((x) => !st.done[x]?.ok && !st.done[x]?.error).length; await save()
    }
    const remain = want.filter((x) => !st.done[x]).length
    st.running = remain > 0 && !job.once; await save()

    st.running = false; await save() // 스스로 다음 묶음을 부르지 않는다 (Netlify 가 함수 연쇄 호출을 막음). 바깥에서 묶음마다 다시 부른다
  } catch (e: any) { st.running = false; st.error = String(e?.message || e); await save() }
}
