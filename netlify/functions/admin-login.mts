import type { Config } from "@netlify/functions"
import { passwordMatches, sessionCookie, clearCookie } from "./_lib/auth.mts"

export default async (req: Request) => {
  const url = new URL(req.url)
  if (url.pathname.endsWith("/logout")) {
    return Response.json({ ok: true }, { headers: { "set-cookie": clearCookie() } })
  }
  let body: { password?: string } = {}
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 })
  }
  const result = passwordMatches(String(body.password || ""))
  if (result === "unset") {
    return Response.json(
      { error: "관리자 비밀번호가 아직 설정되지 않았습니다. Netlify 환경변수 ADMIN_PASSWORD를 설정한 뒤 다시 배포해 주세요." },
      { status: 503 },
    )
  }
  if (result === "wrong") {
    return Response.json({ error: "비밀번호가 맞지 않습니다." }, { status: 401 })
  }
  return Response.json({ ok: true }, { headers: { "set-cookie": sessionCookie() } })
}

export const config: Config = {
  path: ["/api/login", "/api/logout"],
  method: "POST",
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ["ip", "domain"] },
}
