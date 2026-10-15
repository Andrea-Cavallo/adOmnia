import { beforeEach, describe, expect, it } from 'vitest'
import { useDevLogsStore, type BackendDevLogEntry } from './devLogs'

const backend = (patch: Partial<BackendDevLogEntry>): BackendDevLogEntry => ({
  i: 0,
  ts: '2026-10-15T10:00:00.000Z',
  level: 'info',
  msg: 'hello',
  ...patch,
})

describe('devLogs store', () => {
  beforeEach(() => {
    useDevLogsStore.setState({ entries: [] })
    useDevLogsStore.getState().clear()
  })

  it('does not notify subscribers when the backend batch is empty', () => {
    const before = useDevLogsStore.getState().entries
    let notifications = 0
    const unsub = useDevLogsStore.subscribe(() => { notifications += 1 })

    useDevLogsStore.getState().mergeBackendEntries([])

    unsub()
    expect(notifications).toBe(0)
    expect(useDevLogsStore.getState().entries).toBe(before)
  })

  it('does not notify subscribers when every entry is a duplicate', () => {
    useDevLogsStore.getState().mergeBackendEntries([backend({ i: 1, msg: 'first' })])
    useDevLogsStore.getState().addEntry('warn', 'echoed', 'frontend')
    const before = useDevLogsStore.getState().entries

    let notifications = 0
    const unsub = useDevLogsStore.subscribe(() => { notifications += 1 })

    useDevLogsStore.getState().mergeBackendEntries([
      backend({ i: 1, msg: 'first' }),
      backend({ i: 2, msg: 'echoed', source: 'frontend', ts: new Date().toISOString() }),
    ])
    useDevLogsStore.getState().mergeBackendEntries([backend({ i: 1, msg: 'first' })])

    unsub()
    expect(notifications).toBe(0)
    expect(useDevLogsStore.getState().entries).toBe(before)
  })

  it('notifies once per batch containing new entries and keeps them sorted', () => {
    let notifications = 0
    const unsub = useDevLogsStore.subscribe(() => { notifications += 1 })

    useDevLogsStore.getState().mergeBackendEntries([
      backend({ i: 2, ts: '2026-10-15T10:00:02.000Z', msg: 'second' }),
      backend({ i: 1, ts: '2026-10-15T10:00:01.000Z', msg: 'first' }),
    ])

    unsub()
    expect(notifications).toBe(1)
    expect(useDevLogsStore.getState().entries.map((entry) => entry.message)).toEqual(['first', 'second'])
  })

  it('keeps the frontend echo filter for backend-captured frontend entries', () => {
    useDevLogsStore.getState().addEntry('warn', 'same message', 'frontend', undefined, undefined)
    const timestamp = useDevLogsStore.getState().entries[0].timestamp

    useDevLogsStore.getState().mergeBackendEntries([
      backend({ i: 5, source: 'frontend', level: 'warning', msg: 'same message', ts: new Date(timestamp).toISOString() }),
    ])

    expect(useDevLogsStore.getState().entries).toHaveLength(1)
    expect(useDevLogsStore.getState().entries[0].source).toBe('frontend')
    expect(useDevLogsStore.getState().entries[0].level).toBe('warn')
  })

  it('caps the entries buffer at 2000', () => {
    const batch = Array.from({ length: 2100 }, (_, index) => backend({
      i: index,
      ts: new Date(Date.UTC(2026, 9, 15, 10, 0, 0, 0) + index * 1000).toISOString(),
      msg: `entry ${index}`,
    }))
    useDevLogsStore.getState().mergeBackendEntries(batch)

    const entries = useDevLogsStore.getState().entries
    expect(entries).toHaveLength(2000)
    expect(entries[entries.length - 1].message).toBe('entry 2099')
  })
})
