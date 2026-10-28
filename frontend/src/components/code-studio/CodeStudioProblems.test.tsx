import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { useIDEExtensionsStore } from '@/stores/ideExtensions'
import { CodeStudioProblems } from './CodeStudioProblems'

// Niente Monaco né AI in questo test: si verifica il raggruppamento per unità (6.5).
vi.mock('@/lib/aiAvailability', () => ({ isAICompanionAvailable: () => false }))
vi.mock('@/lib/monacoSetup', () => ({ monaco: {} }))
vi.mock('./codeStudioLanguageFeatures', () => ({ navigateToLocation: vi.fn() }))
vi.mock('./CodeStudioFileIcon', () => ({ CodeStudioFileIcon: () => null }))
vi.mock('./codeStudioAIFixRunner', () => ({ MAX_RESOLVE_ALL_FILES: 10, fixCodeStudioProblemWithAI: vi.fn(), resolveAllCodeStudioProblemsWithAI: vi.fn() }))
vi.mock('@/lib/code-studio/problemsMarkdown', () => ({ problemsToMarkdown: () => '' }))
vi.mock('@/lib/fileUtils', () => ({ saveTextFile: vi.fn() }))
// `renderToStaticMarkup` legge lo state iniziale dello store (snapshot del server): gli hook sono
// sostituiti da un selettore diretto su `getState()`, come negli altri test dei pannelli.
vi.mock('@/stores/codeStudio', async (original) => {
  const actual = await original<typeof import('@/stores/codeStudio')>()
  const store = actual.useCodeStudioStore
  return { ...actual, useCodeStudioStore: Object.assign((select: (state: ReturnType<typeof store.getState>) => unknown) => select(store.getState()), store) }
})
vi.mock('@/stores/codeStudioLsp', async (original) => {
  const actual = await original<typeof import('@/stores/codeStudioLsp')>()
  const store = actual.useCodeStudioLspStore
  return { ...actual, useCodeStudioLspStore: Object.assign((select: (state: ReturnType<typeof store.getState>) => unknown) => select(store.getState()), store) }
})

const sessionID = 's1'
const root = 'C:\\work\\shop'
useCodeStudioStore.setState({
  sessions: [{
    id: sessionID,
    project: {
      rootPath: root,
      units: [
        { language: 'go', kind: 'module', root },
        { language: 'python', kind: 'python-project', root: `${root}\\tools`, name: 'tools' },
      ],
    },
  }],
} as never)

const report = (path: string, relativePath: string, message: string) => ({
  uri: `file://${path}`,
  path,
  relativePath,
  diagnostics: [{ range: { startLine: 3, startColumn: 2, endLine: 3, endColumn: 9 }, severity: 1, message, source: 'gopls' }],
})

useCodeStudioLspStore.setState({
  diagnostics: {
    [sessionID]: {
      a: report(`${root}\\main.go`, 'main.go', 'declared and not used: x'),
      b: report(`${root}\\tools\\manage.py`, 'tools/manage.py', 'undefined name: y'),
      c: report('C:\\Go\\sdk\\src\\fmt\\print.go', '', 'cannot use z'),
    },
  },
} as never)
useIDEExtensionsStore.setState({ reports: {}, items: [], error: null })

describe('Problems grouped by build unit', () => {
  it('mostra un gruppo per unità con il linguaggio, i file esterni e il build', () => {
    const html = renderToStaticMarkup(
      <CodeStudioProblems
        sessionId={sessionID}
        buildProblems={[{ path: `${root}\\main.go`, line: 7, column: 2, text: 'undefined: foo' }]}
        onOpenBuildProblem={() => undefined}
      />,
    )
    expect(html).toContain('aria-label="Filter problems"')
    // Un gruppo per unità, con il badge del linguaggio.
    expect(html).toContain('>Go<')
    expect(html).toContain('>Python<')
    expect(html).toContain('Outside the project')
    // I file stanno dentro il loro gruppo, non in una lista unica.
    expect(html).toContain('main.go')
    expect(html).toContain('tools/manage.py')
    expect(html).toContain('print.go')
    expect(html).toContain('Last build output')
    // I file esterni non ricevono un badge di linguaggio inventato.
    expect(html).not.toContain('>Other<')
  })

  it('senza problemi non mostra né gruppi né filtro', () => {
    useCodeStudioLspStore.setState({ diagnostics: {} } as never)
    const html = renderToStaticMarkup(<CodeStudioProblems sessionId={sessionID} buildProblems={[]} onOpenBuildProblem={() => undefined} />)
    expect(html).toContain('No problems')
    expect(html).not.toContain('Filter problems')
  })
})
