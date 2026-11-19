// 2026-11-19 사장님 요청: 행운 상품 대표사진·상세페이지 일괄 교체
//  - 대표사진: 사장님이 준 사진에서 글자·인증마크가 없는 부분만 확대해 자른 사진 (fp/mNN.jpg)
//  - 상세페이지 맨 앞: 배송 지연 안내 이미지(fp/delay.jpg) → 상품 사진(인증마크 지운 것, fp/dNN.jpg) → 기존 상세
//  - 사진이 없는 상품도 배송 지연 안내 이미지는 맨 앞에 넣는다
//  - 햇양파 → 2026년 햇양파
// 쿠팡 호출이 Make 를 거치므로 Make 크레딧이 충분할 때만 돌린다. 이미 처리한 상품은 건너뛴다(다시 돌려도 안전).
import { getStore } from "@netlify/blobs"
import { isInternal } from "./_lib/auth.mts"
import { getProduct, call } from "./_lib/coupang.mts"

const BASE = "https://volqavo.com/fp/"
// 사진 번호 → 행운 상품ID (사진에 적힌 상품명으로 하나씩 대조함)
export const MAP: Record<string, string> = {
  "00": "01M1N0EG48A4PDM025B6A06J25", "01": "01M742X6F2APQQTQ67VNMJWN92", "02": "01KPS5TMSZFYASDTRPVRP2922H", "03": "01KXYCH2F6RAXP18KGKSSXVT43",
  "04": "01M3P47V9FQ4KS16EPE7S70EPG", "05": "01M6DQQ7V8C4X1XF9GCBW7875Z", "06": "01M77B0DFZ7XMYRXB859DZJM8B", "07": "01M1X8MHG8YZX1GXNYQM52ZGKN",
  "08": "01KQE5DEKM2NTCH511GJ3SJV86", "09": "01M740ZXR9QQXYM5KF42N4N081", "10": "01M77ADHNN03X5K8MR84MX9N99", "11": "01M5Y3KAG7WX1PRGV2MH9KFN5N",
  "12": "01M7464Z0FVXAZ9R2XG5294BKZ", "13": "01M746XQMMSJXAY0A5QW8EZ4BA", "14": "01KWKB39XS231P79CEP4WH18TC", "15": "01M7460DKPBBBQCEFGKA0XFVYH",
  "16": "01M7P9SMC8Y900D3FVG7GZMXGK", "17": "01M7478FSTJSRPW6C5MMG6B1K6", "18": "01KYKED40BKVBVEYP8XSSQWEY5", "19": "01KPYQ6V0VBSYJE8X6Z0R6PW32",
  "20": "01M1X4CK7AMGT8SAFJCVPZWQ71", "21": "01M5C5W23853GWBM1CEJZBEEM7", "22": "01KWKB3A0JHZ12BYSBS70M3FBV", "23": "01M1X9M730CQP9B70T24ECW8C8",
  "24": "01M5GQSRAJD76F7XDJ9MPKKRZ7", "25": "01KY8R80XSWB3MQZRZX25XQ0Z1", "26": "01M1X98D77FSE8SABXP2352WHJ", "27": "01M5K14KAKC7BKCJQ9QW76K9FH",
  "28": "01M6ZD51D367D7B1PTSGDTNBQH", "29": "01M79QFX8G3P3F60C8SYHGM91F", "30": "01M6N845R39NJNEBHGT847PZT3", "31": "01M36NNGW4AQC3CR126MACW11J",
  "32": "01M3VB0TYNHTXD5NWPNDVS1WYM", "33": "01M612VVVW9N5VZCDPAQ63WGZN", "34": "01KZTCN32HHT1FCYGJ8Q590R56", "35": "01M6FJ91KSFT1ZNGC1GBWKQWR8",
  "36": "01M611D7QCMR8GFPR07HHSD9X5", "37": "01KZ5H7SBVZBN6GHGXSNPPQ2MX", "38": "01KSKWQ0KMNZ563D8MM4RCV4A6", "39": "01M4AC739G9W0DY2TS4AHCJ6VZ",
  "40": "01M779NG3DF7AEED7ZF0WMV0WJ", "41": "01M36NF3BYSF1C1B8F8MRA8XG5", "42": "01M3VERZ5C6B52BQ5TZCSEXTCB", "43": "01M744FQ503131M9QXDSTQWKNC",
  "44": "01M33HT537Y82B5HF62ZYMBKC9", "45": "01M3XT862GQ8PE4HSEBJP8XTYS", "46": "01M1K62N9JG97F1VY30WPCS4FE", "47": "01KXFK2NFS54A0YX8K5PD91S8C",
  "48": "01M4WHTVTV6ACF2GAY21BGMNQA", "49": "01M610GHH4736MHHGWK94Y77PH", "50": "01M779TMK8KSEXNZACANA5581T", "51": "01M6JKDD72C28MA9D6CF6DP0AV",
  "52": "01M742KYXW0K1GSV3SE7KC3A3D", "53": "01KZAJT1N2CGN7010G3N8Q2RCE", "54": "01M4QT7ZGS4N9E1HF1Y1BK8G8Y", "55": "01M746BTDZP8YF5FMTJEB92M5W",
  "56": "01M2SR2MZB67Q98AXB4F2VHMH3", "57": "01M4WVPV2BCMA270YRQYFE51BZ", "58": "01KWJWM47RQ7585TKA7HM6W1Z1", "59": "01M742AM0A13PSS4TFMN76AF99",
}
const ONION = "01KY8R80XSWB3MQZRZX25XQ0Z1"
const img = (u: string) => ({ contentsType: "IMAGE_NO_SPACE", contentDetails: [{ content: u, detailType: "IMAGE" }] })

