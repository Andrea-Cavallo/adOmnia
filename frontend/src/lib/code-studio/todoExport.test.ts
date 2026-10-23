import { describe, expect, it } from 'vitest'
import { todosToMarkdown } from './todoExport'

const units = [
  { root: 'C:/p/services/auth', name: 'example.com/auth', kind: 'module' },
  { root: 'C:/p/services/billing', name: 'example.com/billing', kind: 'module' },
  { root: 'C:/p', kind: 'workspace' },
]
const items = [
  { keyword: 'TODO', text: 'rotate keys', relativePath: 'services/auth/key.go', line: 9 },
  { keyword: 'FIXME', text: 'a | b', relativePath: 'services/billing/pay.go', line: 3 },
  { keyword: 'TODO', text: 'script', relativePath: 'tools/run.sh', line: 1 },
]

describe('todosToMarkdown', () => {
  const md = todosToMarkdown(items, { projectName: 'shop', projectRoot: 'C:\\p', units, date: new Date('2026-10-16') })
  it('splits by module with a summary', () => {
    expect(md).toContain('# TODO report — shop')
    expect(md).toContain('| example.com/auth | 1 | TODO 1 |')
    expect(md).toContain('## example.com/billing')
    expect(md).toContain('## tools')
  })
  it('groups folders without a manifest by service folder', () => {
    const loose = [
      { keyword: 'TODO', text: 'a', relativePath: 'services/users/main.go', line: 1 },
      { keyword: 'TODO', text: 'b', relativePath: 'services/orders/x.go', line: 2 },
      { keyword: 'TODO', text: 'c', relativePath: 'main.go', line: 3 },
    ]
    const out = todosToMarkdown(loose, { projectName: 'p', projectRoot: '/p', units: [] })
    expect(out).toContain('## services/users')
    expect(out).toContain('## services/orders')
    expect(out).toContain('## (outside any module)')
  })
  it('lists files and escapes pipes', () => {
    expect(md).toContain('### `services/auth/key.go`')
    expect(md).toContain('- [ ] **FIXME** (L3) a \\| b')
  })
  it('escapes a backslash before escaping the pipe that follows it', () => {
    const tricky = [{ keyword: 'TODO', text: 'a\\|b', relativePath: 'tools/run.sh', line: 1 }]
    const out = todosToMarkdown(tricky, { projectName: 'p', projectRoot: '/p', units: [] })
    expect(out).toContain(String.raw`a\\\|b`)
  })
  it('handles empty input', () => {
    expect(todosToMarkdown([], { projectName: 'x', projectRoot: '/x', units: [] })).toContain('No TODO')
  })
})
