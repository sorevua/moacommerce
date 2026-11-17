// 행운프레시(B2B) 상품을 쿠팡에 한꺼번에 등록한다. 한 번에 몇 개씩 하고 스스로 다음 묶음을 부른다.
import { getStore } from "@netlify/blobs"
import { isLoggedIn, isInternal, internalKey } from "./_lib/auth.mts"
import { luckyProducts } from "./_lib/luckyfresh.mts"
import { getProduct } from "./_lib/coupang.mts"
import { createNew } from "./coupang-work-background.mts"

const settings = () => getStore({ name: "admin-settings", consistency: "strong" })
const vendors = () => getStore({ name: "admin-vendors", consistency: "strong" })
const pub = () => getStore({ name: "public-images", consistency: "strong" })
const SKIP = /택배\s*박스|리뷰\s*마케팅/

async function driveFiles(link: string) {
  const id = (String(link).match(/folders\/([\w-]+)/) || [])[1]
  if (!id) return []
  const r = await fetch(`https://drive.google.com/embeddedfolderview?id=${id}#list`, { headers: { "accept-language": "ko" } })
  const html = await r.text()
  return [...html.matchAll(/\/file\/d\/([\w-]+)\/[^"]*"[\s\S]*?flip-entry-title">([^<]+)</g)].map((m) => ({ id: m[1], name: m[2].normalize("NFC") })).filter((f) => /\.(png|jpe?g|webp)$/i.test(f.name))
}
// 드라이브 사진을 JPG로 줄여 우리 저장소에 복사한다 (원본이 지워져도 상세페이지가 깨지지 않게)
async function copyImage(origin: string, fileId: string, key: string, opt: string) {
  const have = await pub().getMetadata(key).catch(() => null)
  if (have) return `${origin}/img/${key}`
  const src = `https://lh3.googleusercontent.com/d/${fileId}=s0`
  let lastErr = ""
  for (const q of [85, 72, 58]) {
    const r = await fetch(`${origin}/.netlify/images?url=${encodeURIComponent(src)}&${opt}&fm=jpg&q=${q}`)
    if (!r.ok) { lastErr = `변환 실패 ${r.status}`; continue }
    const ab = await r.arrayBuffer()
    if (ab.byteLength > 4_200_000) { lastErr = `너무 큼 ${ab.byteLength}`; continue }
    if (ab.byteLength < 2000) { lastErr = "빈 사진"; continue }
    await pub().set(key, ab, { metadata: { type: "image/jpeg" } })
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
    const want: string[] = (job.productIds?.length ? job.productIds : plist.map((p) => p.id)).filter((id: string) => { const p = plist.find((x) => x.id === id); return p && !SKIP.test(p.name) })
    const todo = want.filter((id) => !st.done[id]?.ok && !(st.done[id]?.error && !job.retry))
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
        const files = await driveFiles(p.photoDriveLink || "")
        const thumb = files.find((f) => /썸네일|대표/.test(f.name)) || files.find((f) => !/상세/.test(f.name))
        const details = files.filter((f) => /상세/.test(f.name))
        if (!thumb) throw new Error("사진 폴더에 대표사진으로 쓸 사진이 없습니다.")
        if (!details.length) throw new Error("사진 폴더에 상세페이지 이미지가 없습니다.")
        const mainImage = await copyImage(origin, thumb.id, `lk-${id}-main.jpg`, "w=1000&h=1000&fit=cover")
        const contentImages: string[] = []
        for (let i = 0; i < Math.min(details.length, 6); i++) contentImages.push(await copyImage(origin, details[i].id, `lk-${id}-d${i}.jpg`, "w=860"))
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
          mainImage, contentImages, photos: [], vendorId: v.id, fullAttr: true, requestApproval: !!job.requestApproval,
          outboundShippingPlaceCode: job.outboundShippingPlaceCode, returnCenterCode: job.returnCenterCode, deliveryCompanyCode: job.deliveryCompanyCode,
        })
        const r: any = await settings().get(`create-${jobId}`, { type: "json" })
        if (!r?.ok) throw new Error((r?.error || "등록 실패") + " | " + (r?.log || []).slice(-3).join(" / "))
        st.done[id] = { ok: true, name, sellerProductId: r.sellerProductId, options: opts.map((o: any, i: number) => ({ id: o.id, name: optNames[i] })), at: new Date().toISOString(), log: (r.log || []).slice(-4) }
      } catch (e: any) {
        st.done[id] = { ok: false, name, error: String(e?.message || e).slice(0, 600), at: new Date().toISOString() }
      }
      st.left = want.filter((x) => !st.done[x]?.ok && !st.done[x]?.error).length; await save()
    }
    const remain = want.filter((x) => !st.done[x]).length
    st.running = remain > 0 && !job.once; await save()
    if (remain > 0 && !job.once) await fetch(origin + "/.netlify/functions/lucky-register-background", { method: "POST", headers: { "x-internal": internalKey() }, body: JSON.stringify({ ...job, token: undefined, retry: false }) })
  } catch (e: any) { st.running = false; st.error = String(e?.message || e); await save() }
}
