// 오래 걸리는 작업(쿠팡 상품 전체 새로고침, AI 상세페이지 초안)을 백그라운드로 처리한다.
// 결과는 Blobs(admin-settings)에 저장하고, 관리자 화면이 주기적으로 읽어 간다.
import { aiCreate } from "./_lib/ai.mts"
import { getStore } from "@netlify/blobs"
import Anthropic from "@anthropic-ai/sdk"
import { createHash } from "node:crypto"
import { isLoggedIn } from "./_lib/auth.mts"
import { listProducts, getProduct, getInventory, extractContent, normImg, predictCategory, categoryMeta, createProduct, outboundCourier } from "./_lib/coupang.mts"
import { imageGenConfigured, makeShots, makeMainImage, type Shot, type ShotResult } from "./_lib/image-gen.mts"

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
    // 도매(행운프레시) 상품은 옵션이 수백 개라 옵션마다 재고를 묻지 않는다 (Make 크레딧 절약).
    // 판매 여부는 자동 판매중지 기록으로 알고, 한 번 불러온 상품은 상태가 같으면 다시 부르지 않는다.
    const lk = new Map<string, any>()
    try {
      const vs = getStore({ name: "admin-vendors", consistency: "strong" }); const { blobs } = await vs.list()
      for (const b of blobs) { const v: any = await vs.get(b.key, { type: "json" }); if (v?.lucky) for (const x of v.products || []) if (x.coupangItemId) lk.set(String(x.coupangItemId), x) }
    } catch {}
    const prevBy = new Map<string, any>((prev.products || []).map((r: any) => [String(r.sellerProductId), r]))
    const rows = await pool(list, 3, async (sp: any) => {
      const id = String(sp.sellerProductId)
      try {
        const old = prevBy.get(id)
        if (old?.lucky && old.status === sp.statusName && (old.items || []).length) {
          return { ...old, items: old.items.map((i: any) => ({ ...i, onSale: lk.has(String(i.vendorItemId)) ? !lk.get(String(i.vendorItemId)).autoStopped : i.onSale })) }
        }
        const p = await getProduct(id)
        const isLucky = (p.items || []).some((it: any) => lk.has(String(it.vendorItemId || "")))
        const items = await pool(p.items || [], 3, async (it: any) => {
          const vid = it.vendorItemId ? String(it.vendorItemId) : ""
          const lx = lk.get(vid)
          const inv = vid && !isLucky ? await getInventory(vid).catch(() => null) : null
          return {
            vendorItemId: vid,
            itemName: it.itemName,
            image: (() => { const r = (it.images || []).find((x: any) => x.imageType === "REPRESENTATION") || (it.images || [])[0]; return r ? normImg(r.cdnPath || r.vendorPath) : "" })(),
            salePrice: inv?.salePrice ?? it.salePrice,
            originalPrice: it.originalPrice,
            onSale: inv ? !!inv.onSale : isLucky ? (lx ? !lx.autoStopped : /승인완료|APPROVED/.test(String(sp.statusName || ""))) : null,
            stock: inv?.amountInStock ?? it.maximumBuyCount ?? null,
          }
        })
        const tags = [...new Set((p.items || []).flatMap((it: any) => it.searchTags || []))]
        const c = extractContent(p)
        return {
          sellerProductId: id,
          lucky: isLucky || undefined,
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


// ---------- 상세페이지 디자인 테마 ----------
const THEMES: Record<string, { name: string; main: string; deep: string; soft: string; band: string; text: string }> = {
  citrus: { name: "감귤 오렌지", main: "#F07A13", deep: "#9A3F00", soft: "#FFE7CC", band: "#FFF7EE", text: "#2B1A0E" },
  premium: { name: "프리미엄 다크", main: "#C8A15A", deep: "#1C1A17", soft: "#F1E6CF", band: "#F7F4EE", text: "#1C1A17" },
  fresh: { name: "싱그러운 그린", main: "#2E8B57", deep: "#14532D", soft: "#DCF2E3", band: "#F3FAF5", text: "#16231B" },
  berry: { name: "레드 베리", main: "#C8263F", deep: "#7A0F22", soft: "#FADADF", band: "#FFF5F6", text: "#2A0F14" },
  clean: { name: "깔끔 화이트", main: "#222222", deep: "#111111", soft: "#EDEDED", band: "#F7F7F7", text: "#222222" },
}

function designGuide(key: string) {
  const t = THEMES[key] || THEMES.citrus
  const F = `'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif`
  return `[디자인 시스템 — 반드시 이 부품만 조합해서 만든다. 색은 아래 값만 쓴다]
테마: ${t.name} / 포인트 ${t.main} / 진한색 ${t.deep} / 연한색 ${t.soft} / 배경띠 ${t.band} / 글자 ${t.text}
규칙: 페이지 바탕은 흰색(#FFFFFF). 배경띠 섹션과 흰 섹션을 번갈아 쓴다. 그라데이션은 형광펜 강조에만. 회색 박스·테두리 남발 금지. 그림자는 카드에만 0 4px 16px rgba(0,0,0,.06).

전체 감싸기:
<div style="max-width:780px;margin:0 auto;background:#FFFFFF;font-family:${F};color:${t.text};line-height:1.7;word-break:keep-all">

① 첫 화면(히어로):
<div style="background:${t.deep};color:#FFFFFF;text-align:center;padding:56px 24px 0">
  <div style="display:inline-block;border:1.5px solid ${t.main};color:${t.main};border-radius:999px;padding:6px 16px;font-size:14px;font-weight:800;letter-spacing:1px">산지직송</div>
  <div style="font-size:16px;opacity:.8;margin-top:18px">짧은 위 문구</div>
  <h1 style="font-size:38px;font-weight:900;letter-spacing:-1px;line-height:1.3;margin:8px 0 28px">핵심 헤드라인<br><span style="color:${t.main}">강조어</span></h1>
  <img src="{{P1}}" style="width:100%;display:block;border-radius:20px 20px 0 0">
</div>

② 섹션 머리(모든 섹션 공통):
<div style="text-align:center;padding:64px 24px 24px">
  <div style="color:${t.main};font-size:13px;font-weight:800;letter-spacing:3px">POINT 01</div>
  <h2 style="font-size:29px;font-weight:900;letter-spacing:-.5px;margin:10px 0 12px;line-height:1.35">섹션 제목</h2>
  <p style="font-size:18px;color:#555;margin:0">한두 줄 설명</p>
</div>

③ 핵심 포인트 카드(3개를 세로로):
<div style="background:#FFFFFF;border-radius:18px;box-shadow:0 4px 16px rgba(0,0,0,.06);padding:24px;margin:0 24px 14px;display:flex;gap:16px;align-items:flex-start">
  <div style="flex:0 0 44px;height:44px;border-radius:50%;background:${t.main};color:#FFFFFF;font-weight:900;font-size:18px;line-height:44px;text-align:center">1</div>
  <div><div style="font-size:21px;font-weight:800">포인트 제목</div><div style="font-size:17px;color:#555;margin-top:4px">한 줄 설명</div></div>
</div>

④ 큰 숫자 강조(메모에 근거 수치가 있을 때만):
<div style="background:${t.band};text-align:center;padding:48px 24px">
  <div style="font-size:16px;font-weight:700;color:${t.deep}">측정 예시</div>
  <div style="font-size:64px;font-weight:900;color:${t.main};letter-spacing:-2px;line-height:1.1">수치<span style="font-size:28px"> 단위</span></div>
  <div style="font-size:14px;color:#777;margin-top:8px">측정 조건 · 과일마다 차이가 있습니다</div>
</div>

⑤ 사진 + 설명:
<div style="padding:0 24px 40px"><img src="{{P2}}" style="width:100%;display:block;border-radius:16px"><p style="font-size:16px;color:#666;text-align:center;margin:12px 0 0">사진 설명</p></div>

⑥ 형광펜 강조(섹션당 1번): <span style="background:linear-gradient(transparent 58%, ${t.soft} 58%);font-weight:800">강조할 말</span>

⑦ 가이드 카드(고르는 법·보관 등, 세로 목록):
<div style="background:${t.band};padding:8px 24px 48px">
  <div style="background:#FFFFFF;border-radius:16px;padding:22px 22px 20px;margin-top:14px;border-left:6px solid ${t.main}">
    <div style="font-size:19px;font-weight:800;color:${t.deep}">보관</div>
    <div style="font-size:17px;color:#444;margin-top:6px">내용</div>
  </div>
</div>

⑧ 옵션 표:
<table style="width:calc(100% - 48px);margin:0 24px 40px;border-collapse:collapse;font-size:17px;text-align:center">
  <tr><th style="background:${t.deep};color:#FFFFFF;padding:14px;font-weight:800">옵션</th><th style="background:${t.deep};color:#FFFFFF;padding:14px;font-weight:800">이런 분께</th></tr>
  <tr><td style="padding:14px;border-bottom:1px solid #EEE;font-weight:800">2kg</td><td style="padding:14px;border-bottom:1px solid #EEE">설명</td></tr>
</table>

⑨ 배송·반품 안내:
<div style="margin:0 24px 40px;border-radius:16px;overflow:hidden;border:1px solid #EEE">
  <div style="background:${t.deep};color:#FFFFFF;padding:14px 20px;font-size:19px;font-weight:800">배송 · 교환 · 반품 안내</div>
  <div style="padding:16px 20px;border-bottom:1px solid #F0F0F0;font-size:16px"><strong style="color:${t.deep}">항목</strong>&nbsp; 내용</div>
</div>

⑩ 꼭 읽어 주세요: 배경 #FAFAFA, 15~16px, 회색 글씨, 점 목록.

⑪ 맨 끝 판매자 소개:
<div style="background:${t.deep};color:#FFFFFF;text-align:center;padding:48px 24px">
  <div style="font-size:28px;font-weight:900;letter-spacing:2px">모아커머스</div>
  <div style="width:32px;height:3px;background:${t.main};margin:14px auto"></div>
  <p style="font-size:16px;opacity:.85;margin:0">소개 문장</p>
</div>

위 부품의 구조·크기·색을 그대로 지키고 글과 사진 번호만 바꾼다. 필요 없는 부품은 빼도 된다.
`
}

const SYSTEM = `당신은 한국 오픈마켓(쿠팡) 신선식품 상세페이지를 10년 넘게 만든 전문 기획자 겸 카피라이터입니다.
입력으로 상품 정보, 판매자 메모, 그리고 번호가 붙은 실제 사진들을 받습니다. 사진을 직접 보고 분석한 뒤 상세페이지를 설계하세요.

[1단계: 사진 분석]
- 각 사진이 무엇인지(과육 단면, 박스 포장, 농장, 당도계, 글자가 들어간 홍보 이미지 등) 파악한다.
- 사진 안에 박힌 글자·숫자(당도, 중량, 인증, 방송, 순위 등)를 읽는다.
- 사진 속 수치·주장이 판매자 메모와 다르거나 메모에 근거가 없으면 그 사진은 쓰지 않고, 분석에 이유를 적는다. (예: 메모는 16.6 Brix인데 사진에는 13브릭스 문구)
- 흐리거나 중복이거나 상품과 무관한 사진도 제외하고 이유를 적는다.
- 판매자가 추가한 사진(설명 포함)은 반드시 사용하고, 설명 문구를 사진 바로 아래에 넣는다.

[2단계: 구성 — 모바일 구매자가 위에서부터 읽는 순서]
1. 첫 화면: 가장 먹음직스러운 사진 + 한 줄 핵심 문구(무슨 과일인지, 어디 것인지). "확인된공통사실"에 산지직송이 있으면 첫 화면에 '산지직송' 배지를 둔다.
2. 핵심 포인트 3가지(짧은 제목 + 한 줄 설명) — 입력에 근거가 있는 것만
3. 근거 섹션: 당도계 사진·방송 출연 등 메모에 있는 사실. 측정값은 "측정 예시"로 쓰고 개체 차이 안내를 붙인다.
4. 상품 사진 섹션: 과육·크기·포장 사진을 설명과 함께
5. 옵션 안내 표(중량별 구성, 어떤 가구에 맞는지)
6. 전문가 가이드(고르는 법·받으면 바로 할 일·보관·손질·드시는 법): 입력의 "과일정보"만 근거로, 항목별 아이콘형 카드나 번호 카드로 정리한다. 과일정보에 없는 온도·기간·효능 숫자는 쓰지 않는다. 과일정보가 비었으면 이 섹션을 만들지 않는다.
7. 배송·교환·반품 안내: 입력의 "배송반품안내"가 있을 때만, 그 내용을 빠짐없이 쉬운 말로 정리한다(표나 아이콘형 카드). 내용을 바꾸거나 없는 조건을 더하지 않는다.
8. 꼭 읽어 주세요: 신선식품 개체 차이, 수령 후 바로 확인 안내
9. 맨 끝 판매자 소개: 입력의 "판매자소개"가 있을 때만, 브랜드명을 크게 두고 소개 문장을 그대로 살려 신뢰감 있게 마무리한다. 소개에 없는 수상·규모·연혁은 만들지 않는다.
섹션 수는 사진과 정보 양에 맞게 조절한다. 정보가 없는 섹션은 만들지 않는다.

[글 규칙]
- 사실의 근거는 판매자메모·확인된공통사실·과일정보·배송반품안내·사진 설명뿐이다. 기존상세글은 참고만 하고, 판매자메모와 다르면 판매자메모를 따른다.
- 입력(메모·사진 설명·기존 상세글)에 없는 수치, 인증, 수상, 판매량, 후기, 순위는 절대 만들지 않는다.
- "최고", "1위", "100%", "무조건", 질병 예방·치료 등 과장·의학 표현 금지. 방송 프로그램 이름은 메모에 있을 때만 쓴다.
- 판매자 메모의 지시(예: "당도 수치는 쓰지 말 것")가 최우선이다.
- 카카오톡·오픈채팅·전화번호·외부 사이트·SNS 주소, "검색해서 찾아오세요" 같은 외부 채널 유도 문구는 절대 넣지 않는다(쿠팡 외부거래 유도 금지).
- 가격은 쓰지 않는다. 배송·반품은 "배송반품안내"에 있는 내용만 쓴다.
- 문장은 짧게. 초등학생도 이해할 쉬운 말. 한 문단 2문장 이내.

[사진 원칙 — 실제 사진 위주]
- 상세페이지는 실제 사진이 중심이다. 쓸 수 있는 실제 사진은 최대한 쓴다.
- 실제 사진으로 채울 수 없는 꼭 필요한 컷(예: 과육 단면이 전혀 없음, 대표로 쓸 깔끔한 사진이 없음)만 AI 연출 사진을 요청한다. 최대 2장, 필요 없으면 요청하지 않는다.
- 요청은 @@SHOTS 에 "기준사진번호 | 만들 사진 | 이유" 한 줄씩 쓴다. 기준 사진은 그 상품이 가장 잘 보이는 실제 사진 번호.
- HTML에서 첫 번째 요청 사진 자리는 {{G1}}, 두 번째는 {{G2}} 로 쓴다.

[HTML 규칙]
- 이미지 주소를 직접 쓰지 않는다. 실제 사진 n번은 <img src="{{Pn}}"> 처럼 번호 표시만 쓴다(예: {{P1}}, {{P3}}). AI 연출 사진은 {{G1}}, {{G2}}. 다른 주소 금지.
- 레이아웃·색·글자 크기는 사용자 메시지의 [디자인 시스템]을 그대로 따른다.
- div, h1, h2, h3, p, ul, li, img, table, tr, td, th, strong, span, br 만 사용. 모든 스타일은 인라인 style. script/iframe/외부 CSS/웹폰트 금지.
- 글꼴: 웹폰트는 못 쓰므로 font-family:'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif 를 전체에 지정한다.
- 글자 위계(모바일 기준): 첫 화면 헤드라인 34~40px·font-weight:900·letter-spacing:-1px, 섹션 제목 28~30px·900, 소제목 21px·800, 본문 18~19px·400·line-height:1.7·color:#333, 보조 설명 15px·#777.
- 강조: 핵심 단어·숫자는 <strong>과 포인트 색으로, 한 문단에 한 곳만. 가장 중요한 숫자(예: 당도 측정값)는 48px 이상 900 굵기로 크게 보여 주고 바로 아래 작은 글씨로 측정 조건·개체 차이를 붙인다. 형광펜 효과는 background:linear-gradient(transparent 60%, 연한 포인트색 60%) 로 섹션당 1회까지.
- 섹션 구분: 섹션 제목 위에 작은 영문 라벨(예: POINT 01, 12px·letter-spacing:3px·포인트색)이나 번호 배지, 연한 배경 띠를 번갈아 써서 리듬을 만든다.
- 이미지는 width:100%, 섹션 사이 여백 56px 이상, 가운데 정렬 위주. 흰 글씨를 진한 배경 위에 쓸 때는 대비가 충분한지 확인한다.

[검색어 규칙]
- 구매자가 실제로 칠 만한 말: 품목명, 품종 다른 이름, 산지, 용도(선물용·가정용), 제철 표현. 다른 브랜드명·무관한 인기어 금지. 20개 이내, 각 20자 이내, 특수문자 없이.

[출력 형식 — 아래 구분선을 그대로 쓰고 다른 말은 쓰지 않는다]
@@TITLE
노출상품명 한 줄 (50자 이내, 품목·산지·특징·중량 위주, 메모에 없는 수치 금지)
@@TAGS
검색어1, 검색어2, ...
@@ANALYSIS
사진별 판단을 한 줄씩 (예: "사진 3: 13브릭스 문구가 있어 제외"), 그리고 판매자가 확인해야 할 점
@@SHOTS
기준사진번호 | 만들 사진 | 이유   (필요 없으면 "없음")
@@HTML
상세페이지 HTML`

function section(text: string, name: string) {
  const m = text.match(new RegExp(`@@${name}\\s*([\\s\\S]*?)(?=\\n@@[A-Z]+\\s|$)`))
  return m ? m[1].trim() : ""
}

async function aiDetail(job: any) {
  const key = `ai-${job.sellerProductId}`
  await store().setJSON(key, { running: true, startedAt: now() })
  try {
    if (!process.env.ANTHROPIC_BASE_URL && !process.env.ANTHROPIC_API_KEY)
      throw new Error("Netlify AI Gateway가 켜져 있지 않습니다. (Netlify 크레딧 요금제에서만 동작)")
    const p = await getProduct(job.sellerProductId)
    const c = extractContent(p)
    const existing: string[] = (Array.isArray(job.images) ? job.images : c.images).filter((u: string) => c.images.includes(u)).slice(0, 12)
    const extras: any[] = (Array.isArray(job.extras) ? job.extras : []).filter((e: any) => /^https:\/\/[^\s"'<>]+\/img\/[a-f0-9-]{36}\.jpg$/.test(String(e?.url || ""))).slice(0, 6)
    const photos = [
      ...extras.map((e) => ({ url: e.url, kind: "판매자가 추가한 사진(반드시 사용)", caption: String(e.caption || "") })),
      ...existing.map((u) => ({ url: u, kind: "기존 등록 사진", caption: "" })),
    ]
    const info = {
      현재상품명: p.displayProductName || p.sellerProductName,
      옵션: (p.items || []).map((it: any) => it.itemName),
      기존상세글: c.text,
      판매자메모: job.notes || "",
      배송반품안내: String(job.shipping || "").slice(0, 2000),
      판매자소개: String(job.brand || "").slice(0, 1000),
      확인된공통사실: String(job.facts || "").slice(0, 1000),
      과일정보: String(job.fruitGuide || "").slice(0, 3000),
    }
    // 사진을 직접 받아 AI에게 보낸다 (쿠팡 CDN을 AI 쪽에서 못 읽는 경우 대비)
    const inline: any[] = await Promise.all(
      photos.map(async (ph) => {
        try {
          const r = await fetch(ph.url, { headers: { "user-agent": "Mozilla/5.0" } })
          const type = (r.headers.get("content-type") || "").split(";")[0]
          if (!r.ok || !/^image\/(jpeg|png|webp|gif)$/.test(type)) return null
          const buf = Buffer.from(await r.arrayBuffer())
          if (buf.byteLength > 4.5 * 1024 * 1024) return null
          return { type: "base64", media_type: type, data: buf.toString("base64") }
        } catch {
          return null
        }
      }),
    )
    const build = (withVision: boolean) => {
      const content: any[] = [{ type: "text", text: "상품 정보:\n" + JSON.stringify(info, null, 1) }]
      photos.forEach((ph, i) => {
        content.push({ type: "text", text: `사진 ${i + 1} {{P${i + 1}}} — ${ph.kind}${ph.caption ? ` / 설명: ${ph.caption}` : ""}` })
        if (withVision) content.push({ type: "image", source: inline[i] || { type: "url", url: ph.url } })
      })
      content.push({ type: "text", text: designGuide(String(job.theme || "")) })
      content.push({
        type: "text",
        text: job.genImages === false || !imageGenConfigured()
          ? "위 사진을 분석하고 출력 형식대로 작성하세요. 이번에는 AI 연출 사진을 만들 수 없으니 @@SHOTS 는 \"없음\"으로 쓰고 {{G1}}·{{G2}}는 쓰지 마세요."
          : "위 사진을 분석하고 출력 형식대로 작성하세요.",
      })
      return content
    }
    const client = new Anthropic()
    const ask = (withVision: boolean) =>
      aiCreate(client, {
        model: process.env.AI_MODEL || "claude-sonnet-5-5",
        max_tokens: 10000,
        system: SYSTEM,
        messages: [{ role: "user", content: build(withVision) }],
      })
    let msg: any, vision = true
    try {
      msg = await ask(true)
    } catch (e) {
      vision = false
      msg = await ask(false)
    }
    const text = msg.content.map((b: any) => (b.type === "text" ? b.text : "")).join("")
    let html = section(text, "HTML").replace(/^```html?\s*|\s*```$/g, "")
    if (!html) throw new Error("AI 응답을 읽지 못했습니다. 다시 시도해 주세요.")
    const warnings: string[] = []

    // 꼭 필요한 컷만 AI로 생성 → 자동 검수 통과분만 사용
    let shots: ShotResult[] = []
    const wanted: Shot[] = section(text, "SHOTS")
      .split("\n")
      .map((l: string) => l.split("|").map((x) => x.trim()))
      .filter((a: string[]) => a.length >= 2 && /^\d+$/.test(a[0]))
      .map((a: string[]) => ({ base: Number(a[0]), what: a[1], why: a[2] || "" }))
      .slice(0, 2)
    if (wanted.length && job.genImages !== false) {
      if (!imageGenConfigured()) warnings.push("AI가 연출 사진이 필요하다고 판단했지만 OpenAI 키(OPENAI_API_KEY)가 없어 만들지 않았습니다.")
      else shots = await makeShots(wanted, photos.map((p) => p.url), job.origin || "")
    }

    // 번호 표시({{P1}}, {{G1}})를 실제 주소로 바꾸고, 못 바꾼 이미지는 제거
    const urlFor = (tok: string) => {
      const m = tok.match(/^([PG])(\d+)$/)
      if (!m) return ""
      const n = Number(m[2])
      if (m[1] === "P") return photos[n - 1]?.url || ""
      const s = shots[n - 1]
      return s?.ok && s.url ? s.url : ""
    }
    const used = new Set<string>()
    let dropped = 0
    html = html.replace(/<img\b[^>]*>/gi, (tag: string) => {
      const src = (tag.match(/src=["']([^"']+)["']/i) || [])[1] || ""
      const tok = (src.match(/\{\{\s*([PG]\d+)\s*\}\}/) || [])[1] || ""
      let real = tok ? urlFor(tok) : ""
      // 혹시 AI가 실제 주소를 그대로 쓴 경우도 허용
      if (!real && photos.some((p) => p.url === src.replace(/&amp;/g, "&"))) real = src.replace(/&amp;/g, "&")
      if (!real) {
        dropped++
        return ""
      }
      used.add(real)
      const isAi = tok.startsWith("G")
      const fixed = tag.replace(src, () => real).replace(/<img/i, '<img referrerpolicy="no-referrer"')
      return isAi
        ? fixed + '<p style="font-size:12px;color:#999;margin:4px 0 0;text-align:center">연출 이미지입니다. 실제 상품은 위 실사진을 참고해 주세요.</p>'
        : fixed
    })
    html = html.replace(/\{\{\s*[PG]\d+\s*\}\}/g, "")

    // 안전장치: 실제 사진이 하나도 안 들어갔으면 고른 사진을 아래에 모두 붙인다
    const realUsed = photos.filter((p) => used.has(p.url)).length
    if (photos.length && realUsed === 0) {
      const gallery = photos
        .map(
          (p) =>
            `<img src="${p.url}" referrerpolicy="no-referrer" style="width:100%;display:block;margin:0 0 12px">` +
            (p.caption ? `<p style="font-size:16px;color:#555;text-align:center;margin:0 0 24px">${p.caption.replace(/[<>&"]/g, "")}</p>` : ""),
        )
        .join("")
      html = html.replace(/<\/div>\s*$/, `<div style="margin-top:56px">${gallery}</div></div>`)
      if (!/<\/div>\s*$/.test(html)) html += gallery
      warnings.push("AI가 실제 사진을 하나도 넣지 않아, 고른 사진을 상세페이지 아래에 모두 붙였습니다.")
    }
    const unusedReal = photos.map((p, i) => (used.has(p.url) ? 0 : i + 1)).filter(Boolean)
    if (realUsed && unusedReal.length) warnings.push(`사진 ${unusedReal.join(", ")}번은 상세페이지에 쓰이지 않았습니다. 이유는 아래 AI 사진 분석을 보세요.`)
    for (const s of shots) {
      if (s.ok) warnings.push(`AI 연출 사진 "${s.what}" 추가 (검수 ${s.score}/10 통과). 네이버 신선식품에는 AI 생성 이미지를 쓰지 마세요.`)
      else warnings.push(`AI 연출 사진 "${s.what}"은 품질 기준 미달로 넣지 않았습니다${s.error ? ` (${s.error})` : ""}.`)
    }

    // 입력에 없는 당도 수치가 들어갔는지 점검
    const source = JSON.stringify(info) + extras.map((e) => e.caption).join(" ")
    const plain = html.replace(/<[^>]+>/g, " ")
    for (const m of plain.matchAll(/(\d+(?:\.\d+)?)\s*(?:brix|브릭스)/gi)) {
      if (!source.includes(m[1])) warnings.push(`상세글에 메모에 없는 당도 수치 ${m[1]}가 있습니다. 확인하세요.`)
    }
    for (const e of extras) if (!html.includes(e.url)) warnings.push("추가한 사진 중 상세페이지에 들어가지 않은 것이 있습니다.")
    if (!vision) warnings.push("사진을 직접 보지 못하고 글만으로 작성했습니다. 사진 속 문구(예: 13브릭스)는 직접 확인하세요.")
    if (dropped) warnings.push(`주소를 알 수 없는 이미지 ${dropped}개를 제거했습니다.`)
    await store().setJSON(key, {
      running: false,
      at: now(),
      title: section(text, "TITLE").split("\n")[0] || "",
      tags: section(text, "TAGS").split(/[,\n]/).map((t: string) => t.trim()).filter(Boolean),
      analysis: section(text, "ANALYSIS"),
      warnings: [...new Set(warnings)],
      html,
      vision,
      shots,
    })
  } catch (e: any) {
    await store().setJSON(key, { running: false, at: now(), error: String(e?.message || e) })
  }
}

// ================= 이미지형(디자이너) 상세페이지: AI는 내용(JSON)만, 디자인은 고정 템플릿 =================
const DESIGN_SYSTEM = `당신은 한국 오픈마켓 신선식품 상세페이지 기획자입니다. 디자인은 정해진 틀이 하고, 당신은 틀에 들어갈 "내용"만 JSON으로 만듭니다.
입력: 상품 정보, 판매자 메모, 공통 사실, 과일 정보, 배송반품안내, 판매자소개, 번호가 붙은 실제 사진.

[사진 판단]
- 사진을 직접 보고 무엇인지, 사진 속 글자·숫자를 읽는다.
- 메모와 다른 수치(예: 13브릭스)가 박힌 사진, 흐린 사진, 중복, 무관한 사진은 쓰지 않고 analysis에 이유를 적는다.
- 판매자가 추가한 사진은 반드시 쓴다(설명이 있으면 그 설명을 caption이나 note에 살린다).
- hero.photo는 가장 먹음직스럽고 글자가 없는 깨끗한 사진.
- 사진 제목·설명(title·caption)은 그 사진에 실제로 보이는 것만 쓴다. 사진에 없는 장면(나무에 달린 모습, 하우스, 완충재 등)을 지어내면 안 된다. 보이는 게 애매하면 caption을 비운다.
- 한 사진은 한 번만 쓴다(hero·proof·gallery·points 통틀어).
- 글자·배너가 이미 들어간 홍보 이미지(다른 곳에서 만든 상세 이미지)는 사진으로 쓰지 않는다. 글자 없는 실제 사진만 쓴다. 홍보 이미지 속 문구는 참고만 하되, 근거 없는 수치·후기·"한 번만 주문한 사람은 없다" 같은 주장은 옮기지 않는다.
- 후기·별점·고객 리뷰는 절대 만들지 않는다.
- 이 상세페이지는 모든 옵션(예: 2kg·3kg·5kg)에 똑같이 들어간다. 제목·포인트·문구에 특정 중량 하나만 쓰지 말고, 중량 이야기는 options에서 모든 옵션을 빠짐없이 다룬다.

[글 규칙]
- 사실 근거는 판매자메모·확인된공통사실·과일정보·배송반품안내·판매자소개·사진 설명뿐. 없는 수치·인증·수상·판매량·후기·순위 금지.
- "최고","1위","100%","무조건", 효능·질병 표현 금지. 카톡·전화·외부 사이트·SNS 등 외부 채널 언급 금지. 가격 금지.
- 판매자 메모의 지시가 최우선.
- 쉬운 말로 쓰되 내용은 충실하게. headline 16자 이내. points의 desc, guide·shipping의 text, gallery의 caption은 한 줄로 끝내지 말고 구매자가 궁금해할 내용을 2~3문장(60~120자)으로 풀어 쓴다. 단, 근거 없는 내용으로 늘리지 않는다.
- points는 근거가 있으면 4개까지 쓴다. keywords·worries·answer는 빈 값으로 둔다.
- 측정 수치는 "측정 예시"로, note에 "1개 측정 · 과일마다 차이가 있습니다" 류의 안내를 붙인다.
- shipping은 배송반품안내의 내용을 빠짐없이, 바꾸거나 더하지 말고 항목별로 나눈다.
- guide는 과일정보에 있는 내용만, 항목별로 나눈다. 과일정보가 비면 빈 배열.

[출력 — JSON 하나만, 다른 말 금지. 문자열 안에 큰따옴표(")를 쓰지 말고 필요하면 작은따옴표나 「」를 쓴다]
{
 "title": "노출상품명 50자 이내 (품목·산지·특징·중량, 메모에 없는 수치 금지)",
 "tags": ["검색어 최대 20개, 각 20자 이내, 특수문자 없이"],
 "analysis": "사진별 판단 한 줄씩 + 판매자가 확인할 점",
 "hero": {"photo": 사진번호, "badge": "공통 사실에 산지직송이 있으면 '산지직송', 없으면 빈 문자열", "eyebrow": "작은 위 문구", "headline": "큰 제목", "highlight": "headline 안에서 색으로 강조할 단어(headline에 포함된 그대로)", "sub": "한 줄 설명"},
 "intro": "첫 화면 아래 한두 문장 소개",
 "points": [{"title": "포인트 제목(10자 이내)", "desc": "한 줄 설명", "photo": 그 포인트를 보여 주는 사진번호 또는 null}],
 "keywords": ["첫 화면 아래 띠에 넣을 짧은 강점 3개(각 6자 이내, 근거 있는 것만. 예: 산지직송, 방송 출연, 상자 포함)"],
 "worries": ["구매자가 과일 살 때 흔히 하는 걱정 3개(예: 받아 보니 신맛만 나면 어쩌지?) — 일반적인 걱정만, 경쟁사 비방 금지"],
 "answer": "걱정에 대한 한 줄 답(근거 있는 사실만)",
 "proof": null 또는 {"photo": 사진번호 또는 null, "label": "예: 비파괴 당도계 측정 예시", "value": "16.6", "unit": "Brix", "note": "측정 조건·개체 차이 안내"},
 "story": null 또는 {"label": "예: TV 방송 출연 농가", "title": "짧은 제목", "text": "한두 문장"},
 "gallery": [{"photo": 사진번호, "title": "짧은 제목", "caption": "한 줄 설명"}],
 "options": [{"name": "옵션 이름(예: 2kg)", "fit": "이런 분께 (한 줄)"}],
 "guide": [{"label": "예: 고르는 법 / 받으면 바로 / 보관 / 손질 / 드시는 법", "text": "내용"}],
 "shipping": [{"label": "항목", "text": "내용"}],
 "notice": ["꼭 읽어 주세요 항목"],
 "brand": null 또는 {"name": "브랜드명", "text": "판매자소개 문장"},
 "scenes": [{"slot": "hero|intro|option|guide|brand", "base": 기준사진번호, "what": "만들 연출 사진 설명(영어 권장, 소품·배경·구도·빛 중심)"}]
}
[scenes — 상세페이지 분위기 사진]
- 같은 사진이 반복되면 성의 없어 보인다. 섹션마다 다른 장면의 연출 사진을 계획한다(최대 4장).
- hero: 대표 장면(예: 나무 테이블 위 바구니에 담긴 과일, 잎 달린 과일, 자연광). intro: 산지·수확 분위기. option: 상자에 담긴 모습. guide: 껍질 벗긴 과육·먹는 장면. brand: 차분한 정물.
- base는 그 과일이 가장 잘 보이는 실제 사진 번호(글자 없는 사진). 과일 품종·색·크기는 실제와 같게 유지하고 연출만 바꾼다. 글자·로고 금지.
points는 3개(근거 부족하면 2개), gallery는 쓸 수 있는 실제 사진 전부(hero·proof에 쓴 사진 제외, 최대 6장).`

// AI가 준 JSON이 조금 깨져 있어도 살려 낸다 (끝 쉼표 제거 → 그래도 안 되면 AI에게 고쳐 달라고 요청)
async function parseLoose(text: string, client?: Anthropic): Promise<any> {
  const m = text.match(/[\[{][\s\S]*[\]}]/)
  const raw = m ? m[0] : text
  const tries = [raw, raw.replace(/,\s*([\]}])/g, "$1"), raw.replace(/,\s*([\]}])/g, "$1").replace(/[\u201c\u201d]/g, '\\"')]
  for (const t of tries) { try { return JSON.parse(t) } catch {} }
  if (!client) throw new Error("AI 응답 형식 오류")
  const fix: any = await aiCreate(client, {
    model: process.env.AI_MODEL || "claude-sonnet-5-5",
    max_tokens: 8000,
    system: "깨진 JSON을 받아 문법만 고쳐 올바른 JSON으로 돌려줍니다. 문자열 안의 큰따옴표는 \\\" 로 이스케이프합니다. 내용은 한 글자도 바꾸지 않습니다. JSON만 출력.",
    messages: [{ role: "user", content: raw }],
  })
  const ft = fix.content.map((b: any) => (b.type === "text" ? b.text : "")).join("")
  const fm = ft.match(/[\[{][\s\S]*[\]}]/)
  return JSON.parse(fm ? fm[0] : ft)
}

async function aiDesign(job: any) {
  const key = `design-${job.sellerProductId}`
  await store().setJSON(key, { running: true, startedAt: now() })
  try {
    if (!process.env.ANTHROPIC_BASE_URL && !process.env.ANTHROPIC_API_KEY)
      throw new Error("Netlify AI Gateway가 켜져 있지 않습니다.")
    const p = await getProduct(job.sellerProductId)
    const c = extractContent(p)
    const existing: string[] = (Array.isArray(job.images) ? job.images : c.images).filter((u: string) => c.images.includes(u)).slice(0, 12)
    const extras: any[] = (Array.isArray(job.extras) ? job.extras : []).filter((e: any) => /^https:\/\/[^\s"'<>]+\/img\/[a-f0-9-]{36}\.jpg$/.test(String(e?.url || ""))).slice(0, 6)
    const photos = [
      ...extras.map((e) => ({ url: e.url, kind: "판매자가 추가한 사진(반드시 사용)", caption: String(e.caption || "") })),
      ...existing.map((u) => ({ url: u, kind: "기존 등록 사진", caption: "" })),
    ]
    const info = {
      현재상품명: p.displayProductName || p.sellerProductName,
      옵션: (p.items || []).map((it: any) => it.itemName),
      기존상세글: c.text,
      판매자메모: job.notes || "",
      배송반품안내: String(job.shipping || "").slice(0, 2000),
      판매자소개: String(job.brand || "").slice(0, 1000),
      확인된공통사실: String(job.facts || "").slice(0, 1000),
      과일정보: String(job.fruitGuide || "").slice(0, 3000),
    }
    const inline: any[] = await Promise.all(
      photos.map(async (ph) => {
        try {
          const r = await fetch(ph.url, { headers: { "user-agent": "Mozilla/5.0" } })
          const type = (r.headers.get("content-type") || "").split(";")[0]
          if (!r.ok || !/^image\/(jpeg|png|webp|gif)$/.test(type)) return null
          const buf = Buffer.from(await r.arrayBuffer())
          if (buf.byteLength > 4.5 * 1024 * 1024) return null
          return { type: "base64", media_type: type, data: buf.toString("base64"), hash: createHash("sha1").update(buf).digest("hex") }
        } catch {
          return null
        }
      }),
    )
    // 같은 사진(내용이 같은 파일) 중복 제거, AI가 못 본 사진은 쓰지 않음
    {
      const seenHash = new Set<string>()
      const keepP: any[] = [], keepI: any[] = []
      photos.forEach((ph, i) => {
        const im = inline[i]
        if (!im) return
        if (seenHash.has(im.hash)) return
        seenHash.add(im.hash)
        keepP.push(ph); keepI.push({ type: "base64", media_type: im.media_type, data: im.data })
      })
      photos.splice(0, photos.length, ...keepP); inline.splice(0, inline.length, ...keepI)
    }
    if (!photos.length) throw new Error("사진을 불러오지 못했습니다. 사진 선택을 확인하세요.")
    // 1차 판독: 사진마다 글자가 박혔는지·서로 같은 사진인지 따로 판정하고, 깨끗한 사진만 남긴다
    const clientA = new Anthropic()
    const sortNotes: string[] = []
    try {
      const sc: any[] = [{ type: "text", text: "사진을 하나씩 판정하세요." }]
      photos.forEach((ph, i) => { sc.push({ type: "text", text: `사진 ${i + 1}` }, { type: "image", source: inline[i] }) })
      const sm: any = await aiCreate(clientA, {
        model: process.env.AI_MODEL || "claude-sonnet-5-5",
        max_tokens: 3000,
        system: `상품 사진 분류기입니다. 각 사진을 보고 JSON 배열만 출력합니다.
[{"n": 번호, "text": 사진 위에 편집으로 넣은 글자·배너·아이콘·별점·말풍선이 있으면 true(상자나 기계에 원래 찍힌 글자는 false), "same": 앞 번호 사진과 같은 장면·같은 사진(크기·자르기만 다름)이면 그 번호 아니면 null, "desc": "사진에 실제로 보이는 것 한 줄"}]`,
        messages: [{ role: "user", content: sc }],
      })
      const arr: any[] = await parseLoose(sm.content.map((b: any) => (b.type === "text" ? b.text : "")).join(""), clientA)
      const keepP: any[] = [], keepI: any[] = []
      photos.forEach((ph, i) => {
        const j = arr.find((x) => Number(x.n) === i + 1) || {}
        const mine = ph.kind.startsWith("판매자가 추가")
        if (!mine && j.text) { sortNotes.push(`기존 사진 ${i + 1}: 글자·배너가 들어간 홍보 이미지라 제외`); return }
        if (!mine && j.same) { sortNotes.push(`기존 사진 ${i + 1}: ${j.same}번과 같은 사진이라 제외`); return }
        keepP.push({ ...ph, desc: String(j.desc || "") }); keepI.push(inline[i])
      })
      if (keepP.length) { photos.splice(0, photos.length, ...keepP); inline.splice(0, inline.length, ...keepI) }
    } catch {}
    const content: any[] = [{ type: "text", text: `상품 정보:\n${JSON.stringify(info, null, 1)}\n\n서로 다른 실제 사진은 ${photos.length}장뿐입니다. 사진 번호는 1~${photos.length}만 쓰고, 같은 사진을 두 번 쓰지 마세요.` }]
    photos.forEach((ph, i) => {
      content.push({ type: "text", text: `사진 ${i + 1} — ${ph.kind}${ph.caption ? ` / 설명: ${ph.caption}` : ""}${(ph as any).desc ? ` / 보이는 것: ${(ph as any).desc}` : ""}` })
      if (inline[i]) content.push({ type: "image", source: inline[i] })
    })
    content.push({ type: "text", text: "출력 형식의 JSON 하나만 쓰세요." })
    const client = new Anthropic()
    const msg: any = await aiCreate(client, {
      model: process.env.AI_MODEL || "claude-sonnet-5-5",
      max_tokens: 6000,
      system: DESIGN_SYSTEM,
      messages: [{ role: "user", content }],
    })
    const text = msg.content.map((b: any) => (b.type === "text" ? b.text : "")).join("")
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) throw new Error("AI 응답을 읽지 못했습니다. 다시 시도해 주세요.")
    let d = await parseLoose(m[0], client)
    // 맞춤법·띄어쓰기 교정 (사실·숫자는 그대로)
    const proofFixes: string[] = []
    try {
      const pr: any = await aiCreate(client, {
        model: process.env.AI_MODEL || "claude-sonnet-5-5",
        max_tokens: 6000,
        system: `당신은 한국어 교정 전문가입니다. 상세페이지 문구 JSON을 받아 맞춤법·띄어쓰기·오타·어색한 표현만 고칩니다.
- 숫자, 단위, 상품명·품종명(유라귤, 옐로향 등), 사실 내용은 절대 바꾸지 않는다. 새 내용 추가 금지.
- photo·base·slot 값과 JSON 구조는 그대로 둔다.
출력: {"fixed": 고친 JSON 전체, "changes": ["원래 → 고친 것", ...]} JSON 하나만.`,
        messages: [{ role: "user", content: JSON.stringify(d) }],
      })
      const pt = pr.content.map((b: any) => (b.type === "text" ? b.text : "")).join("")
      const pm = pt.match(/\{[\s\S]*\}/)
      if (pm) {
        const pj = await parseLoose(pm[0])
        const nums = (o: any) => (JSON.stringify(o).match(/\d+(?:\.\d+)?/g) || []).sort().join(",")
        if (pj.fixed && nums(pj.fixed) === nums(d)) { d = pj.fixed; proofFixes.push(...(pj.changes || []).map(String)) }
      }
    } catch {}
    const ph = (n: any) => (Number.isInteger(Number(n)) && photos[Number(n) - 1] ? photos[Number(n) - 1].url : "")
    if (d.hero) d.hero.photo = ph(d.hero.photo) || photos[0]?.url || ""
    if (d.proof) d.proof.photo = ph(d.proof.photo)
    d.gallery = (d.gallery || []).map((g: any) => ({ ...g, photo: ph(g.photo) })).filter((g: any) => g.photo)
    d.points = (d.points || []).map((x: any) => ({ ...x, photo: ph(x.photo) }))
    // 추가한 사진이 빠졌으면 갤러리에 넣는다
    const used = new Set([d.hero?.photo, d.proof?.photo, ...d.gallery.map((g: any) => g.photo)])
    const warnings: string[] = []
    for (const e of extras) if (!used.has(e.url)) { d.gallery.unshift({ photo: e.url, title: "", caption: e.caption || "" }); warnings.push("추가한 사진이 빠져 있어 사진 목록 맨 앞에 넣었습니다.") }
    if (inline.some((x) => !x)) warnings.push("일부 사진은 AI가 직접 보지 못했습니다. 사진 속 문구를 직접 확인하세요.")
    const source = JSON.stringify(info) + extras.map((e) => e.caption).join(" ")
    for (const mm of JSON.stringify(d).matchAll(/(\d+(?:\.\d+)?)\s*(?:brix|브릭스)/gi)) if (!source.includes(mm[1])) warnings.push(`메모에 없는 당도 ${mm[1]}가 있습니다. 확인하세요.`)
    if (d.proof?.value && !source.includes(String(d.proof.value))) { warnings.push(`근거 없는 측정값 ${d.proof.value}를 뺐습니다.`); d.proof = null }
    // 같은 사진 반복 금지
    const seen = new Set<string>([d.hero?.photo, d.proof?.photo, ...d.points.map((x: any) => x.photo)].filter(Boolean))
    d.gallery = d.gallery.filter((g: any) => (seen.has(g.photo) ? false : (seen.add(g.photo), true)))
    // 섹션별 연출 사진 생성 (자동 검수 통과분만)
    d.scenesOut = {}
    const wantScenes: any[] = (Array.isArray(d.scenes) ? d.scenes : []).filter((x: any) => x?.slot && x?.what).slice(0, 4)
    if (job.genImages === false) {}
    else if (!imageGenConfigured()) warnings.push("연출 사진을 만들려면 OpenAI 연결이 필요합니다. 지금은 실제 사진만 썼습니다.")
    else if (wantScenes.length) {
      const res = await makeShots(wantScenes.map((x) => ({ base: Number(x.base) || 1, what: String(x.what), why: String(x.slot) })), photos.map((p) => p.url), job.origin || "", 4)
      res.forEach((r, i) => {
        if (r.ok && r.url) d.scenesOut[wantScenes[i].slot] = r.url
        else warnings.push(`연출 사진(${wantScenes[i].slot})은 품질 검수에서 떨어져 넣지 않았습니다${r.error ? ` (${r.error})` : ""}.`)
      })
      if (Object.keys(d.scenesOut).length) warnings.push("AI 연출 사진에는 '연출 이미지' 표기가 들어갑니다. 네이버 신선식품에는 쓰지 마세요.")
    }
    delete d.scenes
    if (sortNotes.length) d.analysis = sortNotes.join("\n") + "\n" + (d.analysis || "")
    await store().setJSON(key, { running: false, at: now(), design: d, warnings: [...new Set(warnings)], proofFixes })
  } catch (e: any) {
    await store().setJSON(key, { running: false, at: now(), error: String(e?.message || e) })
  }
}

// 완성된 상세 이미지의 글자를 AI가 읽어서 오타·잘림·깨짐 검사
async function verifyImages(job: any) {
  const key = `verify-${job.sellerProductId}`
  await store().setJSON(key, { running: true, startedAt: now() })
  try {
    const urls: string[] = (job.urls || []).filter((u: string) => /^https:\/\/[^\s"'<>]+\/img\/[a-f0-9-]{36}\.jpg$/.test(u)).slice(0, 20)
    const client = new Anthropic()
    const results: any[] = []
    for (let i = 0; i < urls.length; i += 4) {
      const batch = urls.slice(i, i + 4)
      const content: any[] = [{ type: "text", text: "의도한 문구(정답):\n" + String(job.intended || "").slice(0, 6000) }]
      for (let k = 0; k < batch.length; k++) {
        const r = await fetch(batch[k])
        const b64 = Buffer.from(await r.arrayBuffer()).toString("base64")
        content.push({ type: "text", text: `이미지 ${i + k + 1}` }, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } })
      }
      content.push({ type: "text", text: "각 이미지의 글자를 한 글자씩 읽고 검사하세요." })
      const msg: any = await aiCreate(client, {
        model: process.env.AI_MODEL || "claude-sonnet-5-5",
        max_tokens: 3000,
        system: `당신은 한국어 상세페이지 최종 검수자입니다. 이미지에 보이는 모든 글자를 정확히 읽고 문제를 찾습니다.
검사: ① 맞춤법·띄어쓰기·오타 ② 의도한 문구와 다른 글자 ③ 글자가 잘림·겹침·화면 밖으로 넘침 ④ 깨진 글자(□, 이상한 기호) ⑤ 사진 속에 AI가 만든 뭉개진 글자·가짜 로고.
출력: JSON 배열 하나만. 이미지마다 {"image": 번호, "ok": true/false, "problems": ["무엇이 어떻게 잘못됐는지 → 올바른 표현"]}`,
        messages: [{ role: "user", content }],
      })
      const t = msg.content.map((b: any) => (b.type === "text" ? b.text : "")).join("")
      const mm = t.match(/\[[\s\S]*\]/)
      if (mm) results.push(...(await parseLoose(mm[0], client)))
    }
    await store().setJSON(key, { running: false, at: now(), results })
  } catch (e: any) {
    await store().setJSON(key, { running: false, at: now(), error: String(e?.message || e) })
  }
}

// ---------- 새 상품 등록: 기존 상품을 틀로 삼아 카테고리·옵션·고시정보·대표사진을 채워 임시저장 ----------
export async function createNew(job: any) {
  const key = `create-${job.jobId}`
  const log: string[] = []
  const save = (x: any) => store().setJSON(key, { at: now(), log, ...x })
  await save({ running: true })
  try {
    const name = String(job.name || "").trim(), opts: any[] = (job.options || []).filter((o: any) => o?.name && Number(o.price) >= 100)
    if (!name || !opts.length) throw new Error("상품명과 옵션(이름·판매가)을 입력하세요.")
    const tpl = job.tpl ? JSON.parse(JSON.stringify(job.tpl)) : await getProduct(String(job.templateId))
    log.push(`틀: ${tpl.sellerProductName}`); await save({ running: true })
    // 1) 카테고리
    let cat = String(job.categoryCode || "")
    if (!cat) {
      const pr = await predictCategory(`${name} ${opts[0].name}`, String(job.facts || ""))
      cat = String(pr?.predictedCategoryId || "")
      log.push(`카테고리 추천: ${pr?.predictedCategoryName || "-"} (${cat || "실패"})`)
      if (!cat) throw new Error("쿠팡 카테고리 추천에 실패했습니다.")
    }
    const meta = await categoryMeta(cat)
    const mand = (meta?.attributes || []).filter((a: any) => a.required === "MANDATORY")
    log.push(`필수 구매옵션: ${mand.map((a: any) => `${a.attributeTypeName}(${a.dataType}${a.basicUnit && a.basicUnit !== "없음" ? "," + a.basicUnit : ""}${a.groupNumber && a.groupNumber !== "NONE" ? ",그룹" + a.groupNumber : ""})`).join(", ") || "없음"}`)
    await save({ running: true })
    // 2) 구매옵션·고시정보를 AI가 카테고리 규격에 맞춰 채운다
    const client = new Anthropic()
    const tplNotices = (tpl.items?.[0]?.notices || []).map((n: any) => ({ noticeCategoryName: n.noticeCategoryName, noticeCategoryDetailName: n.noticeCategoryDetailName, content: n.content }))
    const mres: any = await aiCreate(client, {
      model: process.env.AI_MODEL || "claude-sonnet-5-5",
      max_tokens: opts.length > 12 ? 14000 : 6000,
      system: `쿠팡 상품 등록 데이터를 카테고리 규격에 맞게 채우는 담당자입니다. JSON 하나만 출력합니다.
- attributes: 옵션마다 카테고리 attributes 중 required=MANDATORY인 것은 반드시, EXPOSED(구매옵션)인 것은 옵션 차이를 나타내도록 채운다. dataType NUMBER는 숫자+usableUnits 중 단위(예: "5kg", "1개"). groupNumber가 같은 것은 하나만. 모르는 값은 지어내지 말고 그 속성을 빼되 MANDATORY는 상품명·옵션에서 알 수 있는 값으로 채운다.
- notices: noticeCategories 중 상품에 맞는 하나(농산물이면 농수축산물 계열)를 골라 모든 세부 항목을 채운다. 사실을 모르는 항목은 "상세페이지 참조". 원산지·생산자 등은 '사실'에 있는 것만 쓴다. 기존 상품 고시정보가 같은 분류면 형식을 참고한다.
출력: {"items":[{"name":옵션이름,"attributes":[{"attributeTypeName":"","attributeValueName":""}]}],"notices":[{"noticeCategoryName":"","noticeCategoryDetailName":"","content":""}],"generalProductName":"","productGroup":"","searchTags":["최대 20개"]}`,
      messages: [{ role: "user", content: JSON.stringify({ 상품명: name, 옵션: opts.map((o) => o.name), 사실: job.facts || "", 카테고리attributes: meta?.attributes || [], noticeCategories: meta?.noticeCategories || [], 기존상품고시정보: tplNotices }) }],
    })
    const mj = await parseLoose(mres.content.map((b: any) => (b.type === "text" ? b.text : "")).join(""), client)
    log.push(`구매옵션·고시정보 작성 완료`); await save({ running: true })
    // 3) 대표사진 (AI) — 실사진을 올렸으면 그걸 쓴다
    let mainUrl = String(job.mainImage || "")
    if (!mainUrl) {
      if (!imageGenConfigured()) throw new Error("대표사진이 없고 AI 사진 연결(OpenAI)도 없습니다. 대표사진을 올려 주세요.")
      log.push("AI 대표사진 만드는 중…"); await save({ running: true })
      const mi = await makeMainImage(String(job.photoPrompt || `${name}, fresh whole fruits`), job.origin || "")
      if (!mi.ok || !mi.url) throw new Error("AI 대표사진 실패: " + (mi.error || "") + " " + mi.tries.map((t: any) => `${t.score}점 ${t.reasons}`).join(" / "))
      mainUrl = mi.url
      log.push(`AI 대표사진 완성 (검수 ${mi.score}/10)`)
      await save({ running: true, mainUrl })
    }
    // 4) 틀 상품을 복사해 새 상품 데이터 만들기 (배송·반품·출고지는 틀 그대로)
    const body: any = JSON.parse(JSON.stringify(tpl))
    for (const k of ["sellerProductId", "productId", "statusName", "status", "mdId", "mdName", "createdAt", "updatedAt", "requestedAt", "approvedAt", "categoryId", "roleCode"]) delete body[k]
    body.displayCategoryCode = Number(cat)
    body.sellerProductName = name.slice(0, 100)
    body.displayProductName = String(job.displayName || name).slice(0, 100)
    body.generalProductName = String(mj.generalProductName || name).slice(0, 100)
    if (mj.productGroup) body.productGroup = String(mj.productGroup)
    if (job.outboundShippingPlaceCode) body.outboundShippingPlaceCode = String(job.outboundShippingPlaceCode)
    if (job.deliveryCompanyCode) body.deliveryCompanyCode = String(job.deliveryCompanyCode)
    else if (body.outboundShippingPlaceCode) { const dc = await outboundCourier(body.outboundShippingPlaceCode).catch(() => ""); if (dc) body.deliveryCompanyCode = dc }
    if (job.returnCenterCode) body.returnCenterCode = String(job.returnCenterCode)
    // 공급처가 제주·도서산간 배송을 안 하는 상품은 쿠팡에서도 도서산간 배송 불가로 등록 (주문이 들어오면 발주가 안 됨)
    if (job.noRemote) body.remoteAreaDeliverable = "N"
    if (!body.brand) body.brand = String(job.brand || "모아커머스")
    if (job.returnInfo?.address) {
      // 반품지 계약이 없을 때: 업체 주소로 반품 정보를 직접 넣는다
      body.returnCenterCode = "NO_RETURN_CENTERCODE"
      body.returnChargeName = String(job.returnInfo.name || "")
      body.companyContactNumber = String(job.returnInfo.phone || "")
      body.returnZipCode = String(job.returnInfo.zip || "")
      body.returnAddress = String(job.returnInfo.address || "")
      body.returnAddressDetail = String(job.returnInfo.detail || "-")
    }
    if (Number(job.returnCharge) > 0) body.returnCharge = Number(job.returnCharge)
    body.saleStartedAt = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 19)
    body.saleEndedAt = "2099-01-01T23:59:59"
    body.requested = !!job.requestApproval
    const base = JSON.parse(JSON.stringify(tpl.items?.[0] || {}))
    for (const k of ["sellerProductItemId", "vendorItemId", "itemId", "externalVendorSku", "barcode", "modelNo", "extraProperties", "autoPricingInfoView", "supplyPrice", "isAutoGenerated", "subRegistrationType", "sameDayShipping", "freePriceType", "saleAgentCommission", "marketPlaceItemData", "rocketGrowthItemData"]) delete base[k]
    const tags = (mj.searchTags || []).map(String).filter(Boolean).slice(0, 20)
    const detailHtml = `<div style="text-align:center"><img src="${mainUrl}" style="width:100%;max-width:780px"><p style="font-size:18px">${name.replace(/[<>&]/g, "")}</p></div>`
    body.items = opts.map((o) => {
      const it = JSON.parse(JSON.stringify(base))
      const am = (mj.items || []).find((x: any) => x.name === o.name) || {}
      it.itemName = String(o.name).slice(0, 150)
      it.originalPrice = Math.round(Number(o.price) / 10) * 10
      it.salePrice = it.originalPrice
      it.maximumBuyCount = Number(base.maximumBuyCount) || 999
      if (Number(job.shipDays) > 0) it.outboundShippingTimeDay = Number(job.shipDays)
      it.attributes = (am.attributes || []).filter((a: any) => a?.attributeTypeName && a?.attributeValueName).map((a: any) => ({ attributeTypeName: String(a.attributeTypeName), attributeValueName: String(a.attributeValueName) }))
      // 카테고리에 없는 속성·추측한 개당 중량은 버린다
      const metaBy = new Map((meta?.attributes || []).map((a: any) => [a.attributeTypeName, a]))
      const mandNames = new Set(mand.map((a: any) => a.attributeTypeName))
      // 필수 구매옵션은 아래에서 정해진 형식으로 다시 채우고, 그 밖의 구매옵션(EXPOSED)은 넣지 않는다(쿠팡 구매옵션 최대 3개)
      it.attributes = it.attributes.filter((a: any) => {
        const m: any = metaBy.get(a.attributeTypeName)
        if (!m || mandNames.has(a.attributeTypeName)) return false
        if (m.exposed === "EXPOSED") return false
        if (m.dataType === "NUMBER" && !/^\d+(\.\d+)?\D*$/.test(a.attributeValueName)) return false
        return true
      })
      // 필수 구매옵션이 빠졌으면 옵션 이름에서 채운다
      const has = new Set(it.attributes.map((a: any) => a.attributeTypeName))
      const groupsDone = new Set<string>()
      for (const a of mand) {
        if (a.groupNumber && a.groupNumber !== "NONE") {
          if (groupsDone.has(a.groupNumber) || it.attributes.some((x: any) => mand.find((m: any) => m.attributeTypeName === x.attributeTypeName && m.groupNumber === a.groupNumber))) { groupsDone.add(a.groupNumber); continue }
        }
        if (has.has(a.attributeTypeName)) continue
        const nm = String(o.name), t = String(a.attributeTypeName)
        let v = ""
        const kg = nm.match(/(\d+(?:\.\d+)?)\s*kg/i)
        const per = (job.perPieceGram || {})[nm]
        if (/개당/.test(t)) { if (per) v = `${per}g` }
        else if (/중량|무게/.test(t) && !kg && job.fullAttr) {
          // kg 표기가 없는 옵션("500g", "750g 2팩"): 글자형은 옵션 이름 그대로, 숫자형은 g 값
          const g = nm.match(/(\d+)\s*g(?!\w)/i)
          if (a.dataType === "STRING") v = nm.slice(0, 30)
          else if (g) v = a.basicUnit === "kg" ? `${Number(g[1]) / 1000}kg` : `${g[1]}g`
        }
        else if (/중량|무게/.test(t) && kg) {
          v = a.basicUnit === "g" ? `${Number(kg[1]) * 1000}g` : `${kg[1]}kg`
          // 글자형 중량은 등급을 붙여 옵션끼리 겹치지 않게 한다 (예: 5kg 특대)
          const gr = (nm.match(/특대|대과|중과|소과|로얄|프리미엄|가정용|못난이/) || [""])[0]
          if (a.dataType === "STRING" && job.fullAttr) v = nm.slice(0, 30) // 옵션 이름 전체를 써서 옵션끼리 겹치지 않게 (도매 상품은 등급 이름이 다양함)
          else if (a.dataType === "STRING" && gr) v = `${v} ${gr}`
        }
        else if (/수량/.test(t)) {
          // 옵션 이름에 입수가 있으면(곶감 20입, 30구) 그 개수를 쓴다. 없으면 1개 (모든 옵션이 1개면 '중복된 옵션값'으로 거절될 수 있음)
          const ip = job.fullAttr ? nm.replace(/\([^)]*\)/g, " ").match(/(\d+)\s*(?:입|구)(?![가-힣\w])/) : null
          v = `${ip ? ip[1] : 1}${a.basicUnit && a.basicUnit !== "없음" ? a.basicUnit : "개"}`
        }
        else if (/등급|크기|사이즈|과/.test(t)) v = (nm.match(/특대|대과|중과|소과|특|대|중|소/) || [""])[0]
        if (v) { it.attributes.push({ attributeTypeName: t, attributeValueName: v }); if (a.groupNumber && a.groupNumber !== "NONE") groupsDone.add(a.groupNumber) }
      }
      // 고시정보: 카테고리 메타에 있는 이름만 쓴다(AI 오타 방지)
      const ncs: any[] = meta?.noticeCategories || []
      const raw = (mj.notices || []).filter((n: any) => n?.noticeCategoryDetailName)
      const pickCat = ncs.find((c: any) => raw.some((n: any) => n.noticeCategoryName === c.noticeCategoryName)) || ncs.find((c: any) => /농수|농산/.test(c.noticeCategoryName)) || ncs[0]
      if (pickCat) {
        const dets: any[] = pickCat.noticeCategoryDetailNames || []
        it.notices = dets.map((d: any) => {
          const dn = String(d.noticeCategoryDetailName)
          const hit = raw.find((n: any) => String(n.noticeCategoryDetailName).replace(/\s/g, "") === dn.replace(/\s/g, ""))
          return { noticeCategoryName: String(pickCat.noticeCategoryName), noticeCategoryDetailName: dn, content: String(hit?.content || "상세페이지 참조").slice(0, 500) }
        })
      } else it.notices = raw.map((n: any) => ({ noticeCategoryName: String(n.noticeCategoryName), noticeCategoryDetailName: String(n.noticeCategoryDetailName), content: String(n.content || "상세페이지 참조") }))
      // 총 중량 속성이 카테고리에 있으면 옵션 이름의 kg으로 채운다
      for (const a of (meta?.attributes || [])) {
        const t = String(a.attributeTypeName)
        if (!/총\s*중량/.test(t) || it.attributes.some((x: any) => x.attributeTypeName === t)) continue
        const kg = String(o.name).match(/(\d+(?:\.\d+)?)\s*kg/i)
        if (kg) it.attributes.push({ attributeTypeName: t, attributeValueName: `${kg[1]}kg` })
      }
      const extra = (job.photos || []).filter((u: string) => /^https:\/\/[^\s"'<>]+$/.test(u)).slice(0, 9)
      it.images = [{ imageOrder: 0, imageType: "REPRESENTATION", vendorPath: mainUrl }, ...extra.map((u: string, i: number) => ({ imageOrder: i + 1, imageType: "DETAIL", vendorPath: u }))]
      const cimgs: string[] = (job.contentImages || []).filter((u: string) => /^https:\/\/[^\s"'<>]+$/.test(u))
      it.contents = cimgs.length ? cimgs.map((u: string) => ({ contentsType: "IMAGE_NO_SPACE", contentDetails: [{ content: u, detailType: "IMAGE" }] }))
        : extra.length
        ? [mainUrl, ...extra].map((u: string) => ({ contentsType: "IMAGE_NO_SPACE", contentDetails: [{ content: u, detailType: "IMAGE" }] }))
        : [{ contentsType: "HTML", contentDetails: [{ content: detailHtml, detailType: "TEXT" }] }]
      it.searchTags = tags
      return it
    })
    // B2B 업체 상품은 모아커머스 대신 업체에 정한 브랜드(없으면 '기타')
    if (job.vendorId) {
      const vv: any = await getStore({ name: "admin-vendors", consistency: "strong" }).get(String(job.vendorId), { type: "json" }).catch(() => null)
      if (vv?.kind === "B2B") { job.brand = vv.brandName || "GENERIC"; body.manufacture = vv.brandName || "상세페이지 참조" } // 쿠팡: 브랜드가 없는 상품은 GENERIC
    }
    body.brand = String(job.brand || "모아커머스")
    if (!body.manufacture) body.manufacture = body.brand
    // 구매옵션(EXPOSED)/검색옵션(NONE) 구분을 붙인다 — 없으면 쿠팡이 구매옵션으로 보지 않는다
    {
      const mandNames = new Set(mand.map((a: any) => a.attributeTypeName))
      const metaBy = new Map((meta?.attributes || []).map((a: any) => [a.attributeTypeName, a]))
      for (const it of body.items) it.attributes = it.attributes.map((a: any) => {
        const m: any = metaBy.get(a.attributeTypeName)
        return { ...a, exposed: mandNames.has(a.attributeTypeName) || m?.exposed === "EXPOSED" ? "EXPOSED" : "NONE" }
      })
    }
    for (const it of body.items) {
      // 같은 그룹(예: 개당 중량 / 개당 용량)은 하나만 있으면 된다
      const hasAttr = (n: string) => it.attributes.some((x: any) => x.attributeTypeName === n)
      const miss = mand.filter((a: any) => !hasAttr(a.attributeTypeName) && !(a.groupNumber && a.groupNumber !== "NONE" && mand.some((m: any) => m.groupNumber === a.groupNumber && hasAttr(m.attributeTypeName)))).map((a: any) => a.attributeTypeName)
      if (miss.length) throw new Error(`"${it.itemName}" 필수 정보가 없습니다: ${miss.join(", ")}. 업체에 확인해서 넣어 주세요.`)
    }
    log.push(`브랜드: ${body.brand} / 옵션1 속성: ${JSON.stringify(body.items[0]?.attributes || [])}`)
    { const d: any = JSON.parse(JSON.stringify(body.items[0] || {})); delete d.images; delete d.contents; delete d.notices; delete d.searchTags; log.push("구매옵션: " + body.items.map((it: any) => it.itemName + "=" + it.attributes.filter((a: any) => a.exposed === "EXPOSED").map((a: any) => a.attributeValueName).join("/")).join(" | ")) }
    log.push("쿠팡에 임시저장 요청 중…"); await save({ running: true })
    let r = await createProduct(body)
    // 등록 안 된 브랜드명은 쿠팡이 거절한다 → 브랜드 없음으로 다시, 그래도 안 되면 틀 상품의 브랜드로
    if (/브랜드 ID|brandId/.test(JSON.stringify(r || "")) && body.brand !== "GENERIC") {
      log.push(`브랜드 "${body.brand}" 거절 → 브랜드 없음(GENERIC)으로 다시 시도`)
      body.brand = "GENERIC"; delete body.brandId
      r = await createProduct(body)
    }
    const id = String(r?.data ?? "")
    if (!/^\d+$/.test(id)) throw new Error("쿠팡 등록 실패: " + JSON.stringify(r).slice(0, 400))
    log.push(`${job.requestApproval ? "등록·승인요청" : "임시저장"} 완료 — 등록상품ID ${id}`)
    await save({ running: false, ok: true, sellerProductId: id, mainUrl, category: cat })
  } catch (e: any) {
    log.push("실패: " + String(e?.message || e))
    await save({ running: false, ok: false, error: String(e?.message || e) })
  }
}

export default async (req: Request) => {
  const job = await req.json().catch(() => ({}))
  const tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!isLoggedIn(req) && !(tok && job.token === tok && job.type === "create")) return
  if (job.type === "refresh") await refreshProducts()
  if (job.type === "create" && job.jobId) await createNew({ ...job, origin: new URL(req.url).origin })
  if (job.type === "verify" && job.sellerProductId) await verifyImages(job)
  if (job.type === "design" && job.sellerProductId) await aiDesign({ ...job, origin: new URL(req.url).origin })
  if (job.type === "ai" && job.sellerProductId) await aiDetail({ ...job, origin: new URL(req.url).origin })
}
