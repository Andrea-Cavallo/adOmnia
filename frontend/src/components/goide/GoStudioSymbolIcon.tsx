import { Box, Braces, Circle, Diamond, FunctionSquare, Hash, Package, SquareCode, Type, Variable } from 'lucide-react'

interface GoStudioSymbolIconProps {
  /** SymbolKind LSP (1-based). */
  kind: number
  size?: number
}

/** Icona coerente per i SymbolKind LSP usati da gopls (struct, interface, func, method, var, const…). */
export function GoStudioSymbolIcon({ kind, size = 11 }: GoStudioSymbolIconProps) {
  switch (kind) {
    case 6: case 9: return <SquareCode size={size} className="shrink-0 text-accent" aria-hidden="true" />
    case 12: return <FunctionSquare size={size} className="shrink-0 text-accent" aria-hidden="true" />
    case 11: return <Diamond size={size} className="shrink-0 text-success" aria-hidden="true" />
    case 5: case 23: return <Box size={size} className="shrink-0 text-warning" aria-hidden="true" />
    case 7: case 8: return <Circle size={size - 2} className="shrink-0 text-text-3" aria-hidden="true" />
    case 13: return <Variable size={size} className="shrink-0 text-text-3" aria-hidden="true" />
    case 14: return <Hash size={size} className="shrink-0 text-text-3" aria-hidden="true" />
    case 2: case 4: return <Package size={size} className="shrink-0 text-text-3" aria-hidden="true" />
    case 26: return <Type size={size} className="shrink-0 text-text-3" aria-hidden="true" />
    default: return <Braces size={size} className="shrink-0 text-text-4" aria-hidden="true" />
  }
}
