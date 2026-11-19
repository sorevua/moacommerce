// 행운프레시(B2B) 상품을 네이버 스마트스토어에 등록한다.
//  - 사진·상세페이지는 이미 쿠팡에 올린 같은 상품의 것을 그대로 쓴다
//  - 네이버 옵션가 규칙(기본가의 +100% 이내) 때문에 가격대가 많이 벌어지면 상품을 나눠 올린다
//  - 이미 네이버에 같은 이름으로 올린 상품은 다시 올리지 않는다
import { getStore } from "@netlify/blobs"
import { isLoggedIn, isInternal } from "./_lib/auth.mts"
import { luckyProducts } from "./_lib/luckyfresh.mts"
import { getProduct, normImg } from "./_lib/coupang.mts"
import { ncall, naverUploadImage } from "./_lib/naver.mts"

const settings = () => getStore({ name: "admin-settings", consistency: "strong" })
function priceOf(supply: number, s: any) {
  const d = { marginRate: 0.15, extraShipping: 0, coupangFee: 0.106, naverSalesFee: 0.0273, naverPayFee: 0.033, vatOnFee: 0.1, roundUnit: 100, sameMarketPrice: 1, ...(s || {}) }
  const cost = supply + Number(d.extraShipping || 0), unit = Number(d.roundUnit || 100), up = (x: number) => Math.ceil(x / unit) * unit
  const cp = up(cost / (1 - d.coupangFee * (1 + d.vatOnFee) - d.marginRate)), np = up(cost / (1 - (d.naverSalesFee + d.naverPayFee) * (1 + d.vatOnFee) - d.marginRate))
  return Number(d.sameMarketPrice) ? Math.max(cp, np) : cp
}
// 네이버 수수료만으로 계산한 가격 (마진율을 직접 지정할 때)
function naverPrice(supply: number, margin: number, s: any) {
  const d = { extraShipping: 0, naverSalesFee: 0.0273, naverPayFee: 0.033, vatOnFee: 0.1, roundUnit: 100, ...(s || {}) }
  const cost = supply + Number(d.extraShipping || 0), unit = Number(d.roundUnit || 100)
  return Math.ceil(cost / (1 - (d.naverSalesFee + d.naverPayFee) * (1 + d.vatOnFee) - margin) / unit) * unit
}
const clean = (x: string) => String(x || "").replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}✅]/gu, "").replace(/맛없으면\s*환불/g, "").replace(/\s{2,}/g, " ").trim()
const kgOf = (n: string) => { const m = n.match(/(\d+(?:\.\d+)?)\s*kg/i); if (m) return m[1] + "kg"; const g = n.match(/(\d+)\s*g\s*\d*\s*팩|(\d+)\s*팩/); return g ? (n.match(/\d+\s*팩/) || [""])[0] : "" }

const AS = `A/S 및 교환·반품 안내

본 상품은 신선 농산물로 별도의 A/S가 제공되지 않습니다.

상품 하자·오배송
- 수령 후 24시간 이내에 운송장 사진, 상품 전체 사진, 문제 부위 사진과 함께 판매자 문의로 연락해 주세요.
- 하자나 오배송이 확인되면 관련 법령에 따라 교환 또는 환불해 드립니다.

단순 변심
- 신선 농산물은 시간이 지나면 상품 가치가 크게 떨어지므로 단순 변심·주문 실수로 인한 반품·교환은 어렵습니다(전자상거래법 제17조 제2항).

고객센터: 네이버 스마트스토어 판매자 문의`

