import { describe, expect, it } from 'vitest'
import { buildProblemMatchesQuery, groupProblemReports, matchesProblemQuery, problemCount, reportMatchesQuery } from './problemGroups'
import type { ProjectRef } from './projectUnits'

const project: ProjectRef = {
  rootPath: 'C:\\work\\shop',
  units: [
    { language: 'go', kind: 'module', root: 'C:\\work\\shop' },
    { language: 'python', kind: 'python-project', root: 'C:\\work\\shop\\tools', name: 'tools' },
  ],
}

const report = (path: string, count = 1) => ({
  path,
  relativePath: path.replace('C:\\work\\shop\\', '').replace(/\\/g, '/'),
  diagnostics: Array.from({ length: count }, (_, index) => ({ index })),
})

describe('groupProblemReports', () => {
  it('raggruppa per unità nell’ordine del progetto e mette i file esterni in fondo', () => {
    const groups = groupProblemReports(project, [
      report('C:\\work\\shop\\main.go', 2),
      report('C:\\work\\shop\\tools\\manage.py'),
      report('C:\\Go\\sdk\\src\\fmt\\print.go'),
    ])
    expect(groups.map((group) => group.key)).toEqual(['go|C:\\work\\shop', 'python|C:\\work\\shop\\tools', ''])
    expect(groups.map((group) => group.count)).toEqual([2, 1, 1])
    expect(groups[1].label).toBe('tools')
    expect(groups[2].language).toBeNull()
  })

  it('non crea gruppi vuoti e non perde file', () => {
    const groups = groupProblemReports(project, [report('C:\\work\\shop\\tools\\manage.py')])
    expect(groups).toHaveLength(1)
    expect(groups[0].language?.name).toBe('Python')
    expect(problemCount(groups)).toBe(1)
  })

  it('un progetto senza unità produce un solo gruppo', () => {
    const groups = groupProblemReports({ rootPath: 'C:\\work\\shop', units: [] }, [report('C:\\work\\shop\\main.go')])
    expect(groups.map((group) => group.key)).toEqual([''])
  })

  it('mette insieme i file di una unità di workspace e di un crate', () => {
    const rust: ProjectRef = {
      rootPath: 'C:\\r',
      units: [
        { language: 'rust', kind: 'cargo-workspace', root: 'C:\\r' },
        { language: 'rust', kind: 'cargo-package', root: 'C:\\r\\api', name: 'api' },
      ],
    }
    const groups = groupProblemReports(rust, [report('C:\\r\\api\\src\\main.rs'), report('C:\\r\\libs\\core.rs')])
    expect(groups.map((group) => group.key)).toEqual(['rust|C:\\r', 'rust|C:\\r\\api'])
    expect(groups.map((group) => group.label)).toEqual(['r', 'api'])
  })
})

describe('matchesProblemQuery', () => {
  it('filtra per messaggio, sorgente o percorso, senza case', () => {
    expect(matchesProblemQuery('', 'unused variable')).toBe(true)
    expect(matchesProblemQuery('  ', 'unused variable')).toBe(true)
    expect(matchesProblemQuery('UNUSED', 'unused variable')).toBe(true)
    expect(matchesProblemQuery('gopls', undefined, 'gopls')).toBe(true)
    expect(matchesProblemQuery('main.go', 'oops', 'main.go')).toBe(true)
    expect(matchesProblemQuery('typescript', 'oops', 'main.go')).toBe(false)
  })

  it('un file resta se il percorso o uno dei suoi diagnostici corrisponde', () => {
    const file = {
      path: 'C:\\work\\shop\\main.go',
      relativePath: 'main.go',
      diagnostics: [
        { message: 'declared and not used: x', source: 'gopls', severity: 1 },
        { message: 'shadowed variable', source: 'staticcheck', severity: 2 },
      ],
    }
    expect(reportMatchesQuery(file, '')).toBe(true)
    expect(reportMatchesQuery(file, 'main.go')).toBe(true)
    expect(reportMatchesQuery(file, 'staticcheck')).toBe(true)
    expect(reportMatchesQuery(file, 'warning')).toBe(true)
    expect(reportMatchesQuery(file, 'undefined')).toBe(false)
  })

  it('i problemi di build si filtrano su testo e percorso', () => {
    const problem = { text: 'main.go:7:2: undefined: foo', path: 'C:\\work\\shop\\main.go' }
    expect(buildProblemMatchesQuery(problem, '')).toBe(true)
    expect(buildProblemMatchesQuery(problem, 'undefined')).toBe(true)
    expect(buildProblemMatchesQuery(problem, 'shop')).toBe(true)
    expect(buildProblemMatchesQuery(problem, 'unused')).toBe(false)
  })
})
