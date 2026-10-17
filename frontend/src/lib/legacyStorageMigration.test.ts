import { expect, it } from 'vitest'

function fakeStorage(initial: Record<string, string>) {
  const map = new Map(Object.entries(initial))
  return {
    get length() { return map.size },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v) },
    map,
  }
}

it('copies adomnia.goide.* to adomnia.codestudio.* without overwriting and keeps the old keys', async () => {
  const { migrateLegacyStorageKeys } = await import('./legacyStorageMigration')
  const storage = fakeStorage({
    'adomnia.goide.layout.v1': 'old-layout',
    'adomnia.goide.terminals:/p': 'old-terms',
    'adomnia.codestudio.terminals:/p': 'new-terms',
    'adomnia.settings': 'keep',
  })
  expect(migrateLegacyStorageKeys(storage)).toBe(1)
  expect(storage.map.get('adomnia.codestudio.layout.v1')).toBe('old-layout')
  expect(storage.map.get('adomnia.codestudio.terminals:/p')).toBe('new-terms')
  expect(storage.map.get('adomnia.goide.layout.v1')).toBe('old-layout')
  expect(migrateLegacyStorageKeys(storage)).toBe(0)
})
