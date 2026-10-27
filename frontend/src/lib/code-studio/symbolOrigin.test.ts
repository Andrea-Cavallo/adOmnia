import { describe, expect, it } from 'vitest'
import { symbolOrigin } from './symbolOrigin'
const project = {
  rootPath: 'C:/repo',
  units: [
    {
      language: 'go',
      kind: 'module',
      root: 'C:/repo',
      name: 'example.com/app',
    },
    {
      language: 'go',
      kind: 'module',
      root: 'C:/repo/payments',
      name: 'example.com/payments',
    },
  ],
}
describe('Symbol Origin Lens', () => {
  it('uses the deepest actual Go module, with Windows separators and package suffix', () => {
    expect(
      symbolOrigin(
        project,
        'C:\\repo\\payments\\internal\\order\\service.go',
        'go',
        '',
      ),
    ).toBe('example.com/payments/internal/order')
    expect(
      symbolOrigin(project, 'C:/repository/service.go', 'go', ''),
    ).toBeNull()
  })
  it('extracts the Java package, ignoring comments and string literals', () => {
    expect(
      symbolOrigin(
        project,
        'C:/repo/A.java',
        'java',
        '/* package fake; */\npackage com.company.order;\nclass A {}',
      ),
    ).toBe('com.company.order')
    expect(
      symbolOrigin(
        project,
        'C:/repo/A.java',
        'java',
        'class A { String x = "package fake;"; }',
      ),
    ).toBe('(default package)')
  })
  it('keeps the TypeScript module path relative to the workspace without changing the source', () => {
    expect(
      symbolOrigin(project, 'C:/repo/src/order.ts', 'typescript', ''),
    ).toBe('src/order.ts')
    expect(
      symbolOrigin(project, 'C:/other/order.ts', 'typescript', ''),
    ).toBeNull()
    expect(symbolOrigin(project, 'C:/repo/a.txt', 'plaintext', '')).toBeNull()
  })
})
