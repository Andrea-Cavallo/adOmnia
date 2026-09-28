import { describe, expect, it } from 'vitest'
import { findRunTargets, runCommandFor } from './goStudioRunTargets'

describe('findRunTargets', () => {
  it('puts a play action on func main only in package main', () => {
    const main = 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("hi")\n}\n'
    expect(findRunTargets('cmd/api/main.go', main)).toEqual([{ line: 5, kind: 'main', name: 'main', packagePath: './cmd/api' }])
    expect(findRunTargets('main.go', main)[0].packagePath).toBe('.')
    expect(findRunTargets('lib/x.go', 'package lib\nfunc main() {}\n')).toEqual([])
  })

  it('finds tests, benchmarks, fuzz and examples in _test.go files', () => {
    const tests = 'package greet\n\nfunc TestHello(t *testing.T) {}\nfunc BenchmarkHello(b *testing.B) {}\nfunc FuzzHello(f *testing.F) {}\nfunc ExampleHello() {}\nfunc helper() {}\n'
    const targets = findRunTargets('greet/greet_test.go', tests)
    expect(targets.map((target) => `${target.line}:${target.kind}:${target.name}`)).toEqual([
      '3:test:TestHello', '4:benchmark:BenchmarkHello', '5:fuzz:FuzzHello', '6:example:ExampleHello',
    ])
  })

  it('ignores non-Go files', () => {
    expect(findRunTargets('README.md', 'func main() {}')).toEqual([])
  })
})

describe('runCommandFor', () => {
  it('runs exactly one test without cache and keeps benchmarks isolated', () => {
    expect(runCommandFor({ line: 3, kind: 'test', name: 'TestHello', packagePath: './greet' })).toEqual({
      kind: 'test', target: './greet', programArguments: ['-run', '^TestHello$', '-v', '-count=1'], label: 'Run TestHello',
    })
    expect(runCommandFor({ line: 4, kind: 'benchmark', name: 'BenchmarkHello', packagePath: '.' }).programArguments).toEqual(['-run', '^$', '-bench', '^BenchmarkHello$', '-benchmem', '-v'])
    expect(runCommandFor({ line: 5, kind: 'main', name: 'main', packagePath: './cmd/api' })).toMatchObject({ kind: 'run', target: './cmd/api' })
  })
})
