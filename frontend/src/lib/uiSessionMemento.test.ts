import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  UI_SESSION_MEMENTO_KEY,
  initialRailFromMemento,
  loadUiSessionMemento,
  saveUiSessionMemento,
  updateUiSessionStartupPreference,
} from './uiSessionMemento'

const values = new Map<string, string>()

beforeEach(() => {
  values.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  })
})

describe('UI session memento', () => {
  it('restores the last active rail in resume mode', () => {
    saveUiSessionMemento('mock', 'resume', 'collections')

    expect(initialRailFromMemento()).toBe('mock')
    expect(loadUiSessionMemento()?.activeRail).toBe('mock')
  })

  it('uses the configured rail in fixed mode', () => {
    saveUiSessionMemento('mock', 'fixed', 'browser')

    expect(initialRailFromMemento()).toBe('browser')
  })

  it('migrates legacy rail names and rejects invalid payloads', () => {
    values.set(UI_SESSION_MEMENTO_KEY, JSON.stringify({
      version: 1,
      activeRail: 'kafka',
      startupBehavior: 'resume',
      defaultStartupRail: 'utils',
      savedAt: '2026-08-11T00:00:00.000Z',
    }))

    expect(loadUiSessionMemento()).toMatchObject({
      activeRail: 'broker',
      defaultStartupRail: 'powertools',
    })

    values.set(UI_SESSION_MEMENTO_KEY, '{not-json')
    expect(loadUiSessionMemento()).toBeNull()
    expect(initialRailFromMemento()).toBe('welcome')
  })

  it('updates startup preferences without losing the last active rail', () => {
    saveUiSessionMemento('soap', 'resume', 'collections')
    updateUiSessionStartupPreference('fixed', 'proxy')

    expect(loadUiSessionMemento()).toMatchObject({
      activeRail: 'soap',
      startupBehavior: 'fixed',
      defaultStartupRail: 'proxy',
    })
  })
})
