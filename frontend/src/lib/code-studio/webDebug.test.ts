import { describe, expect, it } from 'vitest'
import { webDebugScriptRequest, webDebugTargetOf } from './webDebug'

describe('webDebugTargetOf', () => {
  it('maps a package-manager command to the same script, without secrets', () => {
    expect(webDebugTargetOf({
      kind: 'command', language: 'typescript', target: 'npm', workingDirectory: 'web',
      programArguments: ['run', 'dev'], environment: [{ key: 'PORT', value: '3000' }, { key: 'TOKEN', value: 'x', secret: true }],
    })).toEqual({ kind: 'command', runtimeExecutable: 'npm', runtimeArgs: ['run', 'dev'], workingDirectory: 'web', environment: { PORT: '3000' } })
  })

  it('refuses configurations that start no Node process', () => {
    expect(webDebugTargetOf({ kind: 'command', language: 'python', target: 'npm' })).toBeNull()
    expect(webDebugTargetOf({ kind: 'build', language: 'typescript', target: 'npm' })).toBeNull()
    expect(webDebugTargetOf({ kind: 'command', language: 'typescript' })).toBeNull()
  })
})

describe('webDebugScriptRequest', () => {
  it('debugs the file itself', () => {
    expect(webDebugScriptRequest('s1', 'src/app.ts', 'web')).toEqual({ sessionId: 's1', kind: 'script', program: 'src/app.ts', workingDirectory: 'web' })
  })
})
