import { describe, expect, it } from 'vitest'
import { findRunTargets, packageLenses, runCommandFor } from './goStudioRunTargets'

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

describe('packageLenses', () => {
  it('offers build, test and vet on the package clause, generate only when directives exist', () => {
    const plain = packageLenses('api/server.go', '// Package api.\npackage api\n')
    expect(plain.map((lens) => `${lens.line}:${lens.kind}`)).toEqual(['2:build', '2:test', '2:vet'])
    const generated = packageLenses('api/gen.go', 'package api\n\n//go:generate stringer -type=Kind\n')
    expect(generated.map((lens) => lens.kind)).toContain('generate')
  })

  it('ignores go.mod and files without a package clause', () => {
    expect(packageLenses('go.mod', 'module x\n')).toEqual([])
    expect(packageLenses('broken.go', '')).toEqual([])
  })
})
