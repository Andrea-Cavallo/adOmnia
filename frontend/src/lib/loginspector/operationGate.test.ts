import { describe, expect, it } from 'vitest'
import { OperationGate } from './operationGate'

describe('latest log import wins', () => {
  it('invalidates an older file or clipboard read as soon as a new one starts', () => {
    const gate = new OperationGate()
    const first = gate.start()
    const second = gate.start()
    expect(gate.shouldAbort(first)).toBe(true)
    expect(gate.isActive(second)).toBe(true)
  })

  it('prevents a cleared import from publishing late progress or results', () => {
    const gate = new OperationGate()
    const importOperation = gate.start()
    gate.cancel()
    expect(gate.isActive(importOperation)).toBe(false)
    expect(importOperation.cancelled).toBe(true)
  })

  it('keeps an explicitly aborted import current so its partial result can be shown', () => {
    const gate = new OperationGate()
    const importOperation = gate.start()
    gate.requestAbort(importOperation)
    expect(gate.shouldAbort(importOperation)).toBe(true)
    expect(gate.isCurrent(importOperation)).toBe(true)
  })
})
