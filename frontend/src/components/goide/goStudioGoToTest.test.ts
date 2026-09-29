import { describe, expect, it } from 'vitest'
import { declarationLine, functionAtLine, subjectOfTest, testCounterpart, testNameFor } from './goStudioGoToTest'

const source = [
  'package shop', '', 'type Order struct{}', '',
  'func (o *Order) Describe(prefix string) string {', '\treturn prefix', '}', '',
  'func discount(price float64) float64 {', '\treturn price', '}', '',
  'var x = 1',
].join('\n')

describe('Go to Test', () => {
  it('maps files to their test files and back', () => {
    expect(testCounterpart('shop/order.go')).toBe('shop/order_test.go')
    expect(testCounterpart('shop/order_test.go')).toBe('shop/order.go')
    expect(testCounterpart('README.md')).toBeNull()
  })

  it('finds the function around the caret and stays out of other code', () => {
    expect(functionAtLine(source, 6)).toEqual({ receiver: 'Order', name: 'Describe' })
    expect(functionAtLine(source, 9)).toEqual({ receiver: '', name: 'discount' })
    expect(functionAtLine(source, 13)).toBeNull()
    expect(functionAtLine(source, 3)).toBeNull()
  })

  it('uses gopls test names in both directions', () => {
    expect(testNameFor({ receiver: 'Order', name: 'Describe' })).toBe('TestOrder_Describe')
    expect(testNameFor({ receiver: '', name: 'discount' })).toBe('TestDiscount')
    expect(subjectOfTest('TestOrder_Describe')).toContainEqual({ receiver: 'Order', name: 'Describe' })
    expect(subjectOfTest('BenchmarkDiscount')).toContainEqual({ receiver: '', name: 'discount' })
    expect(subjectOfTest('helper')).toEqual([])
  })

  it('locates declarations by name and receiver', () => {
    expect(declarationLine(source, { receiver: 'Order', name: 'Describe' })).toBe(5)
    expect(declarationLine(source, { receiver: '', name: 'Describe' })).toBeNull()
    expect(declarationLine(source, { receiver: '', name: 'discount' })).toBe(9)
  })
})
