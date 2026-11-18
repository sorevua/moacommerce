// 2026-11-18 첫 실주문에서 발견: 설치된 @netlify/blobs 는 setJSON(..., { onlyIfNew }) 결과를 돌려주지 않아
//   `const { modified } = await setJSON(...)` 가 "Cannot destructure property 'modified'" 로 멈췄다 (주문이 관리자에 안 들어옴).
//   또 onlyIfNew 를 무시하는 버전이면 이미 처리 중인 주문을 '접수'로 덮어쓸 위험이 있다.
// → 먼저 있는지 확인하고, 없을 때만 저장한다. 라이브러리가 결과를 돌려주면 그 값을 따른다.
export async function putIfNew(store: any, key: string, value: unknown): Promise<boolean> {
  const exists = await store.getMetadata(key).catch(() => null)
  if (exists) return false
  const r: any = await store.setJSON(key, value, { onlyIfNew: true })
  if (r && typeof r === "object" && "modified" in r) return !!r.modified
  return true
}
