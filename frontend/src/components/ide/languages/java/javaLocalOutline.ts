import type { GoIDESymbolNode } from '@/lib/code-studio-lsp-api'
import { analyzeJavaFile } from './javaLocalAnalysis'

export function javaOutline(buffer: string, serverState: string, symbols: GoIDESymbolNode[] | undefined, symbolBuffer?: string) {
  if (serverState === 'ready' && symbols && symbols.length > 0 && (symbolBuffer === undefined || symbolBuffer === buffer)) return { symbols, source: 'server' as const, limited: false }
  const local = analyzeJavaFile(buffer)
  return { symbols: local.symbols, source: 'local' as const, limited: local.limited }
}
