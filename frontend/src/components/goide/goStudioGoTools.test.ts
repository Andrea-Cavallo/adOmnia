import { describe, expect, it } from 'vitest'
import { defaultGoToolTarget } from './goStudioGoTools'

describe('Go Tools defaults', () => {
  it('targets the current package for vet, generate and fix', () => {
    expect(defaultGoToolTarget('vet', { packageTarget: './geom', word: '', lineText: '' })).toBe('./geom')
    expect(defaultGoToolTarget('fix', { packageTarget: '', word: '', lineText: '' })).toBe('./...')
  })

  it('reads the module of a go.mod require line or an import for go mod why', () => {
    expect(defaultGoToolTarget('modWhy', { packageTarget: '.', word: 'text', lineText: '\tgolang.org/x/text v0.14.0 // indirect' })).toBe('golang.org/x/text')
    expect(defaultGoToolTarget('modWhy', { packageTarget: '.', word: '', lineText: '\t"github.com/google/uuid"' })).toBe('github.com/google/uuid')
    expect(defaultGoToolTarget('modWhy', { packageTarget: '.', word: 'x', lineText: 'x := 1' })).toBe('')
  })

  it('documents the symbol under the caret or the import on the line', () => {
    expect(defaultGoToolTarget('doc', { packageTarget: '.', word: 'http.Client', lineText: 'var c http.Client' })).toBe('http.Client')
    expect(defaultGoToolTarget('doc', { packageTarget: '.', word: '', lineText: '\t"net/http"' })).toBe('net/http')
  })
})
