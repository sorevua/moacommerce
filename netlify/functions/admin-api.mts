import type { Config, Context } from "@netlify/functions"
import { getStore } from "@netlify/blobs"
import { randomUUID } from "node:crypto"
import { isLoggedIn } from "./_lib/auth.mts"
import { coupangConfigured, syncCoupangOrders, recordSyncError, acknowledge, uploadInvoice, COURIERS, changePrice, stopSale, resumeSale, updateProductContent, cleanTags } from "./_lib/coupang.mts"

// ---------- 저장소 ----------
const store = (name: string) => getStore({ name, consistency: "strong" })
const vendors = () => store("admin-vendors")
const orders = () => store("admin-orders")
const photos = () => store("admin-photos")
const settingsStore = () => store("admin-settings")

const json = (data: unknown, status = 200) => Response.json(data, { status })
const now = () => new Date().toISOString()

// ---------- 기본값 ----------
const DEFAULT_SETTINGS = {
  marginRate: 0.15, // 판매가 대비 목표 마진 (가정값)
  extraShipping: 0, // 공급가 외 추가 배송비
  coupangFee: 0.106, // 가정값 — WING에서 과일 카테고리 요율 확인
  naverSalesFee: 0.0273, // 2025-06 개편 기준 검색·앱 유입
  naverPayFee: 0.033, // 가정값 — 일반 등급
  vatOnFee: 0.1,
  roundUnit: 100,
  directMarginRate: 0.2, // 카톡·밴드 직판 마진 (가정값, 마켓보다 조금 높게)
  sameMarketPrice: 1, // 1이면 쿠팡·네이버를 같은 판매가(둘 중 높은 값)로 맞춤
}

// 발주서 열 필드 이름
// recipientName, recipientAddress, recipientPhone, recipientPhone2,
// senderName, senderAddress, senderPhone, itemName, qty, message
const JEJU_DAMEUN_COLUMNS = [
  { header: "받는분 성명", field: "recipientName" },
  { header: "받는분 주소(전체)", field: "recipientAddress" },
  { header: "받는분 전화번호", field: "recipientPhone" },
  { header: "받는분 기타연락처", field: "recipientPhone2" },
  { header: "보내는분 성명", field: "senderName" },
  { header: "보내는분 주소(변경 금지)", field: "senderAddress" },
  { header: "보내는분 전화번호", field: "senderPhone" },
  { header: "품목명", field: "itemName" },
  { header: "박스수량", field: "qty" },
  { header: "배송메세지1", field: "message" },
]

const JEJU_ADDR = "제주특별자치도 서귀포시 남원읍 태신삼석로73번길 76-15"
const JEJU_ZIP = "63617"

function seedVendor() {
  return {
    id: "jeju-dameun",
    name: "제주담은귤",
    status: "거래 중",
    products: [
      { name: "하우스감귤(신품종) 옐로향 유라귤 2kg(2S~2L)", supplyPrice: 19000 },
      { name: "하우스감귤(신품종) 옐로향 유라귤 3kg(2S~2L)", supplyPrice: 26000 },
      { name: "하우스감귤(신품종) 옐로향 유라귤 5kg(2S~2L)", supplyPrice: 42000 },
    ],
    order: {
      method: "엑셀 발주서",
      email: "",
      cutoff: "평일 09:00",
      prepay: true,
      csChannel: "1:1 채팅",
      fixedMessage: "하우스감귤 취급 및 파손주의",
      columns: JEJU_DAMEUN_COLUMNS,
    },
    sender: { name: "", phone: "", zip: "63617", address: "제주특별자치도 서귀포시 남원읍 태신삼석로73번길 76-15" },
    returnInfo: { sameAsSender: true, name: "", phone: "", zip: "", address: "" },
    extraInfo: "",
    photoIds: [] as string[],
    listing: null,
    createdAt: now(),
    updatedAt: now(),
  }
}

async function ensureSeed() {
  const { blobs } = await vendors().list()
  if (blobs.length === 0) {
    const v = seedVendor()
    await vendors().setJSON(v.id, v)
    return
  }
  // 제주담은귤 출고지 주소·우편번호가 비어 있으면 업체가 알려준 정보로 채움 (1회)
  const j: any = await vendors().get("jeju-dameun", { type: "json" })
  if (j && !j.sender?.address) {
    j.sender = { ...(j.sender || {}), zip: "63617", address: "제주특별자치도 서귀포시 남원읍 태신삼석로73번길 76-15" }
    delete j.sender.note
    j.returnInfo = j.returnInfo || { sameAsSender: true, name: "", phone: "", zip: "", address: "" }
    j.updatedAt = now()
    await vendors().setJSON(j.id, j)
  }
}

