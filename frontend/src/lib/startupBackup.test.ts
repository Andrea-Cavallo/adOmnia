import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('@/wailsjs/go/main/App', () => ({ StoragePut: vi.fn() }))
vi.mock('./safeLocalStorage', () => ({ safeSetItem: vi.fn() }))
import { StoragePut } from '@/wailsjs/go/main/App'
import { safeSetItem } from './safeLocalStorage'
import { persistStartupBackup } from './startupBackup'
beforeEach(() => { vi.resetAllMocks() })
it('writes a single snapshot to backend without duplicating renderer storage', async () => {
  vi.mocked(StoragePut).mockResolvedValue(undefined)
  const toJSON = vi.fn(() => ({ version: '1.0', collections: [] }))
  await persistStartupBackup({ toJSON })
  expect(toJSON).toHaveBeenCalledTimes(1)
  expect(StoragePut).toHaveBeenCalledWith('workspace', 'backup', '{"version":"1.0","collections":[]}')
  expect(safeSetItem).not.toHaveBeenCalled()
})
it('retains the legacy browser fallback if backend is unavailable', async () => {
  vi.mocked(StoragePut).mockRejectedValue(new Error('offline'))
  await persistStartupBackup({ collections: [] })
  expect(safeSetItem).toHaveBeenCalledWith('adomnia.workspace.backup', '{"collections":[]}')
})
it('does not interrupt startup on serialization failure', async () => {
  await expect(persistStartupBackup({ toJSON() { throw new Error('bad snapshot') } })).resolves.toBeUndefined()
  expect(StoragePut).not.toHaveBeenCalled()
})