export default async (req: Request) => {
  if (!isLoggedIn(req) && !isInternal(req)) return
  const job = await req.json().catch(() => ({}))
  const st: any = (await settings().get("lucky-naver", { type: "json" })) || { done: {} }
  const save = () => settings().setJSON("lucky-naver", { ...st, at: new Date().toISOString() })
  st.running = true; st.log = []; await save()
  try {
    const reg: any = (await settings().get("lucky-reg", { type: "json" })) || { done: {} }
    const cfg: any = await settings().get("settings", { type: "json" })
    const plist: any[] = (await luckyProducts(true)).data?.products || []
    const existing: any = await ncall("POST", "/v1/products/search", "", { page: 1, size: 100 })
    const names = new Set<string>((existing.contents || []).flatMap((c: any) => (c.channelProducts || []).map((p: any) => String(p.name))))
    for (const it of job.items || []) {
      const id = String(it.id)
      try {
        const p = plist.find((x: any) => x.id === id); if (!p) throw new Error("행운 상품 목록에 없음")
        const d = reg.done?.[id]; if (!d?.ok) throw new Error("쿠팡 등록 정보 없음")
        const base = clean(p.name)
        const opts = (p.options || []).filter((o: any) => o.status === "판매중").map((o: any) => ({ name: clean(`${o.name}${o.prefixName ? " " + o.prefixName : ""}`).slice(0, 25), price: job.margin ? naverPrice(Number(o.price) + Number(o.shippingFee || 0), Number(job.margin), cfg) : priceOf(Number(o.price) + Number(o.shippingFee || 0), cfg) }))
        if (!opts.length) throw new Error("판매중 옵션 없음")
        // 가격순으로 묶기: 묶음 안에서 가장 비싼 옵션이 가장 싼 옵션의 2배를 넘지 않게
        opts.sort((a: any, b: any) => a.price - b.price)
        const groups: any[][] = []
        for (const o of opts) { const g = groups[groups.length - 1]; if (g && o.price <= g[0].price * 2) g.push(o); else groups.push([o]) }
        // 대표사진·상세: 쿠팡 상품에서 가져온다
        const cp: any = await getProduct(String((d.sellerProductIds || [d.sellerProductId])[0]))
        const item = (cp.items || [])[0] || {}
        const rep = (item.images || []).find((x: any) => x.imageType === "REPRESENTATION")
        const repUrl = await naverUploadImage(normImg(rep?.cdnPath || rep?.vendorPath || ""), `lk-${id}.jpg`)
        let html = ""
        for (const c of item.contents || []) for (const cd of c.contentDetails || []) {
          if (cd.detailType === "IMAGE") html += `<img src="${normImg(cd.content)}" style="width:100%;max-width:860px;display:block;margin:0 auto" />`
          else html += String(cd.content || "")
        }
        html = `<div style="text-align:center">${html}</div>`
        st.done[id] = st.done[id] || { name: base, parts: {} }
        const used = new Set<string>()
        for (const g of groups) {
          const kgs = [...new Set(g.map((o: any) => kgOf(o.name)).filter(Boolean))]
          let name = (groups.length > 1 && kgs.length ? `${base} ${kgs.join(" ")}` : base).slice(0, 100)
          // 같은 상품을 나눴는데 이름이 겹치면 첫 옵션 이름을 붙여 구분한다
          if (used.has(name)) name = `${base} ${g[0].name}`.slice(0, 100)
          used.add(name)
          if (st.done[id].parts[name] || names.has(name)) { st.log.push(`건너뜀(이미 있음): ${name}`); continue }
          const sale = g[0].price
          const body = {
            originProduct: {
              statusType: "SALE", saleType: "NEW", leafCategoryId: String(it.cat), name, detailContent: html,
              images: { representativeImage: { url: repUrl } },
              salePrice: sale, stockQuantity: 999,
              deliveryInfo: {
                deliveryType: "DELIVERY", deliveryAttributeType: "NORMAL", deliveryCompany: "CJGLS", deliveryBundleGroupUsable: false,
                deliveryFee: { deliveryFeeType: "FREE", baseFee: 0, deliveryFeeByArea: { deliveryAreaType: "AREA_2", area2extraFee: 5000 } },
                claimDeliveryInfo: { returnDeliveryCompanyPriorityType: "PRIMARY", returnDeliveryFee: 5000, exchangeDeliveryFee: 10000, shippingAddressId: Number(job.shipAddr), returnAddressId: Number(job.retAddr), freeReturnInsuranceYn: false },
                installationFee: false, expectedDeliveryPeriodType: "TWO", customProductAfterOrderYn: true,
              },
              detailAttribute: {
                naverShoppingSearchInfo: { manufacturerName: "상세페이지 참조", brandName: "자체제작", catalogMatchingYn: false },
                afterServiceInfo: { afterServiceTelephoneNumber: String(job.phone), afterServiceGuideContent: AS },
                originAreaInfo: it.origin,
                optionInfo: {
                  optionCombinationSortType: "CREATE", optionCombinationGroupNames: { optionGroupName1: "옵션 선택" },
                  optionCombinations: g.map((o: any) => ({ optionName1: o.name, stockQuantity: 999, price: o.price - sale, usable: true })),
                  useStockManagement: false,
                },
                purchaseReviewInfo: { purchaseReviewExposure: true },
                taxType: "DUTYFREE",
                certificationTargetExcludeContent: { greenCertifiedProductExclusionYn: true },
                sellerCommentUsable: false, minorPurchasable: true,
                productInfoProvidedNotice: {
                  productInfoProvidedNoticeType: "FOOD",
                  food: {
                    returnCostReason: "1", noRefundReason: "1", qualityAssuranceStandard: "1", compensationProcedure: "1", troubleShootingContents: "1",
                    foodItem: base, weight: "옵션별 상이", amount: "1박스(팩)", size: "옵션별 상이",
                    packDateText: "주문 후 산지에서 포장·발송", consumptionDateText: "수령 후 빠른 섭취 권장",
                    producer: "상세페이지 참조", relevantLawContent: "해당사항 없음", productComposition: `${base} (옵션별 중량·크기 상이)`,
                    keep: "수령 즉시 개봉해 상태를 확인하고, 직사광선을 피해 서늘한 곳 또는 냉장 보관해 주세요.",
                    adCaution: "신선 농산물 특성상 크기·모양·색상·당도에 차이가 있을 수 있습니다. 파손·변질 시 수령 후 24시간 이내 사진과 함께 문의해 주세요.",
                    customerServicePhoneNumber: String(job.phone),
                  },
                },
                itselfProductionProductYn: false,
                seoInfo: { pageTitle: name, metaDescription: name },
              },
            },
            smartstoreChannelProduct: { channelProductName: name, storeKeepExclusiveProduct: false, naverShoppingRegistration: true, channelProductDisplayStatusType: "ON" },
          }
          if (job.dry) { st.log.push({ dry: name, options: g.length, sale }); continue }
          const r: any = await ncall("POST", "/v2/products", "", body)
          st.done[id].parts[name] = { originProductNo: r.originProductNo, channelProductNo: r.smartstoreChannelProductNo, options: g.map((o: any) => o.name), at: new Date().toISOString() }
          st.log.push(`등록: ${name} (${g.length}개 옵션)`)
          await save()
        }
        delete st.done[id].err
      } catch (e: any) {
        st.done[id] = { ...(st.done[id] || {}), err: String(e?.message || e).slice(0, 400) }
        st.log.push(`실패 ${id}: ${String(e?.message || e).slice(0, 300)}`)
      }
      await save()
    }
  } finally { st.running = false; await save() }
}
