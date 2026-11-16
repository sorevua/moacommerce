import { createHmac, createHash, timingSafeEqual } from "node:crypto"

const COOKIE = "moa_admin"
const SESSION_HOURS = 12

function secret(): string | undefined {
  return Netlify.env.get("ADMIN_SESSION_SECRET") || undefined
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url")
}

export function passwordMatches(input: string): "ok" | "wrong" | "unset" {
  const real = Netlify.env.get("ADMIN_PASSWORD")
  if (!real || !secret()) return "unset"
  const a = createHash("sha256").update(input).digest()
  const b = createHash("sha256").update(real).digest()
  return timingSafeEqual(a, b) ? "ok" : "wrong"
}

export function sessionCookie(): string {
  const key = secret()!
  const exp = Date.now() + SESSION_HOURS * 3600 * 1000
  const payload = String(exp)
  const token = `${payload}.${sign(payload, key)}`
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}`
}

export function clearCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
}

export function isLoggedIn(req: Request): boolean {
  const key = secret()
  if (!key) return false
  const raw = req.headers.get("cookie") || ""
  const m = raw.split(/;\s*/).find((c) => c.startsWith(COOKIE + "="))
  if (!m) return false
  const token = m.slice(COOKIE.length + 1)
  const [payload, sig] = token.split(".")
  if (!payload || !sig) return false
  const expected = sign(payload, key)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false
  return Number(payload) > Date.now()
}

// 서버 안에서만 쓰는 호출(예약 작업 → 백그라운드 작업) 확인용
export function internalKey(): string {
  const key = secret()
  return key ? sign("internal-job", key) : ""
}
export function isInternal(req: Request): boolean {
  const k = internalKey()
  return !!k && req.headers.get("x-internal") === k
}