async function getSettings() {
  const s = await settingsStore().get("settings", { type: "json" })
  return { ...DEFAULT_SETTINGS, ...(s || {}) }
}

// ---------- 가격 계산 ----------
function priceFor(supply: number, s: typeof DEFAULT_SETTINGS) {
  const cost = supply + Number(s.extraShipping || 0)
  const unit = Number(s.roundUnit || 100)
  const roundUp = (x: number) => Math.ceil(x / unit) * unit
  const cFee = s.coupangFee * (1 + s.vatOnFee)
  const nFee = (s.naverSalesFee + s.naverPayFee) * (1 + s.vatOnFee)
  let coupang = roundUp(cost / (1 - cFee - s.marginRate))
  let naver = roundUp(cost / (1 - nFee - s.marginRate))
  if (Number(s.sameMarketPrice)) coupang = naver = Math.max(coupang, naver)
  const direct = roundUp(cost / (1 - Number(s.directMarginRate ?? s.marginRate))) // 카톡·밴드 직판(마켓 수수료 없음)
  return {
    direct,
    directProfit: Math.round(direct - cost),
    coupang,
    coupangProfit: Math.round(coupang - cost - coupang * cFee),
    naver,
    naverProfit: Math.round(naver - cost - naver * nFee),
  }
}

// 상품 등록 초안 (AI 연결 전 템플릿 방식)
function buildListing(v: any, s: typeof DEFAULT_SETTINGS) {
  const extras = String(v.extraInfo || "")
    .split(/\n+/)
    .map((x: string) => x.trim())
    .filter(Boolean)
  const items = (v.products || []).map((p: any) => ({
    name: p.name,
    supplyPrice: p.supplyPrice,
    ...priceFor(Number(p.supplyPrice || 0), s),
  }))
  const lines = [
    `■ ${v.name} 산지 직송`,
    ...items.map((i: any) => `· ${i.name}`),
    "",
    ...(extras.length ? ["■ 이 상품의 특징", ...extras.map((e: string) => `· ${e}`), ""] : []),
    "■ 배송 안내",
    v.order?.cutoff ? `· 주문 마감: ${v.order.cutoff} (산지 출고 일정에 따라 달라질 수 있음)` : "· 주문 마감: 확인 필요",
    "· 신선식품 특성상 단순 변심 반품은 제한될 수 있습니다.",
  ]
  return {
    createdAt: now(),
    status: "등록 대기 (마켓 API 연결 전)",
    items,
    detailDraft: lines.join("\n"),
    checks: [
      "상품명·키워드는 마켓 등록 전에 대표가 최종 확인",
      "네이버 신선식품 카테고리는 생성형 AI 이미지 사용 불가 — 실제 사진만 사용",
      "추가 정보의 수치(예: 당도)는 근거 자료 보관 필요",
    ],
  }
}

// ---------- 쿠팡 상품 보조 ----------
async function logChange(entry: any) {
  const log: any[] = ((await settingsStore().get("coupang-changes", { type: "json" })) as any[]) || []
  log.unshift({ at: now(), ...entry })
  await settingsStore().setJSON("coupang-changes", log.slice(0, 300))
}

function sanitizeHtml(html: string) {
  return html
    .replace(/<\s*(script|iframe|object|embed|style|link|meta)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|iframe|object|embed|link|meta)[^>]*\/?>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "")
    .slice(0, 200000)
}

