import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/monacoSetup', () => ({ monaco: {} }))
vi.mock('@/lib/goide-api', () => ({ subscribeGoIDEEvents: vi.fn(() => () => undefined) }))
vi.mock('@/lib/goide-lsp-api', () => ({}))
vi.mock('./goStudioLanguageFeatures', () => ({ prepareDocument: vi.fn(), toEditorRange: vi.fn() }))

import { refactoringCandidates } from './goStudioRefactorings'

const action = (kind: string, disabled = '') => ({ id: kind, title: kind, kind, disabled })

describe('Go Studio refactorings', () => {
  const offered = [action('refactor.extract.function'), action('refactor.extract.method'), action('refactor.extract.variable'), action('refactor.extract.toNewFile'), action('refactor.inline.call', 'not a call')]

  it('keeps only the gopls actions that implement the requested refactoring', () => {
    expect(refactoringCandidates(offered, 'extractFunction').map((item) => item.kind)).toEqual(['refactor.extract.function', 'refactor.extract.method'])
    expect(refactoringCandidates(offered, 'extractVariable').map((item) => item.kind)).toEqual(['refactor.extract.variable'])
    expect(refactoringCandidates(offered, 'moveToNewFile').map((item) => item.kind)).toEqual(['refactor.extract.toNewFile'])
  })

  it('never offers disabled or missing actions', () => {
    expect(refactoringCandidates(offered, 'inline')).toEqual([])
    expect(refactoringCandidates(offered, 'extractConstant')).toEqual([])
  })
})
