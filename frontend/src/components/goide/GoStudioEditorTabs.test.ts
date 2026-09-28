import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/goide-api', () => ({ subscribeGoIDEEvents: vi.fn(() => () => undefined) }))
vi.mock('@/lib/goide-lsp-api', () => ({ openExternalDocument: vi.fn() }))

import type { GoIDEEditorDocument } from '@/stores/goide'
import { documentsToClose, orderTabs } from './GoStudioEditorTabs'

const doc = (id: string) => ({ document: { id } } as unknown as GoIDEEditorDocument)

describe('Go Studio editor tabs', () => {
  const documents = [doc('a'), doc('b'), doc('c'), doc('d')]
  const pinned = { c: true }

  it('keeps pinned tabs first in opening order', () => {
    expect(orderTabs(documents, pinned).map((item) => item.document.id)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('never closes pinned tabs with bulk actions', () => {
    const ordered = orderTabs(documents, pinned)
    const ids = (action: Parameters<typeof documentsToClose>[0], target: string) => documentsToClose(action, ordered, doc(target), pinned).map((item) => item.document.id)
    expect(ids('closeOthers', 'a')).toEqual(['b', 'd'])
    expect(ids('closeRight', 'a')).toEqual(['b', 'd'])
    expect(ids('closeAll', 'a')).toEqual(['a', 'b', 'd'])
    expect(ids('close', 'c')).toEqual(['c'])
  })
})
