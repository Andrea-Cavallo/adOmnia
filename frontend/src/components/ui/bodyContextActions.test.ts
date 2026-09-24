import { describe, expect, it, vi } from 'vitest'
import { bodyContextItems, runBodyEdit } from './bodyContextActions'

describe('body context actions', () => {
  it('keeps editing actions available alongside custom extraction actions', () => {
    expect(bodyContextItems(true, true).map(i => i.id)).toEqual(['copy', 'copy-body', 'cut', 'paste', 'delete', 'select-all'])
    expect(bodyContextItems(false, true).map(i => i.id)).toEqual(['copy', 'copy-body', 'select-all'])
    expect(bodyContextItems(true, false).find(i => i.id === 'paste')?.disabled).toBeUndefined()
  })
  it('copies exact whitespace and cuts only after a successful clipboard write', async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined), readText: vi.fn() }
    const replace = vi.fn()
    await runBodyEdit('cut', { body: 'a  b\n c', start: 1, end: 6 }, clipboard, () => 'a  b\n c', replace)
    expect(clipboard.writeText).toHaveBeenCalledWith('  b\n ')
    expect(replace).toHaveBeenCalledWith('ac', 1)
    clipboard.writeText.mockRejectedValue(new Error('denied')); replace.mockClear()
    await expect(runBodyEdit('cut', { body: 'abc', start: 0, end: 2 }, clipboard, () => 'abc', replace)).rejects.toThrow('denied')
    expect(replace).not.toHaveBeenCalled()
  })
  it('pastes at the captured range and refuses stale asynchronous edits', async () => {
    const clipboard = { writeText: vi.fn(), readText: vi.fn().mockResolvedValue('XYZ') }
    const replace = vi.fn()
    await runBodyEdit('paste', { body: 'abc', start: 1, end: 2 }, clipboard, () => 'abc', replace)
    expect(replace).toHaveBeenCalledWith('aXYZc', 4)
    replace.mockClear()
    await runBodyEdit('paste', { body: 'abc', start: 1, end: 2 }, clipboard, () => 'another request', replace)
    expect(replace).not.toHaveBeenCalled()
  })
})
