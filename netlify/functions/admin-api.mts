import type { Config, Context } from "@netlify/functions"
import { getStore } from "@netlify/blobs"
import { randomUUID } from "node:crypto"
import { isLoggedIn } from "./_lib/auth.mts"

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
    sender: { name: "", address: "", phone: "", note: "쿠팡 WING 등록 출고지 정보 그대로 입력" },
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
  const coupang = roundUp(cost / (1 - cFee - s.marginRate))
  const naver = roundUp(cost / (1 - nFee - s.marginRate))
  const direct = roundUp(cost / (1 - s.marginRate)) // 카톡·밴드 직접 판매(마켓 수수료 없음)
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
