import { SYMBOL_KIND } from './goStudioSymbols'

interface GoStudioSymbolIconProps {
  /** SymbolKind LSP (1-based). */
  kind: number
  size?: number
}

interface SymbolBadge {
  letter: string
  tone: string
}

const PACKAGE_KINDS = new Set([2, 4])

/** Lettera e colore del simbolo, come i badge di GoLand: C costante, S struct, I interface, f funzione, m metodo… */
function badgeFor(kind: number): SymbolBadge {
  switch (kind) {
    case SYMBOL_KIND.constant: return { letter: 'C', tone: 'bg-accent/15 text-accent ring-accent/40' }
    case SYMBOL_KIND.variable: return { letter: 'V', tone: 'bg-warning/15 text-warning ring-warning/40' }
    case SYMBOL_KIND.struct: case SYMBOL_KIND.class: return { letter: 'S', tone: 'bg-info/15 text-info ring-info/40' }
    case SYMBOL_KIND.interface: return { letter: 'I', tone: 'bg-success/15 text-success ring-success/40' }
    case SYMBOL_KIND.typeParameter: return { letter: 'T', tone: 'bg-info/15 text-info ring-info/40' }
    case SYMBOL_KIND.function: case SYMBOL_KIND.constructor: return { letter: 'f', tone: 'bg-info/15 text-info ring-info/40' }
    case SYMBOL_KIND.method: return { letter: 'm', tone: 'bg-danger/15 text-danger ring-danger/40' }
    case SYMBOL_KIND.field: case SYMBOL_KIND.property: return { letter: 'F', tone: 'bg-surface-3 text-text-3 ring-border-2' }
    default: return PACKAGE_KINDS.has(kind)
      ? { letter: 'P', tone: 'bg-surface-3 text-text-3 ring-border-2' }
      : { letter: '·', tone: 'bg-surface-3 text-text-4 ring-border-2' }
  }
}

/** Badge coerente per i SymbolKind LSP usati da gopls, in Structure, breadcrumb e ricerche. */
export function GoStudioSymbolIcon({ kind, size = 11 }: GoStudioSymbolIconProps) {
  const { letter, tone } = badgeFor(kind)
  const box = size + 3
  return (
    <span
      aria-hidden="true"
      className={`inline-grid shrink-0 place-items-center rounded-[4px] font-mono font-bold leading-none ring-1 ring-inset ${tone}`}
      style={{ width: box, height: box, fontSize: Math.round(box * 0.62) }}
    >
      {letter}
    </span>
  )
}
