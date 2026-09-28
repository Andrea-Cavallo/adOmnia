import type { GoIDEGoTool } from '@/lib/goide-api'

export interface GoStudioGoToolSpec {
  label: string
  /** Etichetta del campo target, o null se il comando non ne ha. */
  targetLabel: string | null
  placeholder: string
  hint: string
}

export const GO_STUDIO_GO_TOOLS: Record<GoIDEGoTool, GoStudioGoToolSpec> = {
  vet: { label: 'go vet', targetLabel: 'Package', placeholder: './...', hint: 'Reports suspicious constructs; results also appear in Problems.' },
  generate: { label: 'go generate', targetLabel: 'Package', placeholder: './...', hint: 'Runs //go:generate directives: they may rewrite files and run project commands.' },
  fix: { label: 'go fix', targetLabel: 'Package', placeholder: './...', hint: 'Rewrites old API uses in place. Commit or back up first.' },
  modWhy: { label: 'go mod why', targetLabel: 'Module or package', placeholder: 'golang.org/x/text', hint: 'Explains why a module is needed by this module.' },
  modGraph: { label: 'go mod graph', targetLabel: null, placeholder: '', hint: 'Prints the full module requirement graph.' },
  doc: { label: 'go doc', targetLabel: 'Package or symbol', placeholder: 'net/http.Client', hint: 'Shows the documentation of a package or symbol.' },
}

export interface GoStudioGoToolContext {
  /** Package del file attivo relativo al modulo, es. "./geom". */
  packageTarget: string
  /** Testo selezionato o identificatore sotto il cursore (con eventuale selettore, es. "http.Client"). */
  word: string
  /** Riga corrente del file attivo, per riconoscere un modulo in go.mod o un import. */
  lineText: string
}

const QUOTED_IMPORT = /"([^"\s]+)"/
const GO_MOD_REQUIRE = /^\s*(?:require\s+)?([A-Za-z0-9_.~][A-Za-z0-9_.~/-]*\.[A-Za-z0-9_.~/-]+)\s+v\d/

/** Target proposto all'apertura del dialog: il package corrente, il modulo della riga o la parola sotto il cursore. */
export function defaultGoToolTarget(tool: GoIDEGoTool, context: GoStudioGoToolContext): string {
  switch (tool) {
    case 'vet':
    case 'generate':
    case 'fix':
      return context.packageTarget || './...'
    case 'modWhy':
      return GO_MOD_REQUIRE.exec(context.lineText)?.[1] ?? QUOTED_IMPORT.exec(context.lineText)?.[1] ?? ''
    case 'doc':
      return context.word || QUOTED_IMPORT.exec(context.lineText)?.[1] || ''
    default:
      return ''
  }
}