export default async (req: Request) => {
  if (!isInternal(req)) return
  const job: any = await req.json().catch(() => ({}))
  const st = getStore({ name: "admin-settings", consistency: "strong" })
  const reg: any = (await st.get("lucky-reg", { type: "json" })) || { done: {} }
  const prog: any = (await st.get("lucky-photos", { type: "json" })) || { done: {}, fail: {} }
  const byId: Record<string, string> = {}; for (const [n, id] of Object.entries(MAP)) byId[id] = n
  const limit = Number(job.limit || 200), started = Date.now()
  let n = 0
  for (const [id, d] of Object.entries<any>(reg.done || {})) {
    if (!d?.ok) continue
    const spids: string[] = (d.sellerProductIds?.length ? d.sellerProductIds : [d.sellerProductId]).filter(Boolean).map(String)
    for (const sp of spids) {
      const prev = prog.done[sp]
      if ((prev && !(job.redo && !prev.v2)) || n >= limit || Date.now() - started > 13 * 60e3) continue
      try {
        const p: any = await getProduct(sp)
        const num = byId[id]
        for (const it of p.items || []) {
          if (num) it.images = [{ imageOrder: 0, imageType: "REPRESENTATION", vendorPath: `${BASE}m${num}.jpg` }, ...(it.images || []).filter((x: any) => x.imageType !== "REPRESENTATION")]
          // 이미 한 번 넣은 상품이면 앞에 넣었던 이미지(쿠팡이 주소를 바꿔 저장함)를 개수만큼 빼고, 예전 글자 안내(lk-notice)는 지운다
          const added = prev ? (prev.num ? 2 : 1) : 0
          const old = (it.contents || []).slice(added).filter((c: any) => !(c.contentDetails || []).some((x: any) => /\/fp\/|lk-notice|평일 오전 8시/.test(String(x.content || ""))))
          it.contents = [img(`${BASE}delay.jpg`), ...(num ? [img(`${BASE}d${num}.jpg`)] : []), ...old]
        }
        if (id === ONION) for (const k of ["sellerProductName", "displayProductName"]) if (p[k] && !/2026/.test(p[k])) p[k] = String(p[k]).replace("햇양파", "2026년 햇양파").slice(0, 100)
        p.requested = true
        const r: any = await call("PUT", "/v2/providers/seller_api/apis/api/v1/marketplace/seller-products", "", p)
        if (r && r.code && !/SUCCESS|200/i.test(String(r.code))) throw new Error(JSON.stringify(r).slice(0, 160))
        prog.done[sp] = { id, num: num || "", v2: true, at: new Date().toISOString() }; delete prog.fail[sp]
      } catch (e: any) { prog.fail[sp] = String(e?.message || e).slice(0, 200) }
      n++; await st.setJSON("lucky-photos", prog)
    }
  }
  prog.finished = new Date().toISOString(); await st.setJSON("lucky-photos", prog)
}
