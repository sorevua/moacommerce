// 오래 걸리는 작업(쿠팡 상품 전체 새로고침, AI 상세페이지 초안)을 백그라운드로 처리한다.
// 결과는 Blobs(admin-settings)에 저장하고, 관리자 화면이 주기적으로 읽어 간다.
import { getStore } from "@netlify/blobs"
import Anthropic from "@anthropic-ai/sdk"
import { isLoggedIn } from "./_lib/auth.mts"
import { listProducts, getProduct, getInventory, extractContent } from "./_lib/coupang.mts"

const store = () => getStore({ name: "admin-settings", consistency: "strong" })
const now = () => new Date().toISOString()

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++
        out[k] = await fn(items[k])
      }
    }),
  )
  return out
}

async function refreshProducts() {
  const prev: any = (await store().get("coupang-products", { type: "json" })) || {}
  await store().setJSON("coupang-products", { ...prev, running: true, startedAt: now(), error: "" })
  try {
    const list = (await listProducts()).filter((p: any) => p.statusName !== "상품삭제" && p.statusName !== "DELETED")
    const rows = await pool(list, 3, async (sp: any) => {
      const id = String(sp.sellerProductId)
      try {
        const p = await getProduct(id)
        const items = await pool(p.items || [], 3, async (it: any) => {
          const vid = it.vendorItemId ? String(it.vendorItemId) : ""
          const inv = vid ? await getInventory(vid).catch(() => null) : null
          return {
            vendorItemId: vid,
            itemName: it.itemName,
            salePrice: inv?.salePrice ?? it.salePrice,
            originalPrice: it.originalPrice,
            onSale: inv ? !!inv.onSale : null,
            stock: inv?.amountInStock ?? it.maximumBuyCount ?? null,
          }
        })
        const tags = [...new Set((p.items || []).flatMap((it: any) => it.searchTags || []))]
        const c = extractContent(p)
        return {
          sellerProductId: id,
          sellerProductName: p.sellerProductName,
          displayProductName: p.displayProductName || "",
          status: sp.statusName,
          createdAt: sp.createdAt,
          searchTags: tags,
          images: c.images,
          detailText: c.text.slice(0, 800),
          delivery: {
            method: p.deliveryMethod,
            chargeType: p.deliveryChargeType,
            charge: p.deliveryCharge,
            returnCharge: p.returnCharge,
          },
          items,
        }
      } catch (e: any) {
        return { sellerProductId: id, sellerProductName: sp.sellerProductName, status: sp.statusName, error: String(e?.message || e), items: [] }
      }
    })
    await store().setJSON("coupang-products", { running: false, at: now(), products: rows, error: "" })
  } catch (e: any) {
    await store().setJSON("coupang-products", { ...prev, running: false, error: String(e?.message || e) })
  }
}

const SYSTEM = `당신은 한국 온라인 신선식품(과일) 상세페이지 카피라이터입니다.
규칙:
- 입력에 없는 수치(당도 brix, 산지 인증, 수상, 판매량, 후기, 순위)는 절대 만들지 않는다. 입력에 있는 수치만 쓴다.
- "최고", "1위", "100% 만족", "무조건", 질병 예방·치료 효능 같은 과장·의학 표현 금지.
- 신선식품 특성상 크기·색·맛은 개체 차이가 있다는 안내를 넣는다.
- 배송·반품 조건은 쓰지 않는다(판매처 설정을 따름).
- 이미지는 입력으로 받은 주소만 <img>로 쓴다. 새 이미지를 만들거나 지어내지 않는다.
- HTML은 div, h2, h3, p, ul, li, img, table, tr, td, strong, br 만 쓰고 style 속성은 인라인으로만. script, iframe, 외부 CSS 금지.
- 폭 780px 기준, 모바일에서도 읽히게 큰 글씨(본문 17px 이상), 섹션마다 여백.
반드시 JSON 하나만 출력: {"title": "노출상품명(40자 이내, 품목·산지·중량·등급 위주)", "tags": ["검색어", ... 최대 20개, 각 20자 이내, 특수문자 없이], "html": "상세페이지 HTML"}`

async function aiDetail(job: any) {
  const key = `ai-${job.sellerProductId}`
  await store().setJSON(key, { running: true, startedAt: now() })
  try {
    if (!process.env.ANTHROPIC_BASE_URL && !process.env.ANTHROPIC_API_KEY)
      throw new Error("Netlify AI Gateway가 켜져 있지 않습니다. (Netlify 크레딧 요금제에서만 동작)")
    const p = await getProduct(job.sellerProductId)
    const c = extractContent(p)
    const input = {
      현재상품명: p.displayProductName || p.sellerProductName,
      옵션: (p.items || []).map((it: any) => it.itemName),
      기존상세글: c.text,
      사용할이미지: c.images,
      판매자메모: job.notes || "",
    }
    const client = new Anthropic()
    const msg = await client.messages.create({
      model: process.env.AI_MODEL || "claude-sonnet-5-5",
      max_tokens: 6000,
      system: SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(input, null, 1) }],
    })
    const text = msg.content.map((b: any) => (b.type === "text" ? b.text : "")).join("")
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) throw new Error("AI 응답을 읽지 못했습니다.")
    const out = JSON.parse(m[0])
    await store().setJSON(key, { running: false, at: now(), title: out.title || "", tags: out.tags || [], html: out.html || "", images: c.images })
  } catch (e: any) {
    await store().setJSON(key, { running: false, at: now(), error: String(e?.message || e) })
  }
}

export default async (req: Request) => {
  if (!isLoggedIn(req)) return
  const job = await req.json().catch(() => ({}))
  if (job.type === "refresh") await refreshProducts()
  if (job.type === "ai" && job.sellerProductId) await aiDetail(job)
}
