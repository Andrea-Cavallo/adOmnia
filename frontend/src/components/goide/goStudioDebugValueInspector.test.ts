import { describe, expect, it } from 'vitest'
import { summarizeGoStudioDebugValue } from './goStudioDebugValueInspector'

describe('Go Studio runtime value inspector', () => {
  it('reads slice len and cap only from the Delve value', () => {
    expect(summarizeGoStudioDebugValue({ type: '[]int', value: '[]int len: 3, cap: 8, [1,2,3]' }))
      .toEqual({ kind: 'slice', label: 'Slice', length: 3, capacity: 8 })
  })

  it('recognizes maps, channels, contexts and errors without evaluating them', () => {
    expect(summarizeGoStudioDebugValue({ type: 'map[string]int', value: 'map[string]int ["ok":1] len: 1' }))
      .toMatchObject({ kind: 'map', length: 1 })
    expect(summarizeGoStudioDebugValue({ type: 'chan string', value: 'chan string 0x123' }))?.toMatchObject({ kind: 'channel' })
    expect(summarizeGoStudioDebugValue({ type: 'context.Context', value: '*context.valueCtx {...}' }))?.toMatchObject({ kind: 'context' })
    expect(summarizeGoStudioDebugValue({ type: 'error', value: 'errors.errorString "broken"' }))?.toMatchObject({ kind: 'error' })
  })

  it('shows a concrete interface type only when Delve printed one', () => {
    expect(summarizeGoStudioDebugValue({ type: 'interface {}', value: 'interface {}(main.event) {ID: 7}' }))
      .toEqual({ kind: 'interface', label: 'Interface', dynamicType: 'main.event' })
    expect(summarizeGoStudioDebugValue({ type: 'any', value: '*main.event {ID: 7}' }))
      .toEqual({ kind: 'interface', label: 'Interface', dynamicType: '*main.event' })
    expect(summarizeGoStudioDebugValue({ type: 'interface {}', value: 'string("ready")' }))
      .toEqual({ kind: 'interface', label: 'Interface', dynamicType: 'string' })
    expect(summarizeGoStudioDebugValue({ type: 'interface {}', value: '<nil>' }))
      .toEqual({ kind: 'interface', label: 'Interface', dynamicType: undefined })
    expect(summarizeGoStudioDebugValue({ type: 'int', value: '7' })).toBeNull()
  })
})
