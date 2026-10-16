import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('@/wailsjs/go/main/App', () => ({ StorageGet: vi.fn(), StoragePut: vi.fn() }))
vi.mock('./safeLocalStorage', () => ({ safeSetItem: vi.fn() }))
import { StorageGet, StoragePut } from '@/wailsjs/go/main/App'
import { safeSetItem } from './safeLocalStorage'
import {
  buildStartupBackupSnapshot,
  parseStartupBackup,
  persistStartupBackup,
  readStartupBackup,
  STARTUP_BACKUP_LOCAL_KEY,
  type StartupBackupSnapshot,
} from './startupBackup'
const values = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  clear: () => values.clear(),
})
beforeEach(() => {
  vi.resetAllMocks()
  values.clear()
})
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
it('builds a versioned snapshot with capture timestamp and active environment', () => {
  const snapshot = buildStartupBackupSnapshot({ collections: [], environments: [], activeEnvId: 'env-1' })
  expect(snapshot.format).toBe('adomnia-workspace-backup')
  expect(snapshot.version).toBe('1.0')
  expect(Number.isNaN(Date.parse(snapshot.backedUpAt))).toBe(false)
  expect(snapshot.activeEnvId).toBe('env-1')
})
it('parses legacy 1.0 snapshots captured without activeEnvId', () => {
  const parsed = parseStartupBackup(JSON.stringify({
    format: 'adomnia-workspace-backup',
    version: '1.0',
    backedUpAt: '2026-10-15T00:00:00.000Z',
    collections: [],
    environments: [],
  }))
  expect(parsed).not.toBeNull()
  expect(parsed?.activeEnvId).toBeNull()
})
it('rejects malformed, foreign or future-versioned payloads', () => {
  expect(parseStartupBackup(null)).toBeNull()
  expect(parseStartupBackup('not json')).toBeNull()
  expect(parseStartupBackup(JSON.stringify({ format: 'other', version: '1.0', collections: [], environments: [] }))).toBeNull()
  expect(parseStartupBackup(JSON.stringify({ format: 'adomnia-workspace-backup', version: '2.0', collections: [], environments: [] }))).toBeNull()
  expect(parseStartupBackup(JSON.stringify({ format: 'adomnia-workspace-backup', version: '1.0' }))).toBeNull()
})
it('reads the backend snapshot before the browser fallback', async () => {
  const backend = buildStartupBackupSnapshot({ collections: [], environments: [], activeEnvId: 'from-backend' })
  const legacy = buildStartupBackupSnapshot({ collections: [], environments: [], activeEnvId: 'from-legacy' })
  vi.mocked(StorageGet).mockResolvedValue(JSON.stringify(backend))
  localStorage.setItem(STARTUP_BACKUP_LOCAL_KEY, JSON.stringify(legacy))
  const read = await readStartupBackup()
  expect(read?.activeEnvId).toBe('from-backend')
})
it('falls back to the legacy browser key when the backend has no snapshot', async () => {
  vi.mocked(StorageGet).mockResolvedValue('')
  const legacy = buildStartupBackupSnapshot({ collections: [], environments: [] })
  localStorage.setItem(STARTUP_BACKUP_LOCAL_KEY, JSON.stringify(legacy))
  const read = await readStartupBackup()
  expect(read?.version).toBe('1.0')
})
it('returns null when no valid snapshot exists anywhere', async () => {
  vi.mocked(StorageGet).mockRejectedValue(new Error('offline'))
  localStorage.setItem(STARTUP_BACKUP_LOCAL_KEY, 'garbage')
  const read: StartupBackupSnapshot | null = await readStartupBackup()
  expect(read).toBeNull()
})
