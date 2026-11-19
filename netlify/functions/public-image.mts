// 상세페이지용 공개 이미지 (쿠팡 상세페이지에서 불러감)
import type { Config } from "@netlify/functions"
import { getStore } from "@netlify/blobs"

export default async (req: Request) => {
  const key = new URL(req.url).pathname.split("/").pop() || ""
  if (!/^([a-f0-9-]{36}|lk-[A-Za-z0-9]{20,32}(?:-\d{1,2})?-(main|d\d))\.jpg$/.test(key)) return new Response("Not found", { status: 404 })
  const entry = await getStore({ name: "public-images", consistency: "strong" }).getWithMetadata(key, { type: "arrayBuffer" })
  if (!entry) return new Response("Not found", { status: 404 })
  return new Response(entry.data as ArrayBuffer, {
    headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=31536000, immutable" },
  })
}

export const config: Config = { path: "/img/:key" }
