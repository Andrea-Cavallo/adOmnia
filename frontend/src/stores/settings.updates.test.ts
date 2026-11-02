import { describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from './settings'
import { flushPendingSaves } from '@/lib/storeSave'

vi.mock('@/wailsjs/go/main/App', () => ({
  LoadSettings: vi.fn(async () => '{}'),
  SaveSettings: vi.fn(async () => undefined),
}))
vi.mock('@/lib/uiSessionMemento', () => ({
  updateUiSessionStartupPreference: vi.fn(),
}))

const load = async (settings: object) => {
  await useSettingsStore.getState().load(JSON.stringify(settings))
  await flushPendingSaves()
  return useSettingsStore.getState().settings.general.autoDownloadUpdates
}

describe('update settings migration', () => {
  it('downloads verified updates in the background by default', async () => {
    expect(await load({})).toBe(true)
  })
  it('switches the old default on once', async () => {
    expect(await load({ version: 15, general: { autoDownloadUpdates: false } })).toBe(true)
  })
  it('keeps a choice made after the switch', async () => {
    expect(await load({ version: 16, general: { autoDownloadUpdates: false } })).toBe(false)
  })
})
