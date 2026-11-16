// 예약된 인스타그램 게시물 올리기 (시간이 걸려 백그라운드에서 실행)
import { isInternal } from "./_lib/auth.mts"
import { publishDue } from "./_lib/insta.mts"
export default async (req: Request) => {
  if (!isInternal(req)) return
  try { console.log("insta publish", await publishDue()) } catch (e) { console.error("insta publish", e) }
}
