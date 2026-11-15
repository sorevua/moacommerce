// 임시: 쿠팡 상품(키위·귤)을 네이버에 등록 — 작업 후 삭제
import { getStore } from "@netlify/blobs"
import { ncall, naverUploadImage } from "./_lib/naver.mts"
import { getProduct, normImg } from "./_lib/coupang.mts"

const st = () => getStore({ name: "admin-settings", consistency: "strong" })
const TEMPLATE = "13763431198"

type Job = { key: string; coupangId: string; category: string; shipAddr?: number; retAddr?: number; courier?: string; origin: string; producer: string; foodItem: string; mdn: string; addrNew?: { name: string; zip: string; base: string; detail: string; phone: string } }
const JOBS: Job[] = [
  { key: "yura", coupangId: "16417633126", category: "50002163", shipAddr: 200677656, retAddr: 200677656, origin: "제주특별자치도 서귀포시", producer: "제주담은귤", foodItem: "하우스감귤(옐로향 유라귤)", mdn: "MOA-YURA" },
  { key: "gold", coupangId: "16456111134", category: "50002176", courier: "HANJIN", origin: "전라남도 광양시", producer: "광양 키위농가", foodItem: "골드키위", mdn: "MOA-KIWI-GOLD", addrNew: { name: "광양 키위농가", zip: "57707", base: "전라남도 광양시 진상면 신시3길", detail: "13-23", phone: "010-8587-0003" } },
  { key: "green", coupangId: "16456110852", category: "50002176", courier: "HANJIN", origin: "전라남도 광양시", producer: "광양 키위농가", foodItem: "그린키위(참다래)", mdn: "MOA-KIWI-GREEN", addrNew: { name: "광양 키위농가", zip: "57707", base: "전라남도 광양시 진상면 신시3길", detail: "13-23", phone: "010-8587-0003" } },
]

function pickBase(prices: number[]) {
  const s = [...prices].sort((a, b) => a - b), min = s[0], max = s[s.length - 1]
  const ok = (b: number) => max <= b * 1.5 && min >= b * 0.5
  return s.find(ok) ?? s[Math.floor(s.length / 2)]
}

// 네이버 옵션가는 기준가의 ±50% 안이어야 한다 → 안 되면 상품을 나눈다 (기준가는 실제 옵션 가격 중 하나)
function groupByPrice(items: any[]) {
  const sorted = [...items].sort((a, b) => Number(a.salePrice) - Number(b.salePrice))
  const groups: any[][] = []
  let cur: any[] = []
  const valid = (g: any[]) => g.some((b) => g.every((x) => Number(x.salePrice) <= Number(b.salePrice) * 1.5 && Number(x.salePrice) >= Number(b.salePrice) * 0.5))
  for (const it of sorted) { if (valid([...cur, it])) cur.push(it); else { groups.push(cur); cur = [it] } }
  if (cur.length) groups.push(cur)
  return groups
}

async function originCode(region: string) {
  try {
    const r: any = await ncall("GET", "/v1/product-origin-areas")
    const list: any[] = r?.originAreaCodeNames || r?.contents || r || []
    const parts = region.split(/\s+/)
    const hit = list.find((x: any) => parts.every((p) => String(x.name || x.codeName || "").includes(p.replace(/특별자치도|광역시|도$/, "")))) || list.find((x: any) => String(x.name || "").includes(parts[parts.length - 1]))
    if (hit) return String(hit.code || hit.originAreaCode)
  } catch {}
  return "00"
}

