import { describe, expect, it } from 'vitest'
import { nativeDebugTargetOf } from './nativeDebug'

describe('nativeDebugTargetOf', () => {
  it('debugs the executable of a native run configuration, without secrets', () => {
    expect(nativeDebugTargetOf({ language: 'cpp', kind: 'executable', workingDirectory: 'build', programArguments: ['-v'], languageOptions: { program: 'app' },
      environment: [{ key: 'MODE', value: 'dev' }, { key: 'TOKEN', value: 'x', secret: true }] }))
      .toEqual({ language: 'cpp', program: 'app', workingDirectory: 'build', programArguments: ['-v'], environment: { MODE: 'dev' } })
  })
  it('ignores other languages, kinds and configurations without a program', () => {
    expect(nativeDebugTargetOf({ language: 'ruby', kind: 'executable', languageOptions: { program: 'x' } })).toBeNull()
    expect(nativeDebugTargetOf({ language: 'zig', kind: 'command', languageOptions: { program: 'x' } })).toBeNull()
    expect(nativeDebugTargetOf({ language: 'swift', kind: 'executable', languageOptions: {} })).toBeNull()
  })
})
