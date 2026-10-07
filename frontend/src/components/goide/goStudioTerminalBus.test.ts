import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/goide-api', () => ({ subscribeGoIDEEvents: vi.fn(() => () => undefined) }))

import { attachTerminal, forgetTerminal, terminalBusForTests, exportTerminalHistory, importTerminalHistory } from './goStudioTerminalBus'

afterEach(() => terminalBusForTests.reset())

describe('goStudioTerminalBus', () => {
  it('bootstraps another window without duplicating live events received during the transfer', () => {
    terminalBusForTests.append('t1', 'before\n', 10)
    const saved = exportTerminalHistory()
    terminalBusForTests.reset()
    terminalBusForTests.append('t1', 'before\n', 10)
    terminalBusForTests.append('t1', 'during\n', 11)
    importTerminalHistory(saved)
    const received: string[] = []
    attachTerminal('t1', (data) => received.push(data), () => undefined)
    terminalBusForTests.append('t1', 'after\n', 12)
    expect(received).toEqual(['before\nduring\n', 'after\n'])
  })
  it('replays output that arrived before the view mounted, then streams new output', () => {
    terminalBusForTests.append('t1', '$ ')
    const received: string[] = []
    const detach = attachTerminal('t1', (data) => received.push(data), () => undefined)
    terminalBusForTests.append('t1', 'go version\n')
    expect(received).toEqual(['$ ', 'go version\n'])
    detach()
    terminalBusForTests.append('t1', 'ignored')
    expect(received).toHaveLength(2)
  })

  it('reports an exit that happened while no view was attached', () => {
    terminalBusForTests.markExited('t2')
    const onExit = vi.fn()
    attachTerminal('t2', () => undefined, onExit)
    expect(onExit).toHaveBeenCalledOnce()
  })

  it('bounds history and forgets closed terminals', () => {
    const chunk = 'x'.repeat(200 * 1024)
    for (let index = 0; index < 5; index++) terminalBusForTests.append('t3', chunk)
    let replay = ''
    attachTerminal('t3', (data) => { replay += data }, () => undefined)
    expect(replay.length).toBeLessThanOrEqual(512 * 1024)
    expect(replay.length).toBeGreaterThan(0)
    forgetTerminal('t3')
    let after = ''
    attachTerminal('t3', (data) => { after += data }, () => undefined)
    expect(after).toBe('')
  })
})
