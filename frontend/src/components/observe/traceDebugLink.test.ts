import { describe, expect, it } from 'vitest'
import type { LiveSession, RequestRun } from '@/lib/devsession-api'
import { debugRunForTrace } from './traceDebugLink'

const session = { id: 'debug:one', kind: 'debug', state: 'running' } as LiveSession
const run = { id: 'run-1', sessionId: session.id, tabId: 'tab-1', correlationId: 'adm-123' } as RequestRun

describe('debugRunForTrace', () => {
  it('links an exact correlation ID to its live debug request', () => {
    expect(debugRunForTrace([{ correlationId: 'adm-123' }], { [run.id]: run }, [run.id], { [session.id]: session }))
      .toEqual({ run, session })
  })

  it('does not guess from a trace ID or a stopped session', () => {
    const state = { [session.id]: session }
    expect(debugRunForTrace([{ correlationId: 'adm-12' }], { [run.id]: run }, [run.id], state)).toBeNull()
    expect(debugRunForTrace([{ correlationId: 'adm-123' }], { [run.id]: run }, [run.id], { [session.id]: { ...session, state: 'stopped' } })).toBeNull()
    expect(debugRunForTrace([{ correlationId: 'adm-123', service: 'other' }], { [run.id]: run }, [run.id], { [session.id]: { ...session, service: 'api' } })).toBeNull()
  })
})
