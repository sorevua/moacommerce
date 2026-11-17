// 홍보 게시물 1건을 인스타그램에 올린다 (내부 호출 전용). 같은 key 는 한 번만 올린다.
import { getStore } from "@netlify/blobs"
import { isInternal } from "./_lib/auth.mts"
export default async (req: Request) => {
  if (!isInternal(req)) return
  const job = await req.json().catch(() => ({}))
  const s = getStore({ name: "admin-promo", consistency: "strong" }), k = "manual-post-" + String(job.key || "")
  const cur: any = await s.get(k, { type: "json" })
  if (!job.key || cur) return // 이미 올렸거나 올리는 중
  await s.setJSON(k, { state: "posting", at: new Date().toISOString() })
  try {
    const r = await fetch(Netlify.env.get("MAKE_IG_URL") || "", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: Netlify.env.get("MAKE_RELAY_TOKEN") || "", files: (job.files || []).map((u: string) => ({ media_type: "IMAGE", image_url: u })), caption: String(job.caption || "").slice(0, 2150) }) })
    const t = await r.text()
    const ok = r.ok && !(/error|fail/i.test(t.slice(0, 200)) && !/"id"/.test(t))
    await s.setJSON(k, { state: ok ? "posted" : "failed", status: r.status, result: t.slice(0, 300), at: new Date().toISOString() })
  } catch (e: any) { await s.setJSON(k, { state: "unknown", error: String(e?.message || e).slice(0, 200), at: new Date().toISOString() }) }
}
