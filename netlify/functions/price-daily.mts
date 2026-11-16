import type { Config } from "@netlify/functions"
import { internalKey } from "./_lib/auth.mts"
// 매일 새벽 5시 37분(한국시간)에 가격 조사·자동 조정을 시작한다
export default async () => {
  const base = Netlify.env.get("URL") || "https://volqavo.com"
  await fetch(base + "/.netlify/functions/price-run-background", { method: "POST", headers: { "x-internal": internalKey() }, body: "{}" })
}
export const config: Config = { schedule: "37 20 * * *" }
