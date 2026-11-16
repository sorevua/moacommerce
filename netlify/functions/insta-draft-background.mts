// 인스타 게시물 초안 만들기 (매일 예약 + 관리자 버튼)
import { isLoggedIn, isInternal } from "./_lib/auth.mts"
import { makeDailyDraft } from "./_lib/insta.mts"
import { getStore } from "@netlify/blobs"
export default async (req: Request) => {
  if (!isLoggedIn(req) && !isInternal(req)) return
  const b: any = await req.json().catch(() => ({}))
  const P = getStore({ name: "admin-promo", consistency: "strong" })
  // 블로그 글: 월·수·금(한국시간)에 자동으로, 또는 버튼으로
  const dow = new Date(Date.now() + 9 * 3600e3).getUTCDay()
  if (b.blog || (!b.force && [1, 3, 5].includes(dow))) { try { await P.setJSON("blog-last", { at: new Date().toISOString(), ...(await makeDailyDraft(!!b.blog, "naver_blog")) }) } catch (e: any) { await P.setJSON("blog-last", { at: new Date().toISOString(), error: String(e?.message || e).slice(0, 300) }) } if (b.blog) return }
  try { const r = await makeDailyDraft(!!b.force); await P.setJSON("ig-last", { at: new Date().toISOString(), ...r }) } catch (e: any) { console.error("insta draft", e); await P.setJSON("ig-last", { at: new Date().toISOString(), error: String(e?.message || e).slice(0, 300) }) }
}
