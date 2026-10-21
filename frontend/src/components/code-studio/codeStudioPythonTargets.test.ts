import { describe, expect, it } from 'vitest'
import { findPythonTargets } from './codeStudioPythonTargets'
import { findRunTargets } from './codeStudioRunTargets'

describe('findPythonTargets', () => {
  it('puts the play on the __main__ guard when present', () => {
    expect(findPythonTargets('app/main.py', 'import os\n\nif __name__ == "__main__":\n    run()\n')).toEqual([{ line: 3, kind: 'python-main', name: 'main.py', relativePath: 'app/main.py' }])
  })

  it('falls back to the first line for scripts without a guard', () => {
    expect(findPythonTargets('gen.py', 'app = App()\napp.window.mainloop()\n')[0]).toMatchObject({ line: 1, name: 'gen.py' })
  })

  it('ignores other files and is wired into findRunTargets', () => {
    expect(findPythonTargets('a.txt', 'x')).toEqual([])
    expect(findRunTargets('gen.py', 'x = 1')).toHaveLength(1)
  })
})
