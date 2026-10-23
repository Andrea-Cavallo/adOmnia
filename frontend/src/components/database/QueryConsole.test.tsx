import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryConsole, literalBody } from './QueryConsole'
import { QueryEditor } from './QueryEditor'
import { interpret } from './queryInterpreter'
import { blankTab } from './dbShared'

const noop = () => undefined

function consoleHtml(driver: string, extra: Partial<Parameters<typeof QueryConsole>[0]> = {}) {
  return renderToStaticMarkup(
    <QueryConsole
      driver={driver} targets={['utenti', 'ordini']} target="" onTarget={noop} columns={[]} database="" recent={[]} saved={[]} currentQuery="" onSaveCurrent={noop} onRenameSaved={noop} onRemoveSaved={noop} onTogglePersonal={noop} onExportSaved={noop} onImportSaved={noop}
      onInsert={noop} onRun={noop} onPickQuery={noop} onClose={noop} {...extra}
    />,
  )
}

describe('QueryConsole', () => {
  it('lists categories with counts and risk badges for the driver', () => {
    const html = consoleHtml('mongodb')
    expect(html).toContain('aria-label="Query console"')
    expect(html).toContain('Search')
    expect(html).toContain('Aggregate')
    expect(html).toContain('Find documents')
    expect(html).toContain('Read')
  })

  it('names Redis categories after what they do to keys', () => {
    const html = consoleHtml('redis', { targets: [] })
    expect(html).toContain('Read keys')
    expect(html).not.toContain('Aggregate')
  })

  it('lets only read templates run, and only with a target', () => {
    expect(consoleHtml('postgres')).toContain('title="Choose a target first"')
    expect(consoleHtml('postgres', { target: 'utenti' })).toContain('title="Run with the default values"')
  })

  it('shows the saved queries view tab', () => {
    expect(consoleHtml('sqlite', { currentQuery: 'SELECT 1' })).toContain('Saved')
  })
})

describe('QueryEditor interpretation strip', () => {
  const render = (query: string) => {
    const tab = blankTab('Query 1', query)
    return renderToStaticMarkup(
      <QueryEditor
        tabs={[tab]} activeTabId={tab.id} query={query} isMongo={false} dangerous={false} varsCount={0} limit={200} timeoutMs={30000}
        running={false} focusToken={0} schema={{}} onSelectTab={noop} onAddTab={noop} onCloseTab={noop} onChangeQuery={noop}
        onSetLimit={noop} onSetTimeout={noop} onRun={noop} canAnalyze={false} onFormat={noop} onSave={noop}
        driver="postgres" interpretation={query ? interpret('postgres', query) : null} jsonContext={null} columnTypes={{}}
        snippetRequest={null} onSnippetApplied={noop} consoleOpen={false} onToggleConsole={noop} aiAvailable={false} aiOpen={false} onToggleAi={noop} onRunScript={noop}
      />,
    )
  }

  it('explains an unfiltered delete, flags it and offers the fixes', () => {
    const html = render('DELETE FROM utenti')
    expect(html).toContain('Destructive')
    expect(html).toContain('Deletes all rows from')
    expect(html).toContain('no filter')
    expect(html).toContain('Add WHERE')
    expect(html).toContain('Count first')
  })

  it('shows nothing for an empty editor', () => {
    expect(render('')).not.toContain('aria-live="polite"')
  })
})

describe('literalBody', () => {
  it('escapes the dollar sign and the backslash that precedes it, so a template never becomes a snippet variable', () => {
    expect(literalBody('SELECT $1')).toBe(String.raw`SELECT \$1`)
    expect(literalBody(String.raw`path\$x`)).toBe(String.raw`path\\\$x`)
    expect(literalBody('plain')).toBe('plain')
  })
})
