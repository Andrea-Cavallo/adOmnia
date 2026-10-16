import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

/**
 * DB-1: le celle annidate erano illeggibili (`Object (2 fields)`, `[object Object]`)
 * e i risultati non si aprivano davvero a schermo intero. Contratti sul codice:
 * il rendering visivo non è verificabile da jsdom.
 */
describe('Database grids show nested values (DB-1)', () => {
  it('renders containers as readable previews that open the inspector', () => {
    const cell = source('src/components/database/ValueCell.tsx')
    const results = source('src/components/database/ResultsView.tsx')
    const mongo = source('src/components/database/mongo/MongoWorkspace.tsx')
    expect(cell).toContain('previewValue')
    expect(cell).toContain('normalizeCell')
    expect(results).toContain('<ValueCell')
    expect(mongo).toContain('<ValueCell')
  })

  it('opens the whole row from the row number and can copy its JSON', () => {
    const results = source('src/components/database/ResultsView.tsx')
    const mongo = source('src/components/database/mongo/MongoWorkspace.tsx')
    const inspector = source('src/components/database/ValueInspector.tsx')
    expect(results).toContain('Open row view')
    expect(mongo).toContain('Open document view')
    expect(inspector).toContain('Copy row JSON')
    expect(inspector).toContain('role="dialog"')
  })

  it('takes over the whole window and leaves with Esc or Ctrl+Shift+F', () => {
    const fullscreen = source('src/components/database/useResultsFullscreen.ts')
    expect(fullscreen).toContain("event.key === 'Escape'")
    expect(fullscreen).toContain("event.key.toLowerCase() === 'f'")
    expect(fullscreen).toContain('focused()')
    expect(source('src/components/database/ResultsView.tsx')).toContain("expanded && 'fixed inset-0 z-[240]'")
    expect(source('src/components/database/mongo/MongoWorkspace.tsx')).toContain("expanded && 'fixed inset-0 z-[240]'")
  })

  it('exports readable JSON and CSV cells', () => {
    const panel = source('src/components/database/DatabasePanel.tsx')
    const shared = source('src/components/database/dbShared.tsx')
    expect(panel).toContain('toEditable(row)')
    expect(shared).toContain("typeof value === 'object' ? JSON.stringify(value)")
  })

  it('expands nested values into dotted columns on demand', () => {
    expect(source('src/components/database/ResultsView.tsx')).toContain('flattenRow')
    expect(source('src/components/database/mongo/MongoWorkspace.tsx')).toContain('flattenRow')
  })

  it('virtualizes long result sets and keeps stable row keys', () => {
    const results = source('src/components/database/ResultsView.tsx')
    const mongo = source('src/components/database/mongo/MongoWorkspace.tsx')
    expect(results).toContain('useWindowedRows')
    expect(mongo).toContain('useWindowedRows')
    expect(results).toContain('paddingTop')
    expect(mongo).toContain('paddingBottom')
    expect(results).not.toContain('key={idx}')
  })

  it('resizes columns from a grip on the header', () => {
    const results = source('src/components/database/ResultsView.tsx')
    const mongo = source('src/components/database/mongo/MongoWorkspace.tsx')
    const widths = source('src/components/database/useColumnWidths.ts')
    expect(results).toContain('gripProps')
    expect(mongo).toContain('gripProps')
    expect(results).toContain('cursor-col-resize')
    expect(mongo).toContain('cursor-col-resize')
    expect(widths).toContain('MIN_COLUMN_WIDTH')
    expect(widths).toContain('onDoubleClick')
  })

  it('switches between table, tree and JSON views', () => {
    const results = source('src/components/database/ResultsView.tsx')
    const mongo = source('src/components/database/mongo/MongoWorkspace.tsx')
    expect(results).toContain("const [mode, setMode] = useState<ResultsMode>('table')")
    expect(results).toContain("<JsonTree")
    expect(mongo).toContain("label: 'Tree'")
    expect(mongo).toContain('<JsonTree')
  })

  it('says how much is really loaded', () => {
    const results = source('src/components/database/ResultsView.tsx')
    const mongo = source('src/components/database/mongo/MongoWorkspace.tsx')
    expect(results).toContain('auto-limited')
    expect(results).toContain('Page {page} of {totalPages}')
    expect(mongo).toContain('only the current page is loaded')
  })
})
