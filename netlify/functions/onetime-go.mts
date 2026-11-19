// 임시: 대표사진 AI 교체 작업용. 작업이 끝나면 지운다.
import { getStore } from "@netlify/blobs"
import { internalKey } from "./_lib/auth.mts"
import { eligible } from "./lucky-mainimg-background.mts"

export default async (req: Request) => {
  const u = new URL(req.url)
  const t = u.searchParams.get("t") || "", tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || t !== tok) return new Response("no", { status: 404 })
  const settings = getStore({ name: "admin-settings", consistency: "strong" })
  const a = u.searchParams.get("a") || ""
  if (a === "img") {
    const ids = (u.searchParams.get("ids") || "").split(",").filter(Boolean)
    const body = { mode: u.searchParams.get("mode") || "gen", limit: Number(u.searchParams.get("limit") || 5), ids, redo: u.searchParams.get("redo") === "1" }
    const r = await fetch(u.origin + "/.netlify/functions/lucky-mainimg-background", { method: "POST", headers: { "x-internal": internalKey(), "content-type": "application/json" }, body: JSON.stringify(body) })
    return Response.json({ started: r.status })
  }
  const reg: any = (await settings.get("lucky-reg", { type: "json" })) || { done: {} }
  const st: any = (await settings.get("lucky-mainimg", { type: "json" })) || { items: {} }
  const targets = Object.entries(reg.done || {}).filter(([, d]: any) => d.ok && eligible(String(d.name || ""))).map(([id, d]: any) => ({ id, name: d.name }))
  return new Response(JSON.stringify({ running: !!st.running, at: st.at, targets: targets.length, list: targets.map((x) => ({ ...x, ...(st.items[x.id] || {}) })) }, null, 1), { headers: { "content-type": "application/json; charset=utf-8" } })
}
