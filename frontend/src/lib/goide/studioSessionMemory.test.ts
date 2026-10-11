import { afterEach, expect, it, vi } from 'vitest'
import { rememberedStudioSession, studioSessionMemoryKey } from './studioSessionMemory'
afterEach(() => vi.unstubAllGlobals())
const sessions = [{ id: 'first' }, { id: 'last' }]
it('restores the last selected project rather than the first', () => {
  vi.stubGlobal('localStorage', { getItem: (key: string) => key === studioSessionMemoryKey('workspace') ? 'last' : null })
  expect(rememberedStudioSession(sessions, 'workspace')).toBe('last')
  expect(rememberedStudioSession(sessions, 'other')).toBe('first')
})
it('falls back when the saved project was closed or storage is unavailable', () => {
  vi.stubGlobal('localStorage', { getItem: () => 'closed' })
  expect(rememberedStudioSession(sessions, 'workspace')).toBe('first')
  expect(rememberedStudioSession([], 'workspace')).toBeNull()
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') } })
  expect(rememberedStudioSession(sessions, 'workspace')).toBe('first')
})
