import type { GoIDEFileChange, GoIDEWorkspaceChange } from '@/lib/goide-lsp-api'

export interface ReplaceOptions {
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
}

/**
 * Espressione equivalente alla ricerca del backend. In modalità regex vale la sintassi
 * JavaScript, compatibile con RE2 per i casi comuni, e il sostituto accetta $1, $2…
 */
export function replacePattern(query: string, options: ReplaceOptions): RegExp {
  const source = options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const bounded = options.wholeWord ? `\\b(?:${source})\\b` : source
  return new RegExp(bounded, options.caseSensitive ? 'gu' : 'giu')
}

/** Testo sostituito e numero di occorrenze; con regex il sostituto espande $1, $2… */
export function replaceInText(content: string, query: string, replacement: string, options: ReplaceOptions): { text: string; count: number } {
  let count = 0
  const pattern = replacePattern(query, options)
  const text = content.replace(pattern, (...args: unknown[]) => {
    count++
    if (!options.regex) return replacement
    const groups = args.slice(1, -2) as Array<string | undefined>
    return replacement.replace(/\$(\d+)/g, (whole, index: string) => groups[Number(index) - 1] ?? whole)
  })
  return { text, count }
}

/**
 * Prepara la sostituzione nei file trovati e la apre nell'anteprima delle modifiche:
 * si vede ogni riga cambiata, si applica tutto o niente e si può annullare.
 * Usa i buffer aperti (anche non salvati), come la ricerca.
 */
export async function previewReplaceInFiles(files: string[], query: string, replacement: string, options: ReplaceOptions): Promise<{ files: number; occurrences: number }> {
  const [{ useGoIDEStore }, { useGoIDELspStore }, { lineEditsFor }] = await Promise.all([import('@/stores/goide'), import('@/stores/goideLsp'), import('./goStudioAIFix')])
  const changes: GoIDEFileChange[] = []
  let occurrences = 0
  for (const relativePath of files) {
    const document = await useGoIDEStore.getState().ensureDocumentLoaded(relativePath)
    if (!document || document.document.readOnly) continue
    const original = document.buffer.replace(/\r\n/g, '\n')
    const { text, count } = replaceInText(original, query, replacement, options)
    if (count === 0 || text === original) continue
    const { edits, newContent } = lineEditsFor(original, text)
    occurrences += count
    changes.push({ uri: document.document.uri, path: document.document.path, relativePath, documentId: document.document.id, edits, newContent, originalContent: original } as GoIDEFileChange)
  }
  if (changes.length > 0) {
    useGoIDELspStore.setState({ pendingChange: { label: `Replace “${query}” with “${replacement}” · ${occurrences} occurrence${occurrences === 1 ? '' : 's'}`, files: changes } as GoIDEWorkspaceChange })
  }
  return { files: changes.length, occurrences }
}
