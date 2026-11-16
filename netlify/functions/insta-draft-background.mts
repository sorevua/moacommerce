// 인스타 게시물 초안 만들기 (매일 예약 + 관리자 버튼)
import { isLoggedIn, isInternal } from "./_lib/auth.mts"
import { makeDailyDraft } from "./_lib/insta.mts"
import { getStore } from "@netlify/blobs"
export default async (req: Request) => {
  if (!isLoggedIn(req) && !isInternal(req)) return
  const b: any = await req.json().catch(() => ({}))
  const P = getStore({ name: "admin-promo", consistency: "strong" })
  try { const r = await makeDailyDraft(!!b.force); await P.setJSON("ig-last", { at: new Date().toISOString(), ...r }) } catch (e: any) { console.error("insta draft", e); await P.setJSON("ig-last", { at: new Date().toISOString(), error: String(e?.message || e).slice(0, 300) }) }
}
