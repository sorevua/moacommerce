import type { Config } from "@netlify/functions"
import { internalKey } from "./_lib/auth.mts"
// 하루 1번(한국시간 밤 12시) 행운프레시 품절·시즌 종료·사라진 상품을 확인해 쿠팡 판매를 자동으로 멈추고 되살린다 (삭제는 하지 않음)
// 사장님 요청: 2026-11-20 00:00(한국시간)부터 시작
export default async () => {
  if (Date.now() < Date.parse("2026-11-19T14:59:00Z")) return
  const base = Netlify.env.get("URL") || "https://volqavo.com"
  await fetch(base + "/.netlify/functions/lucky-watch-background", { method: "POST", headers: { "x-internal": internalKey() }, body: "{}" })
}
export const config: Config = { schedule: "0 15 * * *" }
