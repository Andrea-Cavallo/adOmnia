import { describe, expect, it } from 'vitest'
import type { GoIDEExecution } from '@/lib/code-studio-api'
import { createRunLogSnapshot } from './codeStudioRunLogExport'

describe('Run log exports', () => {
  const execution = { id: 'run/1', command: 'any-language', status: 'exited', exitCode: 1 } as GoIDEExecution
  it('exports the complete captured output with streams and original ANSI in JSON', () => {
    const chunks = [
      { sequence: 0, stream: 'system' as const, text: '$ any-language\n/project\n\n' },
      { sequence: 1, stream: 'stdout' as const, text: '\u001b[32mciao è\u001b[0m\nrepeat\nrepeat\n\n' },
      { sequence: 2, stream: 'stderr' as const, text: 'failure\n' },
    ]
    const snapshot = createRunLogSnapshot(execution, chunks)
    const report = JSON.parse(snapshot.json)
    expect(report.chunks).toEqual(chunks)
    expect(report.execution.exitCode).toBe(1)
    expect(snapshot.txt).toBe('$ any-language\n/project\n\nciao è\nrepeat\nrepeat\n\nfailure\n')
    const events = snapshot.inspector.split('\n').map(line => JSON.parse(line))
    expect(events.filter(event => event.message === 'repeat')).toHaveLength(2)
    expect(events[events.length - 1]).toEqual({ message: 'failure', stream: 'stderr', sequence: 2, runId: 'run/1' })
    expect(events.every(event => !('timestamp' in event))).toBe(true)
    expect(snapshot.name).toBe('run-run_1')
    chunks[1].text = 'changed'
    expect(JSON.parse(snapshot.json).chunks[1].text).toContain('ciao')
  })
  it('does not restrict exports to the visible tail and handles unfinished lines', () => {
    const snapshot = createRunLogSnapshot(execution, [{ sequence: 1, stream: 'stdout', text: 'line\n'.repeat(6000) + 'last' }])
    expect(snapshot.inspector.split('\n')).toHaveLength(6001)
    expect(snapshot.txt.endsWith('last')).toBe(true)
  })
})
