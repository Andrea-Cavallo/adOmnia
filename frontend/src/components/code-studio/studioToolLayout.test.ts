import { describe, expect, it } from 'vitest'
import { studioToolLayout } from './studioToolLayout'

const project = { id: 'project', key: 'project', position: 'left' as const, open: true, width: 240 }
const chat = { id: 'side', key: 'chat', position: 'right' as const, open: true, width: 360 }
const run = { id: 'run', key: 'run', position: 'bottom' as const, open: true, width: 320 }

describe('detached tool layout', () => {
  it('reclaims the chat column and output row, and restores them when brought back', () => {
    const detached = studioToolLayout([project, { ...chat, detached: true }, { ...run, detached: true }], null, 260)
    expect(detached.gridStyle).toEqual({ gridTemplateColumns: '240px minmax(0, 1fr)', gridTemplateRows: 'minmax(0, 1fr)' })
    expect(detached.styleFor('side')).toEqual({ display: 'none' })
    expect(detached.styleFor('run')).toEqual({ display: 'none' })
    const returned = studioToolLayout([project, chat, run], null, 260)
    expect(returned.gridStyle.gridTemplateColumns).toBe('240px minmax(0, 1fr) 360px')
    expect(returned.styleFor('run').gridRow).toBe(2)
  })
  it('expands remaining bottom tools across the space of detached output', () => {
    const layout = studioToolLayout([project, { ...run, detached: true }, { ...run, id: 'logs', key: 'logs' }], null, 260)
    expect(layout.centerColumns).toBe(1)
    expect(layout.styleFor('logs')).toEqual({ gridColumn: '1 / 3', gridRow: 2 })
  })
  it('drops a detached maximized view and reclaims its left or bottom track', () => {
    for (const position of ['left', 'bottom'] as const) {
      const layout = studioToolLayout([project, { ...chat, position, detached: true }], 'chat', 260)
      expect(layout.focused).toBeUndefined()
      expect(layout.gridStyle).toEqual({ gridTemplateColumns: '240px minmax(0, 1fr)', gridTemplateRows: 'minmax(0, 1fr)' })
    }
  })
})
