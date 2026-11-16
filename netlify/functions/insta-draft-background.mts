// 인스타 게시물 초안 만들기 (매일 예약 + 관리자 버튼)
import { isLoggedIn, isInternal } from "./_lib/auth.mts"
import { makeDailyDraft } from "./_lib/insta.mts"
export default async (req: Request) => {
  if (!isLoggedIn(req) && !isInternal(req)) return
  const b: any = await req.json().catch(() => ({}))
  try { console.log("insta draft", await makeDailyDraft(!!b.force)) } catch (e) { console.error("insta draft", e) }
}
