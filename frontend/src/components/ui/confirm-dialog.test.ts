import { describe, expect, it } from 'vitest'
import { splitConfirmMessage } from './confirm-dialog'

describe('splitConfirmMessage', () => {
  it('turns leading Command / Working directory lines into mono details', () => {
    const result = splitConfirmMessage('Command: go get github.com/x/y@latest\nWorking directory: C:\Users\a\pdld-core\n\nThis may contact the configured Go proxy.')
    expect(result.details).toEqual([
      { label: 'Command', value: 'go get github.com/x/y@latest', mono: true },
      { label: 'Working directory', value: 'C:\Users\a\pdld-core', mono: true },
    ])
    expect(result.message).toBe('This may contact the configured Go proxy.')
  })

  it('leaves ordinary messages and explicit details untouched', () => {
    const result = splitConfirmMessage('Delete the request?', [{ label: 'Name', value: 'Get users' }])
    expect(result).toEqual({ message: 'Delete the request?', details: [{ label: 'Name', value: 'Get users' }] })
  })
})
