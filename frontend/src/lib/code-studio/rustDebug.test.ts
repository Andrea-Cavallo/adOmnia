import { describe, expect, it } from 'vitest'
import { rustDebugTargetOf } from './rustDebug'

describe('rustDebugTargetOf', () => {
  it('maps a bin run to the same build options, without secrets', () => {
    expect(rustDebugTargetOf({
      kind: 'bin', language: 'rust', workingDirectory: 'svc', programArguments: ['--port', '8080'],
      environment: [{ key: 'A', value: '1' }, { key: 'TOKEN', value: 'x', secret: true }],
      languageOptions: { package: 'svc', bin: 'server', features: ['tls'], profile: 'release' },
    })).toEqual({ package: 'svc', bin: 'server', features: ['tls'], profile: 'release', workingDirectory: 'svc', programArguments: ['--port', '8080'], environment: { A: '1' } })
  })

  it('maps an example and refuses kinds that are not executables', () => {
    expect(rustDebugTargetOf({ kind: 'example', language: 'rust', languageOptions: { example: 'demo' } })).toMatchObject({ example: 'demo' })
    expect(rustDebugTargetOf({ kind: 'build', language: 'rust', languageOptions: {} })).toBeNull()
    expect(rustDebugTargetOf({ kind: 'bin', language: 'go', languageOptions: { bin: 'x' } })).toBeNull()
    expect(rustDebugTargetOf({ kind: 'bin', language: 'rust', languageOptions: {} })).toBeNull()
  })
})
