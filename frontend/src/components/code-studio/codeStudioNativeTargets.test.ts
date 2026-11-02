import { describe, expect, it } from 'vitest'
import { findNativeTargets } from './codeStudioNativeTargets'
import { findRunTargets } from './codeStudioRunTargets'

describe('findNativeTargets', () => {
  it('puts the play on main in C and C++ files', () => {
    expect(findNativeTargets('helloworld.c', '#include <stdio.h>\n\nmain() {\n}\n')).toEqual([
      { line: 3, kind: 'native-main', name: 'main', directory: '', relativePath: 'helloworld.c', file: 'helloworld.c' },
    ])
    expect(findNativeTargets('data_structures-I/06-LList/main.cpp', '#include "LList.h"\n\nint main() {\n}\n')).toEqual([
      { line: 3, kind: 'native-main', name: 'main', directory: 'data_structures-I/06-LList', relativePath: 'data_structures-I/06-LList/main.cpp', file: 'main.cpp' },
    ])
  })

  it('ignores calls, headers and other files', () => {
    expect(findNativeTargets('driver.cpp', 'void run() {\n  main();\n}\n')).toEqual([])
    expect(findNativeTargets('stack.h', 'int main();\n')).toEqual([])
    expect(findNativeTargets('README.md', 'main()')).toEqual([])
  })

  it('is wired into the gutter run targets', () => {
    expect(findRunTargets('src/app.cpp', 'int main(int argc, char** argv) { return 0; }')).toHaveLength(1)
    expect(findRunTargets('src/app.cpp', 'int helper() { return 0; }')).toEqual([])
  })
})
