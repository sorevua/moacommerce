import type { Config } from "@netlify/functions"
import { internalKey } from "./_lib/auth.mts"
// 하루 2번(한국시간 05:50, 13:50) 행운프레시 품절·시즌 종료를 확인해 쿠팡 판매를 자동으로 멈추고 되살린다
export default async () => {
  const base = Netlify.env.get("URL") || "https://volqavo.com"
  await fetch(base + "/.netlify/functions/lucky-watch-background", { method: "POST", headers: { "x-internal": internalKey() }, body: "{}" })
}
export const config: Config = { schedule: "50 4,20 * * *" }
