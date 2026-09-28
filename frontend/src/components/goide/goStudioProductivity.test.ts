import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/monacoSetup', () => ({ monaco: {} }))
vi.mock('@/lib/goide-api', () => ({ subscribeGoIDEEvents: vi.fn(() => () => undefined) }))
vi.mock('@/lib/goide-lsp-api', () => ({}))

import { removeFromSplit } from '@/stores/goide'
import { todoItemFor, TODO_PATTERN } from './GoStudioTodoPanel'
import { relativeTime } from './goStudioTime'

const match = (preview: string) => ({ relativePath: 'main.go', line: 3, column: 1, endColumn: 5, preview })

describe('split tab group', () => {
  it('closing the visible tab shows its neighbour, closing the last closes the split', () => {
    const split = { orientation: 'right' as const, documentId: 'b', tabs: ['a', 'b', 'c'] }
    expect(removeFromSplit(split, 'b')).toEqual({ orientation: 'right', documentId: 'c', tabs: ['a', 'c'] })
    expect(removeFromSplit(split, 'a')?.documentId).toBe('b')
    expect(removeFromSplit({ orientation: 'down', documentId: 'a', tabs: ['a'] }, 'a')).toBeNull()
  })
})

describe('TODO view', () => {
  it('matches only commented TODO-like markers and extracts the text', () => {
    const pattern = new RegExp(TODO_PATTERN)
    expect(pattern.test('\t// TODO: handle errors')).toBe(true)
    expect(pattern.test('# FIXME remove')).toBe(true)
    expect(pattern.test('todoList := []string{"TODO"}')).toBe(false)
    expect(todoItemFor(match('\t// TODO: handle errors'))).toMatchObject({ keyword: 'TODO', text: 'handle errors' })
    expect(todoItemFor(match('/* FIXME */'))).toMatchObject({ keyword: 'FIXME', text: '(no description)' })
  })
})

describe('local history', () => {
  it('shows short relative times', () => {
    const now = Date.parse('2026-09-28T12:00:00Z')
    expect(relativeTime('2026-09-28T11:59:40Z', now)).toBe('just now')
    expect(relativeTime('2026-09-28T11:57:00Z', now)).toBe('3 min ago')
    expect(relativeTime('2026-09-26T12:00:00Z', now)).toBe('2 d ago')
  })
})
