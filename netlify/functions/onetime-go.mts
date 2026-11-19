// 임시: 곶감 선물세트 옵션 이름 정리(호·입수 구분) + 상태 확인. 작업이 끝나면 지운다.
import { getStore } from "@netlify/blobs"
import { getProduct, call } from "./_lib/coupang.mts"
const SP = ["16463593433", "16463587697", "16463594245"]
const ID = "01M0H8HT0TF3A7HFB56Q9GFRVY"
export function rename(n: string) {
  const ho = (n.match(/\[(\d+)호\]/) || [])[1]
  if (!ho) return null
  let m = n.match(/반건시 (소|중|대) (\d+)입( 1\+1)?/)
  const r = n.match(/(\d+)g~(\d+)g/)
  if (m && r && !/대봉/.test(n)) {
    const two = !!m[3], cnt = Number(m[2])
    return { name: `${ho}호 반건시 ${m[1]} ${cnt}입${two ? " 1+1 (2상자)" : ""} (개당 ${r[1]}~${r[2]}g)`, weight: `개당 ${r[1]}~${r[2]}g ${cnt}입${two ? " 2상자" : ""}`, qty: two ? cnt * 2 : cnt }
  }
  m = n.match(/호두말이 (\d+)입/)
  const tw = n.match(/총중량 (\d+)g/)
  if (m && tw) return { name: `${ho}호 호두말이 ${m[1]}입 (총 ${tw[1]}g 내외)`, weight: `총 ${tw[1]}g`, qty: Number(m[1]) }
  m = n.match(/대봉곶감 반건시 (\d+)입/)
  const pw = n.match(/개당 (\d+)g/)
  if (m && pw) return { name: `${ho}호 대봉곶감 반건시 ${m[1]}입 (개당 ${pw[1]}g 내외)`, weight: `개당 ${pw[1]}g ${m[1]}입`, qty: Number(m[1]) }
  return null
}
export default async (req: Request) => {
  const u = new URL(req.url)
  const t = u.searchParams.get("t") || "", tok = Netlify.env.get("ONETIME_TOKEN") || ""
  if (!tok || t !== tok) return new Response("no", { status: 404 })
  const out: any[] = []
  const fix = u.searchParams.get("a") === "fix"
  const settings = getStore({ name: "admin-settings", consistency: "strong" })
  const map: Record<string, string> = {}
  for (const sp of SP) {
    try {
      const p: any = await getProduct(sp)
      const rows: any[] = []
      for (const it of p.items || []) {
        const rn = rename(String(it.itemName))
        rows.push({ from: it.itemName, to: rn?.name || "(그대로)" })
        if (!rn) continue
        map[String(it.itemName)] = rn.name
        if (fix) {
          it.itemName = rn.name
          for (const a of it.attributes || []) {
            if (a.attributeTypeName === "농산물 중량" && a.attributeValueName) a.attributeValueName = rn.weight
            if (a.attributeTypeName === "수량" && a.attributeValueName) a.attributeValueName = `${rn.qty}개`
          }
        }
      }
      let res = ""
      if (fix) { p.requested = true; const r: any = await call("PUT", "/v2/providers/seller_api/apis/api/v1/marketplace/seller-products", "", p); res = String(r?.code || r?.message || "").slice(0, 160) }
      out.push({ sp, status: p.statusName, res, rows })
    } catch (e: any) { out.push({ sp, err: String(e?.message || e).slice(0, 300) }) }
  }
  if (fix) {
    // 옵션 연결(행운 옵션 ↔ 쿠팡 옵션)이 새 이름으로 맞춰지도록 등록 기록도 바꾼다
    const st: any = await settings.get("lucky-reg", { type: "json" })
    const d = st?.done?.[ID]
    if (d?.options) { for (const o of d.options) if (map[o.name]) o.name = map[o.name]; d.linked = false; delete d.linkError; await settings.setJSON("lucky-reg", st) }
  }
  return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json; charset=utf-8" } })
}
