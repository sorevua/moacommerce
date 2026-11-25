import type { Config } from "@netlify/functions"
import { internalKey } from "./_lib/auth.mts"
// 매일 오전 9시 7분(한국시간)에 오늘의 인스타 게시물 초안을 만든다
export default async () => {
  const base = Netlify.env.get("URL") || "https://volqavo.com"
  await fetch(base + "/.netlify/functions/insta-draft-background", { method: "POST", headers: { "x-internal": internalKey() }, body: "{}" })
}
// 2026-11-25 오너 요청으로 자동 실행 중지(넷리파이 크레딧 절약). 다시 켜려면 아래 주석을 푼다.
// export const config: Config = { schedule: "7 0 * * *" }
