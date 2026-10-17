import { describe, expect, it } from 'vitest'
import { findJavaTargets, javaTestRequest } from './codeStudioJavaTargets'

describe('findJavaTargets', () => {
  it('finds main and qualifies the class with its package', () => {
    const text = 'package it.acme;\n\npublic class Hello {\n    public static void main(String[] args) {}\n}\n'
    expect(findJavaTargets('src/main/java/it/acme/Hello.java', text)).toEqual([{ line: 4, kind: 'java-main', name: '', className: 'it.acme.Hello', relativePath: 'src/main/java/it/acme/Hello.java' }])
  })

  it('finds JUnit tests even with annotations between @Test and the method', () => {
    const text = 'package a;\nclass MathTest {\n  @Test void adds() {}\n  @Test\n  @DisplayName("x")\n  public void breaks() {}\n  void helper() {}\n}\n'
    expect(findJavaTargets('MathTest.java', text).map((t) => [t.line, t.name, t.className])).toEqual([[3, 'adds', 'a.MathTest'], [4, 'breaks', 'a.MathTest']])
  })

  it('ignores other files', () => {
    expect(findJavaTargets('a.go', 'public static void main(String[] a)')).toEqual([])
  })
})

describe('javaTestRequest', () => {
  it('runs one method in the innermost Java unit that contains the file', () => {
    const project = { rootPath: 'C:/w/shop', units: [{ language: 'java', root: 'C:/w/shop' }, { language: 'java', root: 'C:/w/shop/billing' }, { language: 'go', root: 'C:/w/shop/go' }] }
    const target = { line: 3, kind: 'java-test' as const, name: 'adds', className: 'a.MathTest', relativePath: 'billing/src/test/java/a/MathTest.java' }
    expect(javaTestRequest('s1', project, target)).toEqual({ sessionId: 's1', language: 'java', workingDirectory: 'billing', packages: ['src/test/java/a/MathTest.java'], run: 'adds' })
  })
})
