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

  if (body.mode === "apply") {
    const T = { 골드키위: 11627, 그린키위: 14282, 키위: 8950, 참다래: 8951, 과일선물: 172173, 산지직송: 8512, 제철과일: 11810, 감귤: 8717, 귤: 10496, 제주감귤: 11189, 과일선물세트: 217867 } as Record<string, number>
    const tags = (ws: string[]) => ws.map((w) => ({ code: T[w], text: w }))
    const BOX_K = { attributeSeq: 10041638, attributeValueSeq: 10810987 }, BOX_J = { attributeSeq: 10041648, attributeValueSeq: 10810987 }
    const COLD = { attributeSeq: 10014420, attributeValueSeq: 10771835 }
    const KG5 = { attributeSeq: 10014353, attributeValueSeq: 112447, attributeRealValue: "5", attributeRealValueUnitCode: "A02002" }
    const PLAN: Record<string, any> = {
      "13814609094": { maker: "제주담은귤", tags: tags(["제주감귤", "과일선물", "과일선물세트", "산지직송", "제철과일"]), attrs: [{ attributeSeq: 10020581, attributeValueSeq: 10280565 }, BOX_J, COLD] },
      "13814609279": { maker: "제주담은귤", tags: tags(["제주감귤", "과일선물", "과일선물세트", "산지직송", "제철과일"]), attrs: [{ attributeSeq: 10020581, attributeValueSeq: 10280565 }, KG5, BOX_J, COLD] },
      "13814619964": { maker: "광양 키위농가", name: "전남 광양 산지직송 골드키위 5kg 특대 대과 중과 소과", tags: tags(["골드키위", "과일선물", "과일선물세트", "산지직송", "제철과일"]), attrs: [{ attributeSeq: 10020576, attributeValueSeq: 10462599 }, KG5, BOX_K, COLD] },
      "13814620214": { maker: "광양 키위농가", tags: tags(["그린키위", "과일선물", "과일선물세트", "산지직송", "제철과일"]), attrs: [{ attributeSeq: 10020576, attributeValueSeq: 10832320 }, KG5, BOX_K, COLD] },
    }
    log.results = {}
    for (const [no, plan] of Object.entries(PLAN)) {
      try {
        const o: any = await ncall("GET", `/v2/products/origin-products/${no}`)
        const p = o.originProduct, da = p.detailAttribute
        if (plan.name) p.name = plan.name
        da.seoInfo = { ...(da.seoInfo || {}), sellerTags: plan.tags }
        da.naverShoppingSearchInfo = { ...(da.naverShoppingSearchInfo || {}), modelName: String(p.name).slice(0, 50), manufacturerName: plan.maker, catalogMatchingYn: false }
        da.productAttributes = plan.attrs
        const removed: string[] = []
        for (let i = 0; ; i++) {
          try { await ncall("PUT", `/v2/products/origin-products/${no}`, "", { originProduct: p, smartstoreChannelProduct: o.smartstoreChannelProduct }); break }
          catch (e: any) {
            const m = String(e?.message || "").match(/태그명: ([^)]+)\)/)
            if (!m || i >= 3) throw e
            const bad = m[1].split(",").map((x) => x.trim())
            removed.push(...bad)
            da.seoInfo.sellerTags = da.seoInfo.sellerTags.filter((t: any) => !bad.includes(t.text))
          }
        }
        const chk: any = await ncall("GET", `/v2/products/origin-products/${no}`)
        const d2 = chk.originProduct.detailAttribute
        log.results[no] = { ok: true, removed, name: chk.originProduct.name, tags: d2.seoInfo?.sellerTags, search: d2.naverShoppingSearchInfo, attrs: d2.productAttributes }
      } catch (e: any) { log.results[no] = { ok: false, error: String(e?.message || e).slice(0, 1500) } }
      await save()
    }
  }
  log.running = false
  await save()
}
