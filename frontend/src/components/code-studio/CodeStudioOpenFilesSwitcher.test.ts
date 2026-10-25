import { describe, expect, it } from 'vitest'
import type { GoIDEEditorDocument } from '@/stores/codeStudio'
import { filterOpenFiles } from './CodeStudioOpenFilesSwitcher'
import { shortTabName } from './CodeStudioEditorTabs'

const doc = (id: string, relativePath: string) => ({ dirty: false, document: { id, relativePath, name: relativePath.split('/').pop() } }) as unknown as GoIDEEditorDocument

describe('open files switcher', () => {
  const docs = [doc('a', 'cmd/main.go'), doc('b', 'internal/api/server.go'), doc('c', 'web/main.ts')]

  it('filters by path and keeps the active file last', () => {
    expect(filterOpenFiles(docs, 'MAIN', 'a').map((item) => item.document.id)).toEqual(['c', 'a'])
    expect(filterOpenFiles(docs, '', 'b').map((item) => item.document.id)).toEqual(['a', 'c', 'b'])
    expect(filterOpenFiles(docs, 'nope', 'a')).toEqual([])
  })

  it('shortens long tab names keeping the extension', () => {
    expect(shortTabName('main.go')).toBe('main.go')
    const short = shortTabName('CodeStudioOpenFilesSwitcher.test.ts')
    expect(short.length).toBe(24)
    expect(short.endsWith('.ts')).toBe(true)
    expect(short).toContain('…')
  })
})
