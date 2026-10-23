import { parseConsoleLocation } from '@/lib/code-studio/consoleLocation'

/** Un chunk di output come arriva da `run.output`: testo grezzo, flusso e numero di sequenza. */
export interface ConsoleChunk {
  sequence: number
  stream: 'stdout' | 'stderr' | 'system'
  text: string
}

/** Una riga della console Run: `text` pulito (ricerca, link, problemi) e `raw` con i colori SGR. */
export interface ConsoleParsedLine {
  text: string
  raw: string
  path?: string
  line?: number
  column?: number
  stream: ConsoleChunk['stream']
  sequence: number
}

// Escape ANSI: OSC (titoli) e CSI (colori, spostamenti cursore). Solo il SGR (`[…m`) porta colore
// e resta nel `raw` per renderAnsi; tutto il resto viene tolto, altrimenti compare come testo.
// Stessi codici ANSI (ESC = \x1b, BEL = \x07) scritti come escape: il pattern resta identico senza caratteri
// di controllo nel sorgente.
const escapePattern = new RegExp('\\x1b\\][^\\x07\\x1b]*(?:\\x07|\\x1b\\\\)?|\\x1b\\[[0-?]*[ -/]*[@-~]', 'g')
const sgrPattern = new RegExp('^\\x1b\\[[0-9;]*m$')

function cleanDisplay(raw: string): string {
  return raw.replace(escapePattern, (match) => (sgrPattern.test(match) ? match : ''))
}

/**
 * Un `\r` torna a colonna 0 e ciò che segue sovrascrive la riga come in un terminale: `abcdef\rXY`
 * mostra `XYcdef` (i caratteri oltre la scrittura restano). Le ridisegnate di avanzamento
 * (`Progress…\rProgress…\r`) non devono diventare una riga stirata di frammenti, e un `\r` finale
 * senza nulla dopo non cancella la riga.
 */
export function resolveCarriageReturns(segment: string): string {
  if (!segment.includes('\r')) return segment
  let out = ''
  for (const part of segment.split('\r')) {
    out = part + out.slice(part.length)
  }
  return out
}

function makeLine(segment: string, chunk: ConsoleChunk): ConsoleParsedLine {
  const raw = cleanDisplay(resolveCarriageReturns(segment))
  const text = raw.replace(escapePattern, '')
  const location = parseConsoleLocation(text)
  return { text, raw, stream: chunk.stream, sequence: chunk.sequence, path: location?.path, line: location?.line, column: location?.column ?? 1 }
}

interface ParseCache {
  length: number
  pending: string
  pendingChunk: ConsoleChunk
  lines: ConsoleParsedLine[]
  result: ConsoleParsedLine[]
}

// L'analisi è incrementale per identità dei chunk: un nuovo evento `run.output` appende un chunk,
// quindi si analizza solo quello. La cache è per primo chunk (identità), così due console aperte non
// si scalzano a vicenda. La coda incompleta (una riga senza `\n` finale) è la riga viva in fondo
// alla console, rifatta a ogni chiamata.
let caches = new WeakMap<ConsoleChunk, ParseCache>()

/** Reset dell'analisi incrementale: solo per i test. */
export function resetConsoleLineCache(): void {
  caches = new WeakMap()
}

export function parseConsoleLines(chunks: ConsoleChunk[]): ConsoleParsedLine[] {
  if (chunks.length === 0) return []
  const key = chunks[0]
  const previous = caches.get(key)
  if (previous && previous.length === chunks.length) return previous.result
  const incremental = previous !== undefined && chunks.length > previous.length
  const lines = incremental ? previous.lines : []
  let pending = incremental ? previous.pending : ''
  let pendingChunk = incremental ? previous.pendingChunk : chunks[0]
  for (let index = incremental ? previous.length : 0; index < chunks.length; index++) {
    const chunk = chunks[index]
    const combined = pending + chunk.text
    const segments = combined.split('\n')
    pending = segments.pop() ?? ''
    pendingChunk = chunk
    for (const segment of segments) lines.push(makeLine(segment, chunk))
  }
  const result = pending ? [...lines, makeLine(pending, pendingChunk)] : [...lines]
  caches.set(key, { length: chunks.length, pending, pendingChunk, lines, result })
  return result
}
