import { describe, expect, it } from 'vitest'
import { evaluateWhen, type CodeStudioWhenContext } from './when'

const context = (terms: Record<string, boolean>): CodeStudioWhenContext => terms

describe('when expressions', () => {
  it('is true without a condition', () => {
    expect(evaluateWhen(undefined, {})).toBe(true)
    expect(evaluateWhen('   ', {})).toBe(true)
  })

  it('matches a single term', () => {
    expect(evaluateWhen('editor', context({ editor: true }))).toBe(true)
    expect(evaluateWhen('editor', context({ editor: false }))).toBe(false)
    expect(evaluateWhen('editor', context({}))).toBe(false)
  })

  it('requires every operand of &&', () => {
    const when = 'editor && vim.normal'
    expect(evaluateWhen(when, context({ editor: true, 'vim.normal': true }))).toBe(true)
    expect(evaluateWhen(when, context({ editor: true, 'vim.normal': false }))).toBe(false)
    expect(evaluateWhen(when, context({ 'vim.normal': true }))).toBe(false)
  })

  it('accepts either side of ||, with && binding tighter', () => {
    expect(evaluateWhen('editor || terminal', context({ terminal: true }))).toBe(true)
    expect(evaluateWhen('editor || terminal', context({}))).toBe(false)
    expect(evaluateWhen('editor && vim.normal || terminal', context({ terminal: true }))).toBe(true)
    expect(evaluateWhen('editor && vim.normal || terminal', context({ editor: true }))).toBe(false)
    expect(evaluateWhen('editor && vim.normal || terminal', context({ editor: true, 'vim.normal': true }))).toBe(true)
  })

  it('negates terms with !', () => {
    expect(evaluateWhen('!input', context({}))).toBe(true)
    expect(evaluateWhen('!input', context({ input: true }))).toBe(false)
    expect(evaluateWhen('editor && !vim', context({ editor: true }))).toBe(true)
    expect(evaluateWhen('editor && !vim', context({ editor: true, vim: true }))).toBe(false)
  })

  it('treats unknown terms as false', () => {
    expect(evaluateWhen('quantum', context({}))).toBe(false)
    expect(evaluateWhen('!quantum', context({}))).toBe(true)
    expect(evaluateWhen('&& ||', context({}))).toBe(false)
  })
})
