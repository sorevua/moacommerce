// 임시: 네이버 상품 등록정보 검토 항목 수정(상품명·태그·속성·제조사) — 작업 후 삭제
import type { Config } from "@netlify/functions"
import { getStore } from "@netlify/blobs"
import { ncall } from "./_lib/naver.mts"

const NOS = ["13814609094", "13814609279", "13814619964", "13814620214"]
const st = () => getStore({ name: "admin-settings", consistency: "strong" })

export default async (req: Request) => {
  const u = new URL(req.url)
  const tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || u.searchParams.get("t") !== tok) return new Response("no", { status: 403 })
  const q = u.searchParams.get("q")
  let r: any
  try {
    if (q === "run") {
      await fetch(new URL("/.netlify/functions/onetime-nvfix-background", req.url), { method: "POST", body: JSON.stringify({ token: tok, mode: u.searchParams.get("mode") || "preview" }) })
      r = { started: true }
    } else if (q === "status") r = await st().get("nvfix", { type: "json" })
    else r = { error: "q?" }
  } catch (e: any) { r = { error: String(e?.message || e) } }
  const s = JSON.stringify(r)
  const off = Number(u.searchParams.get("o") || 0), len = Number(u.searchParams.get("n") || 8000)
  return new Response(s.slice(off, off + len) + `\n[len=${s.length}]`, { headers: { "content-type": "text/plain; charset=utf-8" } })
}
export const config: Config = { path: "/api/onetime-nvfix" }
export { NOS }
