import { describe, expect, it } from 'vitest'
import type { GoIDELanguageServerProgress } from '@/lib/code-studio-lsp-api'
import { nextLanguageServerProgress } from './lspProgress'

const apply = (events: GoIDELanguageServerProgress[]) => events.reduce<GoIDELanguageServerProgress | null>((state, event) => nextLanguageServerProgress(state, event), null)

describe('language server progress', () => {
  it('shows a unit of work from begin to end', () => {
    expect(apply([{ token: 'a', kind: 'begin', title: 'Loading packages' }, { token: 'a', kind: 'report', percentage: 50 }]))
      .toMatchObject({ token: 'a', title: 'Loading packages', percentage: 50 })
    expect(apply([{ token: 'a', kind: 'begin', title: 'Loading' }, { token: 'a', kind: 'end' }])).toBeNull()
  })

  it('never brings back a finished unit of work from a late report', () => {
    expect(apply([{ token: 'a', kind: 'begin' }, { token: 'a', kind: 'end' }, { token: 'a', kind: 'report', percentage: 90 }])).toBeNull()
    expect(apply([{ token: 'x', kind: 'report', message: 'orphan' }])).toBeNull()
  })

  it('keeps the shown work when another token ends', () => {
    expect(apply([{ token: 'a', kind: 'begin', title: 'A' }, { token: 'b', kind: 'end' }])).toMatchObject({ token: 'a' })
  })
})
