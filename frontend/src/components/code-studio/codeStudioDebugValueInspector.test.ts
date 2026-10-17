import { describe, expect, it } from 'vitest'
import { summarizeCodeStudioDebugValue } from './codeStudioDebugValueInspector'

describe('Code Studio runtime value inspector', () => {
  it('reads slice len and cap only from the Delve value', () => {
    expect(summarizeCodeStudioDebugValue({ type: '[]int', value: '[]int len: 3, cap: 8, [1,2,3]' }))
      .toEqual({ kind: 'slice', label: 'Slice', length: 3, capacity: 8 })
  })

  it('recognizes maps, channels, contexts and errors without evaluating them', () => {
    expect(summarizeCodeStudioDebugValue({ type: 'map[string]int', value: 'map[string]int ["ok":1] len: 1' }))
      .toMatchObject({ kind: 'map', length: 1 })
    expect(summarizeCodeStudioDebugValue({ type: 'chan string', value: 'chan string 0x123' }))?.toMatchObject({ kind: 'channel' })
    expect(summarizeCodeStudioDebugValue({ type: 'context.Context', value: '*context.valueCtx {...}' }))?.toMatchObject({ kind: 'context' })
    expect(summarizeCodeStudioDebugValue({ type: 'error', value: 'errors.errorString "broken"' }))?.toMatchObject({ kind: 'error' })
  })

  it('shows a concrete interface type only when Delve printed one', () => {
    expect(summarizeCodeStudioDebugValue({ type: 'interface {}', value: 'interface {}(main.event) {ID: 7}' }))
      .toEqual({ kind: 'interface', label: 'Interface', dynamicType: 'main.event' })
    expect(summarizeCodeStudioDebugValue({ type: 'any', value: '*main.event {ID: 7}' }))
      .toEqual({ kind: 'interface', label: 'Interface', dynamicType: '*main.event' })
    expect(summarizeCodeStudioDebugValue({ type: 'interface {}', value: 'string("ready")' }))
      .toEqual({ kind: 'interface', label: 'Interface', dynamicType: 'string' })
    expect(summarizeCodeStudioDebugValue({ type: 'interface {}', value: '<nil>' }))
      .toEqual({ kind: 'interface', label: 'Interface', dynamicType: undefined })
    expect(summarizeCodeStudioDebugValue({ type: 'int', value: '7' })).toBeNull()
  })
})
