import { describe, expect, it } from 'vitest'
import { sourceDeferredCallsBefore } from './goStudioDeferredCalls'

describe('Go Studio deferred call source inspector', () => {
  it('lists earlier defer statements in the current function', () => {
    const source = `package main

func run() {
  defer close(done)
  defer func() { cleanup() }()
  work()
}`
    expect(sourceDeferredCallsBefore(source, 6)).toEqual([
      { line: 4, expression: 'close(done)' },
      { line: 5, expression: 'func() { cleanup() }()' },
    ])
  })

  it('does not leak defers from the previous function', () => {
    const source = `func first() { defer close(one) }
func second() {
  defer close(two)
  work()
}`
    expect(sourceDeferredCallsBefore(source, 4)).toEqual([{ line: 3, expression: 'close(two)' }])
  })
})