export default async (req: Request) => {
  const body: any = await req.json().catch(() => ({}))
  const tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || body.token !== tok) return
  const only: string[] = body.only || JOBS.map((j) => j.key)
  const log: any = { at: new Date().toISOString(), running: true, items: {} }
  const save = () => st().setJSON("nvreg", log)
  await save()
  const tpl: any = await ncall("GET", `/v2/products/origin-products/${TEMPLATE}`)
  for (const j of JOBS.filter((x) => only.includes(x.key))) {
    const L: string[] = []; log.items[j.key] = { log: L }
    try {
      const p: any = await getProduct(j.coupangId)
      const items: any[] = (p.items || []).filter((i: any) => i.itemName)
      L.push(`쿠팡 상품: ${p.displayProductName} · 옵션 ${items.length}개`); await save()
      // 사진
      const mainSrc = normImg(items[0]?.images?.find((x: any) => x.imageType === "REPRESENTATION")?.cdnPath || items[0]?.images?.[0]?.cdnPath || items[0]?.images?.[0]?.vendorPath)
      const extraSrc: string[] = []
      for (const im of items[0]?.images || []) { const u = normImg(im.cdnPath || im.vendorPath); if (u && u !== mainSrc && !extraSrc.includes(u)) extraSrc.push(u) }
      const detailSrc: string[] = []
      for (const c of items[0]?.contents || []) for (const d of c.contentDetails || []) {
        const content = String(d.content || "")
        if (d.detailType === "IMAGE") { const u = normImg(content); if (u && !detailSrc.includes(u)) detailSrc.push(u) }
        else for (const m of content.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) { const u = normImg(m[1]); if (u && !detailSrc.includes(u)) detailSrc.push(u) }
      }
      const up = async (u: string, i: number) => naverUploadImage(u, `${j.key}-${i}.${/\.png/i.test(u) ? "png" : "jpg"}`)
      const main = await up(mainSrc, 0)
      const optional: string[] = []
      for (const [i, u] of extraSrc.slice(0, 9).entries()) { try { optional.push(await up(u, 100 + i)) } catch (e: any) { L.push("추가사진 실패: " + e.message) } }
      const detail: string[] = []
      for (const [i, u] of detailSrc.slice(0, 25).entries()) { try { detail.push(await up(u, 200 + i)) } catch (e: any) { L.push("상세사진 실패: " + e.message) } }
      L.push(`사진 업로드: 대표 1 · 추가 ${optional.length} · 상세 ${detail.length}`); await save()
      // 주소
      let shipAddr = j.shipAddr, retAddr = j.retAddr
      if (!shipAddr && j.addrNew) {
        const ab: any = await ncall("GET", "/v1/seller/addressbooks-for-page", "page=1&size=100")
        const hit = (ab?.addressBooks || []).find((a: any) => a.name === j.addrNew!.name)
        if (hit) shipAddr = retAddr = Number(hit.addressBookNo)
        else { shipAddr = retAddr = 200671652; (j as any).suspend = true; L.push("광양 주소가 주소록에 없어 임시 주소로 판매중지 상태로 등록") }
      }
      // 옵션·가격
      const groups = groupByPrice(items)
      if (groups.length > 1) L.push(`옵션 가격 차이가 커서 ${groups.length}개 상품으로 나눠 등록`)
      log.items[j.key].products = []
      for (const g of groups) {
      const gi = g
      const prices = gi.map((i: any) => Number(i.salePrice))
      const base = pickBase(prices)
      const o = JSON.parse(JSON.stringify(tpl.originProduct))
      o.statusType = (j as any).suspend ? "SUSPENSION" : "SALE"
      o.leafCategoryId = j.category
      const baseName = String(p.displayProductName || p.sellerProductName)
      const kgs = [...new Set(gi.map((i: any) => (String(i.itemName).match(/\d+(?:\.\d+)?\s*kg/i) || [""])[0].replace(/\s/g, "")).filter(Boolean))]
      o.name = (groups.length > 1 && kgs.length ? baseName.replace(/\s*\d+(?:\.\d+)?\s*kg/gi, "").trim() + " " + kgs.join(" ") : baseName).slice(0, 100)
      o.images = { representativeImage: { url: main }, optionalImages: optional.map((url) => ({ url })) }
      o.detailContent = `<div style="text-align:center">${(detail.length ? detail : [main]).map((u) => `<img src="${u}" style="width:100%;max-width:860px;display:block;margin:0 auto">`).join("")}</div>`
      o.salePrice = base
      o.stockQuantity = gi.length * 100
      if (j.courier) o.deliveryInfo.deliveryCompany = j.courier
      else if (p.deliveryCompanyCode) o.deliveryInfo.deliveryCompany = p.deliveryCompanyCode === "HYUNDAI" ? "LOTTE" : p.deliveryCompanyCode
      o.deliveryInfo.claimDeliveryInfo.shippingAddressId = shipAddr
      o.deliveryInfo.claimDeliveryInfo.returnAddressId = retAddr
      o.deliveryInfo.claimDeliveryInfo.returnDeliveryFee = 5000
      o.deliveryInfo.claimDeliveryInfo.exchangeDeliveryFee = 10000
      const da = o.detailAttribute
      da.naverShoppingSearchInfo = { modelName: o.name.slice(0, 50), catalogMatchingYn: false }
      da.manufactureDefineNo = j.mdn
      da.originAreaInfo = { originAreaCode: await originCode(j.origin), content: `국산(${j.origin})`, plural: false }
      da.productAttributes = []
      da.seoInfo = { sellerTags: (items[0]?.searchTags || []).slice(0, 10).map((t: string) => ({ text: String(t).slice(0, 20) })) }
      da.optionInfo = {
        optionCombinationSortType: "CREATE",
        optionCombinationGroupNames: { optionGroupName1: "옵션 선택" },
        optionCombinations: gi.map((i: any) => ({ stockQuantity: 100, price: Number(i.salePrice) - base, usable: true, optionName1: String(i.itemName).slice(0, 25) })),
        useStockManagement: true,
      }
      const f = da.productInfoProvidedNotice.food
      const kg = (String(items[0]?.itemName).match(/\d+\s*kg/i) || ["옵션별 상이"])[0]
      Object.assign(f, {
        foodItem: j.foodItem, weight: "옵션별 상이 (박스 포함 중량)", amount: "1박스", size: "옵션별 상이",
        packDateText: "주문 후 산지에서 포장·발송", consumptionDateText: "수령 후 빠른 섭취 권장 (냉장 보관)",
        producer: j.producer, relevantLawContent: "해당사항 없음",
        productComposition: `${j.foodItem} 1박스 (선택 옵션별 중량·크기 상이)`,
        keep: "수령 즉시 개봉해 상태를 확인하고, 직사광선을 피해 서늘한 곳 또는 냉장 보관해 주세요.",
        adCaution: "신선 농산물 특성상 크기·모양·색상·당도에 차이가 있을 수 있습니다. 파손·변질 시 수령 후 24시간 이내 사진과 함께 문의해 주세요.",
      })
      void kg
      L.push(`네이버 등록 요청: ${o.name} (기준가 ${base.toLocaleString()}원)`); await save()
      let r: any
      for (let tries = 0; ; tries++) {
        try { r = await ncall("POST", "/v2/products", "", { originProduct: o, smartstoreChannelProduct: { ...tpl.smartstoreChannelProduct, naverShoppingRegistration: true, channelProductDisplayStatusType: "ON" } }); break }
        catch (e: any) {
          const m = String(e?.message || "")
          const bad = m.match(/등록불가인 단어\(([^)]+)\)/)
          if (bad && tries < 5) { const w = bad[1]; da.seoInfo.sellerTags = da.seoInfo.sellerTags.filter((t: any) => !String(t.text).includes(w)); L.push(`금지 태그 제거: ${w}`); continue }
          throw e
        }
      }
      log.items[j.key].products.push({ name: o.name, originProductNo: r?.originProductNo, channelProductNo: r?.smartstoreChannelProductNo })
      L.push(`등록 완료 — 원상품번호 ${r?.originProductNo}`); await save()
      }
      log.items[j.key].ok = true
    } catch (e: any) {
      log.items[j.key].ok = false
      L.push("실패: " + String(e?.message || e).slice(0, 1500))
    }
    await save()
  }
  log.running = false
  await save()
}
