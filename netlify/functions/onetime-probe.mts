// 임시 확인용 (확인 후 삭제)
import { outboundPlaces, returnCenters } from "./_lib/coupang.mts"
export default async (req: Request) => {
  const u = new URL(req.url), t = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!t || u.searchParams.get("t") !== t) return new Response("no", { status: 404 })
  const out: any = {}
  try { out.outbound = (await outboundPlaces()).map((p: any) => ({ code: p.outboundShippingPlaceCode, name: p.shippingPlaceName, usable: p.usable, addr: (p.placeAddresses || []).map((a: any) => `${a.addressType}:${a.returnAddress} ${a.returnAddressDetail}`), remote: (p.remoteInfos || []).map((r: any) => `${r.deliveryCode}/${r.jeju}/${r.notJeju}/${r.usable}`) })) } catch (e: any) { out.outboundError = e.message }
  try { out.returns = (await returnCenters()).map((p: any) => ({ code: p.returnCenterCode, name: p.shippingPlaceName, usable: p.usable, addr: (p.placeAddresses || []).map((a: any) => `${a.returnAddress} ${a.returnAddressDetail}`), courier: p.deliverCode, fee: [p.returnFee05kg, p.returnFee10kg, p.returnFee20kg] })) } catch (e: any) { out.returnsError = e.message }
  try {
    const id = "1lTnDnT0iBPTUQSlwVfIYl0z4o9N_xHP-"
    const r = await fetch(`https://drive.google.com/embeddedfolderview?id=${id}#list`, { headers: { "accept-language": "ko" } })
    const html = await r.text()
    const files = [...html.matchAll(/\/file\/d\/([\w-]+)\/[^"]*"[\s\S]*?flip-entry-title">([^<]+)</g)].map((m) => ({ id: m[1], name: m[2] }))
    out.drive = { status: r.status, len: html.length, files }
    out.sizes = []
    for (const f of files.slice(0, 4)) {
      for (const url of [`https://lh3.googleusercontent.com/d/${f.id}=w860`, `https://lh3.googleusercontent.com/d/${f.id}=s0`]) {
        const h = await fetch(url); const b = await h.arrayBuffer()
        out.sizes.push({ name: f.name, url: url.slice(-6), status: h.status, type: h.headers.get("content-type"), bytes: b.byteLength })
      }
    }
  } catch (e: any) { out.driveError = e.message }
  return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json; charset=utf-8" } })
}
