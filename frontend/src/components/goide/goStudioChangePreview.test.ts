import { describe, expect, it } from 'vitest'
import type { GoIDEFileChange } from '@/lib/goide-lsp-api'
import { changedLines, selectHunks, selectableHunks } from './goStudioChangePreview'

const change = (newContent: string, edits: GoIDEFileChange['edits']) => ({ uri: 'file:///m.go', path: '/m.go', relativePath: 'm.go', newContent, edits } as GoIDEFileChange)
const at = (line: number, column: number, endLine = line, endColumn = column) => ({ startLine: line, startColumn: column, endLine, endColumn })

describe('changedLines', () => {
  it('shows every inserted line of generated code', () => {
    const result = changedLines(change('type B struct{}\n\nfunc (b *B) Read() {}\n\nfunc (b *B) Write() {}\n', [
      { range: at(1, 16), text: '\n\nfunc (b *B) Read() {}\n\nfunc (b *B) Write() {}' },
    ]))
    expect(result.map((row) => row.text)).toEqual(['type B struct{}', '', 'func (b *B) Read() {}', '', 'func (b *B) Write() {}'])
  })

  it('shows the final line of renames and marks separate hunks', () => {
    const result = changedLines(change('a := hi\nx\ny\nb := hi\n', [
      { range: at(1, 6, 1, 8), text: 'hi' },
      { range: at(4, 6, 4, 8), text: 'hi' },
    ]))
    expect(result).toEqual([{ line: 1, text: 'a := hi', hunkStart: false, kind: 'added', hunk: 0 }, { line: 4, text: 'b := hi', hunkStart: true, kind: 'added', hunk: 1 }])
  })

  it('accounts for lines removed by earlier edits', () => {
    // originale "one\ntwo\nthree\nfive\n": via le righe 2-3, poi five → four sulla riga 4 originale.
    const result = changedLines(change('one\nfour\n', [
      { range: at(1, 4, 3, 6), text: '' },
      { range: at(4, 1, 4, 5), text: 'four' },
    ]))
    expect(result.map((row) => row.line)).toEqual([1, 2])
  })

  it('shows removed lines next to their replacement when the original is known', () => {
    const file = { ...change('package main\n\n\nfunc main() {}\n', [{ range: at(3, 1, 6, 1), text: '' }]), originalContent: 'package main\n\nfunc report() string {\n\treturn ""\n}\n\nfunc main() {}\n' }
    const result = changedLines(file)
    expect(result.filter((row) => row.kind === 'removed').map((row) => row.text)).toEqual(['func report() string {', '\treturn ""', '}'])
    expect(result.filter((row) => row.kind === 'added')).toEqual([])
  })

  it('shows a created file entirely as added', () => {
    const result = changedLines({ ...change('package main\n\nfunc a() {}', []), created: true })
    expect(result.every((row) => row.kind === 'added')).toBe(true)
    expect(result).toHaveLength(3)
  })
})

describe('selectHunks', () => {
  const original = 'a := ho\nx\ny\nb := ho\n'
  const file = { ...change('a := hi\nx\ny\nb := hi\n', [
    { range: at(1, 6, 1, 8), text: 'hi' },
    { range: at(4, 6, 4, 8), text: 'hi' },
  ]), originalContent: original }

  it('applies only the chosen hunk and recomputes the file', () => {
    expect(selectableHunks(file)).toBe(2)
    const second = selectHunks(file, new Set([1]))!
    expect(second.edits).toHaveLength(1)
    expect(second.newContent).toBe('a := ho\nx\ny\nb := hi\n')
  })

  it('keeps the whole file when every hunk is chosen and drops it when none is', () => {
    expect(selectHunks(file, new Set([0, 1]))).toBe(file)
    expect(selectHunks(file, new Set())).toBeNull()
  })

  it('treats files without original text as a single unit', () => {
    const created = { ...change('package x\n', []), created: true }
    expect(selectableHunks(created)).toBe(0)
    expect(selectHunks(created, new Set())).toBe(created)
  })
})
