// AI 호출: 사용량 제한(429)·일시 과부하(529/503)에 걸리면 기다렸다가 다시 시도한다
export async function aiCreate(client: any, params: any): Promise<any> {
  const waits = [20000, 40000, 65000, 65000]
  for (let i = 0; ; i++) {
    try {
      return await client.messages.create(params)
    } catch (e: any) {
      const st = Number(e?.status || 0)
      if (![429, 503, 529].includes(st) || i >= waits.length) {
        if (st === 429) throw new Error("AI 사용량 제한에 걸렸습니다. 2~3분 뒤에 다시 눌러 주세요.")
        throw e
      }
      await new Promise((r) => setTimeout(r, waits[i]))
    }
  }
}
