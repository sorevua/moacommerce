// 홍보: 채널 주소 저장, 홍보 방법별 진행 상태, AI가 쓴 글 목록
import type { Config } from "@netlify/functions"
import { getStore } from "@netlify/blobs"
import { randomUUID } from "node:crypto"
import { isLoggedIn } from "./_lib/auth.mts"

const st = () => getStore({ name: "admin-promo", consistency: "strong" })
const json = (d: unknown, status = 200) => Response.json(d, { status })
const now = () => new Date().toISOString()

export const CHANNELS = ["naver_blog", "instagram", "threads", "karrot", "band", "openchat"]

export default async (req: Request) => {
  if (!isLoggedIn(req)) return json({ error: "로그인이 필요합니다." }, 401)
  const parts = new URL(req.url).pathname.replace(/^\/api\/promo\/?/, "").split("/").filter(Boolean)
  const [res, id] = parts
  const m = req.method
  try {
    if (res === "settings") {
      if (m === "GET") return json((await st().get("settings", { type: "json" })) || {})
      if (m === "PUT") {
        const b: any = await req.json()
        const clean = (v: any) => String(v || "").trim().slice(0, 300)
        const ok = (u: string) => !u || /^https:\/\/[^\s"'<>]+$/.test(u)
        const v = { openchat: clean(b.openchat), kakao: clean(b.kakao), instagram: clean(b.instagram), blog: clean(b.blog), band: clean(b.band), brand: clean(b.brand) || "모아커머스", voice: String(b.voice || "").trim().slice(0, 3000) }
        for (const k of ["openchat", "kakao", "instagram", "blog", "band"] as const) if (!ok(v[k])) return json({ error: `${k} 주소는 https:// 로 시작해야 합니다.` }, 400)
        await st().setJSON("settings", v)
        return json(v)
      }
    }
    if (res === "status") {
      if (m === "GET") return json((await st().get("status", { type: "json" })) || {})
      if (m === "PUT") {
        const b: any = await req.json()
        const cur: any = (await st().get("status", { type: "json" })) || {}
        if (!CHANNELS.includes(b.channel)) return json({ error: "알 수 없는 채널" }, 400)
        cur[b.channel] = { on: !!b.on, since: b.on ? cur[b.channel]?.since || now() : null }
        await st().setJSON("status", cur)
        return json(cur)
      }
    }
    if (res === "posts") {
      const list: any[] = ((await st().get("posts", { type: "json" })) as any[]) || []
      if (m === "GET" && !id) return json(list)
      if (m === "PUT" && id) {
        const b: any = await req.json()
        const p = list.find((x) => x.id === id)
        if (!p) return json({ error: "없는 글" }, 404)
        if (b.posted !== undefined) p.postedAt = b.posted ? now() : null
        if (b.hold !== undefined) { p.hold = !!b.hold; if (!b.hold) p.failed = "" }
        if (b.url !== undefined) p.url = String(b.url).slice(0, 300)
        if (b.title !== undefined) p.title = String(b.title).slice(0, 200)
        if (b.body !== undefined) p.body = String(b.body).slice(0, 20000)
        await st().setJSON("posts", list)
        return json(p)
      }
      if (m === "DELETE" && id) {
        await st().setJSON("posts", list.filter((x) => x.id !== id))
        return json({ ok: true })
      }
    }
    if (res === "ig") {
      const { igConfig } = await import("./_lib/insta.mts")
      if (m === "GET") return json(await igConfig())
      if (m === "PUT") {
        const b: any = await req.json(), cur: any = await igConfig()
        const v = { daily: b.daily === undefined ? cur.daily : !!b.daily, autoPublish: b.autoPublish === undefined ? cur.autoPublish : !!b.autoPublish, hour: Math.min(23, Math.max(6, Number(b.hour ?? cur.hour))) }
        await st().setJSON("ig-config", v)
        return json(await igConfig())
      }
    }
    if (res === "job" && id && m === "GET") return json((await st().get(`job-${id}`, { type: "json" })) || {})
    if (res === "newjob" && m === "POST") return json({ id: randomUUID() })
    return json({ error: "없는 주소" }, 404)
  } catch (e: any) {
    return json({ error: String(e?.message || e) }, 500)
  }
}

export const config: Config = { path: "/api/promo/*" }
