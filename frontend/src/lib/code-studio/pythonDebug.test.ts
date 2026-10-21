import { describe, expect, it } from 'vitest'
import { pythonDebugTargetOf } from './pythonDebug'

describe('pythonDebugTargetOf', () => {
  it('debugs a script with its arguments, non-secret environment and interpreter', () => {
    expect(pythonDebugTargetOf({
      kind: 'script', language: 'python', workingDirectory: 'ml', programArguments: ['--x'],
      environment: [{ key: 'A', value: '1' }, { key: 'S', secret: true }],
      languageOptions: { script: 'train.py', interpreter: '.venv/Scripts/python.exe' },
    })).toEqual({ kind: 'script', script: 'train.py', workingDirectory: 'ml', programArguments: ['--x'], environment: { A: '1' }, interpreter: '.venv/Scripts/python.exe' })
  })

  it('debugs a module and skips configurations without a script or module', () => {
    expect(pythonDebugTargetOf({ kind: 'module', language: 'python', languageOptions: { module: 'pkg.main' } })).toEqual({ kind: 'module', module: 'pkg.main', workingDirectory: '' })
    expect(pythonDebugTargetOf({ kind: 'script', language: 'python', languageOptions: {} })).toBeNull()
    expect(pythonDebugTargetOf({ kind: 'pytest', language: 'python', languageOptions: { script: 'a.py' } })).toBeNull()
    expect(pythonDebugTargetOf({ kind: 'script', language: 'go', languageOptions: { script: 'a.py' } })).toBeNull()
  })

  it('forwards the guided framework fields of a server configuration', () => {
    expect(pythonDebugTargetOf({
      kind: 'module', language: 'python',
      languageOptions: { module: 'uvicorn', app: 'app.main:app', host: '127.0.0.1', port: 9000, reload: true },
    })).toEqual({ kind: 'module', module: 'uvicorn', app: 'app.main:app', host: '127.0.0.1', port: 9000, reload: true, workingDirectory: '' })
  })
})
