// 임시: 네이버 상품 정보 점검·수정 작업 — 작업 후 삭제
import { getStore } from "@netlify/blobs"
import { ncall } from "./_lib/naver.mts"

const NOS = ["13814609094", "13814609279", "13814619964", "13814620214"]
const st = () => getStore({ name: "admin-settings", consistency: "strong" })
const safe = async (f: () => Promise<any>) => { try { return await f() } catch (e: any) { return { error: String(e?.message || e).slice(0, 600) } } }

export default async (req: Request) => {
  const body: any = await req.json().catch(() => ({}))
  const tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || body.token !== tok) return
  const log: any = { at: new Date().toISOString(), mode: body.mode, running: true }
  const save = () => st().setJSON("nvfix", log)
  await save()
  if (body.mode === "preview") {
    log.products = {}
    const cats = new Set<string>()
    for (const no of NOS) {
      const o: any = await safe(() => ncall("GET", `/v2/products/origin-products/${no}`))
      const p = o?.originProduct
      if (!p) { log.products[no] = o; continue }
      cats.add(String(p.leafCategoryId))
      const da = p.detailAttribute || {}
      log.products[no] = { name: p.name, status: p.statusType, cat: p.leafCategoryId, channelNo: o?.smartstoreChannelProduct?.channelProductNo, tags: da.seoInfo?.sellerTags, search: da.naverShoppingSearchInfo, attrs: da.productAttributes, producer: da.productInfoProvidedNotice?.food?.producer, options: (da.optionInfo?.optionCombinations || []).map((c: any) => c.optionName1) }
      await save()
    }
    log.attrs = {}
    for (const c of cats) {
      const a: any = await safe(() => ncall("GET", "/v1/product-attributes/attributes", `categoryId=${c}`))
      const v: any = await safe(() => ncall("GET", "/v1/product-attributes/attribute-values", `categoryId=${c}`))
      const list = Array.isArray(a) ? a : a?.contents || a
      const vals = Array.isArray(v) ? v : v?.contents || v
      log.attrs[c] = { attributes: Array.isArray(list) ? list.map((x: any) => ({ seq: x.attributeSeq, name: x.attributeName, type: x.attributeType, classType: x.attributeClassificationType })) : list,
        values: Array.isArray(vals) ? vals.map((x: any) => ({ a: x.attributeSeq, v: x.attributeValueSeq, n: x.minAttributeValue ?? x.attributeValueName, u: x.minAttributeValueUnitCode })) : vals }
      await save()
    }
    log.tags = {}
    for (const k of ["골드키위", "그린키위", "키위", "참다래", "광양키위", "과일선물", "산지직송", "제철과일", "국산키위", "감귤", "유라귤", "제주감귤", "귤"]) {
      const t: any = await safe(() => ncall("GET", "/v2/tags/recommend-tags", `keyword=${encodeURIComponent(k)}`))
      log.tags[k] = Array.isArray(t) ? t.slice(0, 12) : t
    }
    await save()
    const V = getStore({ name: "admin-vendors", consistency: "strong" })
    const { blobs } = await V.list()
    log.vendors = (await Promise.all(blobs.map((b) => V.get(b.key, { type: "json" })))).filter(Boolean).map((v: any) => ({ id: v.id, name: v.name, company: v.company || v.bizName || v.ceo, keys: Object.keys(v) }))
  }
  log.running = false
  await save()
}
