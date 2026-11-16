// 고객 문의 수집 + AI 답변 초안 (예약 작업이나 관리자 버튼이 부른다)
import { isLoggedIn, isInternal } from "./_lib/auth.mts"
import { syncInquiries } from "./_lib/inquiries.mts"
export default async (req: Request) => {
  if (!isLoggedIn(req) && !isInternal(req)) return
  try { console.log("inquiry sync", await syncInquiries()) } catch (e) { console.error("inquiry sync", e) }
}
