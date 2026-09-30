import { describe, expect, it } from 'vitest'
import { panicSnapshot, panicValueFromVariables } from './goStudioPanicInspector'

describe('Go Studio panic inspector', () => {
  it('finds the project origin after runtime.gopanic', () => {
    const snapshot = panicSnapshot('exception', [
      { id: 1, name: 'runtime.gopanic', path: '', relativePath: '', line: 0, column: 0 },
      { id: 2, name: 'main.must', path: '/work/main.go', relativePath: 'main.go', line: 14, column: 1 },
    ])
    expect(snapshot).toMatchObject({ reason: 'exception', originFrame: { name: 'main.must', relativePath: 'main.go', line: 14 } })
  })

  it('does not turn a normal breakpoint into a panic', () => {
    expect(panicSnapshot('breakpoint', [{ id: 1, name: 'main.run', path: '/work/main.go', relativePath: 'main.go', line: 9, column: 1 }])).toBeNull()
  })

  it('picks the panic argument from the runtime frame without evaluating code', () => {
    expect(panicValueFromVariables([
      { name: 'g', value: '...', type: '*runtime.g', variablesReference: 0 },
      { name: 'e', value: 'string("boom")', type: 'interface {}', variablesReference: 2 },
    ])).toMatchObject({ name: 'e', value: 'string("boom")' })
  })
})
