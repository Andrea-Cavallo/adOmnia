import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import type { UpdateState } from '@/stores/updater'

// Server rendering reads a zustand store's initial state, so the row gets its state from a stub.
const updater = vi.hoisted(() => ({ status: undefined as unknown }))
vi.mock('@/stores/updater', () => ({
  useUpdaterStore: () => ({ status: updater.status, error: '', check: vi.fn(), download: vi.fn(), cancel: vi.fn(), schedule: vi.fn() }),
}))
vi.mock('@/wailsjs/runtime/runtime', () => ({ BrowserOpenURL: vi.fn() }))
vi.mock('@/wailsjs/go/main/App', () => ({ LoadSettings: vi.fn(), SaveSettings: vi.fn() }))

import { UpdateCheckRow } from './UpdateCheckRow'

const available = (install: UpdateState['install']): UpdateState => ({
  phase: 'available', version: 'v2.0.0', channel: 'stable', releaseUrl: 'https://github.com/Andrea-Cavallo/adOmnia/releases/tag/v2.0.0',
  notes: '', received: 0, total: 0, error: '', trusted: true, scheduled: false,
  failedVersion: '', restoredVersion: '', failureReason: '', applyLogAvailable: false, install,
})

describe('update settings row', () => {
  it('offers the in-place download for an installed copy', () => {
    updater.status = available({ kind: 'installer', selfUpdate: true, reason: '' })
    const html = renderToStaticMarkup(<UpdateCheckRow />)
    expect(html).toContain('Installed with the Windows installer')
    expect(html).toContain('Download update')
    expect(html).not.toContain('Download installer')
  })
  it('links the release instead of downloading for a managed copy', () => {
    updater.status = available({ kind: 'managed', selfUpdate: false, reason: 'Update it through your package manager' })
    const html = renderToStaticMarkup(<UpdateCheckRow />)
    expect(html).toContain('Update it through your package manager')
    expect(html).toContain('Download installer')
    expect(html).not.toContain('Download update<')
  })
})
