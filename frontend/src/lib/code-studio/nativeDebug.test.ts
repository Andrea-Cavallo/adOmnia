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
    expect(nativeDebugTargetOf({ language: 'ruby', kind: 'script', languageOptions: { script: 'x.rb' } })).toBeNull()
  })
  it('debugs a .NET project, also without a project file', () => {
    expect(nativeDebugTargetOf({ language: 'csharp', kind: 'dotnet', languageOptions: { project: 'src/Api/Api.csproj' } }))
      .toEqual({ language: 'csharp', program: 'src/Api/Api.csproj', workingDirectory: '' })
    expect(nativeDebugTargetOf({ language: 'fsharp', kind: 'dotnet', workingDirectory: 'app', languageOptions: {} }))
      .toEqual({ language: 'fsharp', program: '', workingDirectory: 'app' })
    expect(nativeDebugTargetOf({ language: 'csharp', kind: 'script', languageOptions: { script: 'x.csx' } })).toBeNull()
  })
  it('debugs the script of a PHP or Dart configuration', () => {
    expect(nativeDebugTargetOf({ language: 'php', kind: 'script', languageOptions: { script: 'bin/serve.php' } }))
      .toEqual({ language: 'php', program: 'bin/serve.php', workingDirectory: '' })
  })
})
