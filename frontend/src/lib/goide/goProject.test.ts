import { describe, expect, it } from 'vitest'
import { goProjectLayout } from './goProject'

describe('goProjectLayout', () => {
  it('derives modules, go.work and loose folders from the Go units only', () => {
    const layout = goProjectLayout({
      rootPath: 'C:\\work\\mono',
      units: [
        { language: 'go', kind: 'module', root: 'C:\\work\\mono', name: 'example.com/mono', manifest: 'C:\\work\\mono\\go.mod' },
        { language: 'go', kind: 'module', root: 'C:\\work\\mono\\tools', name: 'example.com/tools', manifest: 'C:\\work\\mono\\tools\\go.mod' },
        { language: 'go', kind: 'workspace', root: 'C:\\work\\mono', manifest: 'C:\\work\\mono\\go.work' },
        { language: 'go', kind: 'loose', root: 'C:\\work\\mono\\scripts\\x' },
        { language: 'java', kind: 'maven', root: 'C:\\work\\mono\\api', manifest: 'C:\\work\\mono\\api\\pom.xml' },
      ],
    })
    expect(layout.modules.map((module) => module.modulePath)).toEqual(['example.com/mono', 'example.com/tools'])
    expect(layout.goModPath).toBe('C:\\work\\mono\\go.mod')
    expect(layout.goWorkPath).toBe('C:\\work\\mono\\go.work')
    expect(layout.looseGoDirs).toEqual(['scripts/x'])
  })

  it('reports folder mode when there is no Go unit', () => {
    expect(goProjectLayout({ rootPath: '/p', units: [] })).toEqual({ goModPath: '', goWorkPath: '', modules: [], looseGoDirs: [] })
  })
})
