import { describe, expect, it } from 'vitest'
import { parseConsoleLocation } from './consoleLocation'

describe('parseConsoleLocation', () => {
  it('reads Go, Gradle javac and Maven error locations', () => {
    expect(parseConsoleLocation('./geom/area.go:12:5: undefined: foo')).toEqual({ path: './geom/area.go', line: 12, column: 5 })
    expect(parseConsoleLocation('/p/src/main/java/a/Foo.java:12: error: cannot find symbol')).toEqual({ path: '/p/src/main/java/a/Foo.java', line: 12, column: 1 })
    expect(parseConsoleLocation('[ERROR] /p/src/main/java/a/Foo.java:[12,34] cannot find symbol')).toEqual({ path: '/p/src/main/java/a/Foo.java', line: 12, column: 34 })
    expect(parseConsoleLocation('[ERROR] C:\\p\\src\\Foo.java:[7] error')).toEqual({ path: 'C:/p/src/Foo.java', line: 7, column: 1 })
    expect(parseConsoleLocation('e: file:///p/Main.kt:3:9 Unresolved reference')?.line).toBe(3)
  })
  it('ignores host:port and lines without a source file', () => {
    expect(parseConsoleLocation('listening on example.com:443')).toBeNull()
    expect(parseConsoleLocation('[INFO] BUILD FAILURE')).toBeNull()
  })
})
