import type { GoIDELanguageServerProgress } from '@/lib/goide-lsp-api'

/**
 * Prossimo stato del lavoro in corso del language server. Un `report` aggiorna solo il lavoro mostrato
 * (stesso token): un report arrivato dopo il suo `end`, o di un altro token, riaccendeva lo spinner e
 * nessun `end` lo avrebbe più spento, lasciando un'animazione e un timer attivi all'infinito.
 */
export function nextLanguageServerProgress(
  current: GoIDELanguageServerProgress | null,
  event: GoIDELanguageServerProgress,
): GoIDELanguageServerProgress | null {
  switch (event.kind) {
    case 'begin':
      return event
    case 'report':
      return current && current.token === event.token ? { ...current, ...event, title: event.title ?? current.title } : current
    case 'end':
      return current && current.token !== event.token ? current : null
    default:
      return current
  }
}
