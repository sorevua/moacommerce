// 홍보용 짧은 주소: /talk → 카카오 오픈채팅, /band → 밴드 (주소는 관리자 [홍보] 설정에 넣어 둔 값)
import type { Config } from "@netlify/functions"
import { getStore } from "@netlify/blobs"
export default async (req: Request) => {
  const u = new URL(req.url), key = u.pathname.replace(/\/+$/, "").split("/").pop() === "band" ? "band" : "openchat"
  const s: any = (await getStore({ name: "admin-promo", consistency: "strong" }).get("settings", { type: "json" })) || {}
  const to = String(s[key] || (key === "openchat" ? s.kakao : "") || "")
  return /^https:\/\//.test(to) ? Response.redirect(to, 302) : Response.redirect(u.origin + "/", 302)
}
export const config: Config = { path: ["/talk", "/band"] }
