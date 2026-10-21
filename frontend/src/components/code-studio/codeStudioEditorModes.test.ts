import { describe, expect, it, vi } from 'vitest'
const modeAdapter = vi.hoisted(() => ({ on: vi.fn(), off: vi.fn(), dispose: vi.fn() }))
vi.mock('monaco-vim', () => ({ initVimMode: () => modeAdapter }))
vi.mock('@/stores/codeStudioWhenContext', () => ({ parseVimMode: (text: string) => text.toLowerCase().includes('insert') ? 'insert' : 'normal' }))
import { attachEditorMode } from './codeStudioEditorModes'

describe('Vim mode event lifecycle', () => {
  it('tracks the adapter mode events, including returning to normal, and unsubscribes', async () => {
    const report = vi.fn()
    const dispose = await attachEditorMode({} as never, 'vim', null, report)
    expect(report).toHaveBeenCalledWith('normal')
    expect(modeAdapter.on).toHaveBeenCalledWith('vim-mode-change', expect.any(Function))
    const listener = modeAdapter.on.mock.calls.find(call => call[0] === 'vim-mode-change')![1]
    listener({ mode: 'insert' })
    expect(report).toHaveBeenLastCalledWith('insert')
    listener({ mode: 'normal' })
    expect(report).toHaveBeenLastCalledWith('normal')
    dispose()
    expect(modeAdapter.off).toHaveBeenCalledWith('vim-mode-change', listener)
    expect(report).toHaveBeenLastCalledWith(null)
  })
})