// ---------- 라우터 ----------
export default async (req: Request, context: Context) => {
  if (!isLoggedIn(req)) return json({ error: "로그인이 필요합니다." }, 401)

  const url = new URL(req.url)
  const parts = url.pathname.replace(/^\/api\/admin\/?/, "").split("/").filter(Boolean)
  const [res, id, sub, subId] = parts
  const method = req.method

  try {
    if (res === "me") return json({ ok: true })

    // 설정
    if (res === "settings") {
      if (method === "GET") return json(await getSettings())
      if (method === "PUT") {
        const body = await req.json()
        const merged = { ...(await getSettings()) }
        for (const k of Object.keys(DEFAULT_SETTINGS)) {
          if (body[k] !== undefined && body[k] !== "") merged[k as keyof typeof DEFAULT_SETTINGS] = Number(body[k])
        }
        await settingsStore().setJSON("settings", merged)
        return json(merged)
      }
    }

    // 업체
    if (res === "vendors") {
      if (!id && method === "GET") {
        await ensureSeed()
        const { blobs } = await vendors().list()
        const list = await Promise.all(blobs.map((b) => vendors().get(b.key, { type: "json" })))
        return json(list.filter(Boolean).sort((a: any, b: any) => a.name.localeCompare(b.name, "ko")))
      }
      if (!id && method === "POST") {
        const body = await req.json()
        const v = { ...seedVendor(), ...body, id: randomUUID(), photoIds: [], listing: null, createdAt: now(), updatedAt: now() }
        if (!body.order) v.order = { ...seedVendor().order, columns: JEJU_DAMEUN_COLUMNS }
        await vendors().setJSON(v.id, v)
        return json(v, 201)
      }
      const current: any = id ? await vendors().get(id, { type: "json" }) : null
      if (id && !current) return json({ error: "업체를 찾을 수 없습니다." }, 404)

      if (id && !sub && method === "GET") return json(current)
      if (id && !sub && method === "PUT") {
        const body = await req.json()
        const v = { ...current, ...body, id, photoIds: current.photoIds, updatedAt: now() }
        await vendors().setJSON(id, v)
        return json(v)
      }
      if (id && !sub && method === "DELETE") {
        for (const p of current.photoIds || []) await photos().delete(`${id}/${p}`)
        await vendors().delete(id)
        return json({ ok: true })
      }

      // 사진
      if (sub === "photos" && method === "POST") {
        const form = await req.formData()
        const file = form.get("file")
        if (!(file instanceof Blob)) return json({ error: "사진 파일이 없습니다." }, 400)
        if (file.size > 4 * 1024 * 1024) return json({ error: "사진은 4MB 이하만 올릴 수 있습니다." }, 413)
        const pid = randomUUID()
        await photos().set(`${id}/${pid}`, await file.arrayBuffer(), {
          metadata: { type: file.type || "image/jpeg", name: (file as File).name || "" },
        })
        current.photoIds = [...(current.photoIds || []), pid]
        current.updatedAt = now()
        await vendors().setJSON(id, current)
        return json({ id: pid }, 201)
      }
      if (sub === "photos" && subId && method === "GET") {
        const entry = await photos().getWithMetadata(`${id}/${subId}`, { type: "arrayBuffer" })
        if (entry === null) return new Response("Not found", { status: 404 })
        return new Response(entry.data as ArrayBuffer, {
          headers: { "content-type": String(entry.metadata?.type || "image/jpeg"), "cache-control": "private, max-age=3600" },
        })
      }
      if (sub === "photos" && subId && method === "DELETE") {
        await photos().delete(`${id}/${subId}`)
        current.photoIds = (current.photoIds || []).filter((p: string) => p !== subId)
        await vendors().setJSON(id, current)
        return json({ ok: true })
      }

      // 실행: 판매가 계산 + 등록 초안 생성
      if (sub === "run" && method === "POST") {
        if (!current.products?.length) return json({ error: "상품과 공급가를 먼저 입력해 주세요." }, 400)
        if (!current.photoIds?.length) return json({ error: "실제 상품 사진을 1장 이상 첨부해 주세요." }, 400)
        current.listing = buildListing(current, await getSettings())
        current.updatedAt = now()
        await vendors().setJSON(id, current)
        return json(current)
      }
    }

    // 쿠팡 연동
    if (res === "coupang") {
      if (id === "status" && method === "GET") {
        const last = await settingsStore().get("coupang-sync", { type: "json" })
        return json({ configured: coupangConfigured(), last, couriers: COURIERS })
      }
      if (!coupangConfigured()) return json({ error: "쿠팡 API 키가 아직 설정되지 않았습니다." }, 400)
      if (id === "sync" && method === "POST") {
        try {
          return json(await syncCoupangOrders())
        } catch (err) {
          await recordSyncError(err)
          throw err
        }
      }
      if (id === "ack" && method === "POST") {
        const { orderIds } = await req.json()
        const list: any[] = (await Promise.all((orderIds || []).map((oid: string) => orders().get(oid, { type: "json" })))).filter(
          (o: any) => o?.market?.name === "coupang" && !o.market.acknowledged,
        )
        const boxes = [...new Set(list.map((o) => o.market.shipmentBoxId))]
        if (!boxes.length) return json({ ok: true, acknowledged: 0 })
        const results: any[] = []
        for (let i = 0; i < boxes.length; i += 50) {
          const r = await acknowledge(boxes.slice(i, i + 50))
          results.push(...(r?.data?.responseList || []))
        }
        const okBoxes = new Set(results.filter((r) => r.succeed).map((r) => String(r.shipmentBoxId)))
        for (const o of list) {
          if (okBoxes.has(o.market.shipmentBoxId)) {
            o.market.acknowledged = true
            o.updatedAt = now()
            await orders().setJSON(o.id, o)
          }
        }
        const failed = results.filter((r) => !r.succeed).map((r) => `${r.shipmentBoxId}: ${r.resultMessage || r.resultCode}`)
        return json({ ok: failed.length === 0, acknowledged: okBoxes.size, failed })
      }

      // ----- 상세페이지용 공개 사진 -----
      if (id === "images" && method === "POST") {
        const form = await req.formData()
        const file = form.get("file")
        if (!(file instanceof Blob)) return json({ error: "사진 파일이 없습니다." }, 400)
        if (file.size > 4 * 1024 * 1024) return json({ error: "사진은 4MB 이하만 올릴 수 있습니다." }, 413)
        const key = `${randomUUID()}.jpg`
        await getStore({ name: "public-images", consistency: "strong" }).set(key, await file.arrayBuffer())
        return json({ url: `${url.origin}/img/${key}` }, 201)
      }
      if (id === "copy" && method === "GET") {
        return json((await settingsStore().get("cp-copy", { type: "json" })) || {})
      }
      if (id === "copy" && method === "PUT") {
        const b = await req.json()
        const prevCopy: any = (await settingsStore().get("cp-copy", { type: "json" })) || {}
        const guides = { ...(prevCopy.guides || {}) }
        if (b.guide?.id) guides[String(b.guide.id)] = String(b.guide.text || "").slice(0, 3000)
        const v = { brand: String(b.brand ?? prevCopy.brand ?? "").slice(0, 1000), shipping: String(b.shipping ?? prevCopy.shipping ?? "").slice(0, 2000), facts: String(b.facts ?? prevCopy.facts ?? "").slice(0, 1000), guides }
        await settingsStore().setJSON("cp-copy", v)
        return json(v)
      }
      if (id === "extras" && sub && method === "GET") {
        return json((await settingsStore().get(`cp-extra-${sub}`, { type: "json" })) || [])
      }
      if (id === "extras" && sub && method === "PUT") {
        const list = (await req.json()) as any[]
        const clean = (Array.isArray(list) ? list : []).slice(0, 6).map((e) => ({ url: String(e.url || ""), caption: String(e.caption || "").slice(0, 200) }))
        await settingsStore().setJSON(`cp-extra-${sub}`, clean)
        return json(clean)
      }
      // ----- 상품 관리 -----
      if (id === "products" && method === "GET" && !sub) {
        return json((await settingsStore().get("coupang-products", { type: "json" })) || { products: [] })
      }
      if (id === "ai" && method === "GET" && sub) {
        return json((await settingsStore().get(`ai-${sub}`, { type: "json" })) || {})
      }
      if (id === "items" && sub && method === "PUT") {
        const vid = String(sub).replace(/\D/g, "")
        const body = await req.json()
        const cache: any = (await settingsStore().get("coupang-products", { type: "json" })) || { products: [] }
        const touch = (patch: any) => {
          for (const p of cache.products || []) for (const it of p.items || []) if (it.vendorItemId === vid) Object.assign(it, patch)
        }
        if (body.action === "price") {
          const price = Math.round(Number(body.price) / 10) * 10
          if (!(price >= 100)) return json({ error: "가격을 확인하세요." }, 400)
          await changePrice(vid, price)
          touch({ salePrice: price })
        } else if (body.action === "stop") {
          await stopSale(vid)
          touch({ onSale: false })
        } else if (body.action === "resume") {
          await resumeSale(vid)
          touch({ onSale: true })
        } else return json({ error: "알 수 없는 작업" }, 400)
        await settingsStore().setJSON("coupang-products", cache)
        await logChange({ vendorItemId: vid, ...body })
        return json({ ok: true })
      }
      if (id === "products" && sub && method === "PUT") {
        const body = await req.json()
        const change: any = {}
        if (body.displayProductName) change.displayProductName = String(body.displayProductName)
        if (Array.isArray(body.searchTags)) change.searchTags = cleanTags(body.searchTags)
        if (body.detailHtml) change.detailHtml = sanitizeHtml(String(body.detailHtml))
        if (!Object.keys(change).length) return json({ error: "바꿀 내용이 없습니다." }, 400)
        const r = await updateProductContent(String(sub), change)
        await logChange({ sellerProductId: sub, action: "content", fields: Object.keys(change) })
        return json({ ok: true, result: r?.code || "SUCCESS", note: "쿠팡 승인 후 반영됩니다. 배송·반품 정보는 그대로입니다." })
      }
    }

    // 송장 등록 (쿠팡 주문이면 쿠팡에도 업로드)
    if (res === "invoice" && method === "POST") {
      const { orderId, courier, invoiceNumber } = await req.json()
      const o: any = await orders().get(orderId, { type: "json" })
      if (!o) return json({ error: "주문을 찾을 수 없습니다." }, 404)
      const num = String(invoiceNumber || "").replace(/\D/g, "")
      if (!courier || !num) return json({ error: "택배사와 송장번호를 입력하세요." }, 400)
      if (o.market?.name === "coupang") {
        if (!coupangConfigured()) return json({ error: "쿠팡 API 키가 아직 설정되지 않았습니다." }, 400)
        if (!o.market.acknowledged) {
          const a = await acknowledge([o.market.shipmentBoxId])
          const r = a?.data?.responseList?.[0]
          if (r && !r.succeed && !/INSTRUCT|상품준비중/.test(String(r.resultMessage || ""))) {
            return json({ error: "쿠팡 상품준비중 처리 실패: " + (r.resultMessage || r.resultCode) }, 400)
          }
          o.market.acknowledged = true
        }
        const up = await uploadInvoice([{ shipmentBoxId: o.market.shipmentBoxId, orderId: o.market.orderId, vendorItemId: o.market.vendorItemId, courier, invoiceNumber: num }])
        const r = up?.data?.responseList?.[0]
        if (!r?.succeed) return json({ error: "쿠팡 송장 등록 실패: " + (r?.resultMessage || r?.resultCode || up?.data?.responseMessage || "알 수 없음") }, 400)
      }
      o.invoice = { courier, courierName: COURIERS[courier] || courier, number: num, at: now() }
      o.status = "발송"
      o.updatedAt = now()
      await orders().setJSON(o.id, o)
      return json(o)
    }

    // 주문
    if (res === "orders") {
      if (!id && method === "GET") {
        const { blobs } = await orders().list()
        const list = await Promise.all(blobs.map((b) => orders().get(b.key, { type: "json" })))
        return json(list.filter(Boolean).sort((a: any, b: any) => (a.createdAt < b.createdAt ? 1 : -1)))
      }
      if (!id && method === "POST") {
        const body = await req.json()
        for (const f of ["vendorId", "productName", "recipientName", "recipientAddress", "recipientPhone"]) {
          if (!String(body[f] || "").trim()) return json({ error: `필수 항목이 비었습니다: ${f}` }, 400)
        }
        const o = {
          id: randomUUID(),
          channel: body.channel || "기타",
          vendorId: body.vendorId,
          productName: body.productName,
          qty: Math.max(1, Number(body.qty || 1)),
          salePrice: Number(body.salePrice || 0),
          recipientName: body.recipientName.trim(),
          recipientAddress: body.recipientAddress.trim(),
          recipientPhone: body.recipientPhone.trim(),
          recipientPhone2: (body.recipientPhone2 || "").trim(),
          message: (body.message || "").trim(),
          rawText: (body.rawText || "").slice(0, 2000),
          status: "접수",
          createdAt: now(),
          updatedAt: now(),
        }
        await orders().setJSON(o.id, o)
        return json(o, 201)
      }
      const current: any = id ? await orders().get(id, { type: "json" }) : null
      if (id && !current) return json({ error: "주문을 찾을 수 없습니다." }, 404)
      if (id && method === "PUT") {
        const body = await req.json()
        const o = { ...current, ...body, id, updatedAt: now() }
        await orders().setJSON(id, o)
        return json(o)
      }
      if (id && method === "DELETE") {
        await orders().delete(id)
        return json({ ok: true })
      }
    }

    return json({ error: "지원하지 않는 요청입니다." }, 404)
  } catch (err: any) {
    console.error(err)
    return json({ error: "서버 오류: " + (err?.message || String(err)) }, 500)
  }
}

export const config: Config = {
  path: "/api/admin/*",
}
