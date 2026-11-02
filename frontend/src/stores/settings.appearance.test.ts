import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from './settings'
import { SaveSettings } from '@/wailsjs/go/main/App'
import { flushPendingSaves } from '@/lib/storeSave'

vi.mock('@/wailsjs/go/main/App', () => ({
  LoadSettings: vi.fn(async () => '{}'),
  SaveSettings: vi.fn(async () => undefined),
}))
vi.mock('@/lib/uiSessionMemento', () => ({
  updateUiSessionStartupPreference: vi.fn(),
}))

describe('appearance settings persistence', () => {
  beforeEach(async () => {
    await useSettingsStore.getState().load('{}')
    await flushPendingSaves()
    useSettingsStore.getState().previewAppearance(null)
    vi.mocked(SaveSettings).mockClear()
  })
  it('persists independent JSON palettes and inherits theme colors after reset', async () => {
    useSettingsStore.getState().updateAppearance({ jsonColors: { dark: { key: '#abcdef', array: '#123456' }, light: { key: '#102030' } } })
    await flushPendingSaves()
    const calls = vi.mocked(SaveSettings).mock.calls
    await useSettingsStore.getState().load(calls[calls.length - 1][0])
    expect(useSettingsStore.getState().settings.appearance.jsonColors).toEqual({ dark: { key: '#abcdef', array: '#123456' }, light: { key: '#102030' } })
    await useSettingsStore.getState().load('{}')
    expect(useSettingsStore.getState().settings.appearance.jsonColors).toEqual({})
  })
  it('previews without saving or changing the persisted appearance', () => {
    const original = useSettingsStore.getState().settings.appearance
    useSettingsStore
      .getState()
      .previewAppearance({
        themeId: 'builtin-light',
        baseColor: '#FFFFFF',
        accentColor: '#000000',
      })
    expect(useSettingsStore.getState().settings.appearance).toBe(original)
    expect(SaveSettings).not.toHaveBeenCalled()
    useSettingsStore.getState().previewAppearance(null)
    expect(useSettingsStore.getState().appearancePreview).toBeNull()
  })
  it('saves profiles and colors, excludes live preview and restores them after load', async () => {
    const profile = {
      id: 'yellow',
      name: 'Yellow',
      themeId: 'builtin-dark',
      baseColor: '#000000',
      accentColor: '#FACC15',
    }
    useSettingsStore.getState().previewAppearance(profile)
    useSettingsStore
      .getState()
      .updateAppearance({ ...profile, profiles: [profile] })
    await flushPendingSaves()
    const calls = vi.mocked(SaveSettings).mock.calls
    const raw = calls[calls.length - 1][0]
    expect(JSON.parse(raw).appearancePreview).toBeUndefined()
    expect(JSON.parse(raw).appearance.profiles).toEqual([profile])
    await useSettingsStore.getState().load(raw)
    expect(useSettingsStore.getState().settings.appearance.baseColor).toBe(
      '#000000',
    )
    expect(useSettingsStore.getState().settings.appearance.profiles).toEqual([
      profile,
    ])
  })
  it('migrates old settings while preserving custom colors and safe monochrome defaults', async () => {
    await useSettingsStore
      .getState()
      .load(
        JSON.stringify({
          version: 13,
          appearance: {
            themeId: 'builtin-dark',
            accentColor: '#FACC15',
            baseColor: 'broken',
            profiles: 'broken',
          },
        }),
      )
    // The version is always rewritten to the current settings version (16: background update downloads).
    expect(useSettingsStore.getState().settings.version).toBe(16)
    expect(useSettingsStore.getState().settings.appearance.accentColor).toBe(
      '#FACC15',
    )
    expect(
      useSettingsStore.getState().settings.appearance.baseColor,
    ).toBeUndefined()
    expect(useSettingsStore.getState().settings.appearance.profiles).toEqual([])
    await flushPendingSaves()
  })
})
