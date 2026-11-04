import { parseConsoleLocation } from '@/lib/code-studio/consoleLocation'
import { firstLocalServerURL } from '@/lib/code-studio/runServerURL'

/** Un chunk di output come arriva da `run.output`: testo grezzo, flusso e numero di sequenza. */
export interface ConsoleChunk {
  sequence: number
  stream: 'stdout' | 'stderr' | 'system'
  text: string
}

/** Una riga della console Run: `text` pulito (ricerca, link, problemi) e `raw` con i colori SGR. */
export interface ConsoleParsedLine {
  /** Stabile finché la riga resta nel buffer: è la chiave di rendering, anche mentre quelle in testa escono. */
  id: number
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
const escapePattern = new RegExp('\\x1b\\][^\\x07\\x1b]*(?:\\x07|\\x1b\\\\)?|\\x1b\\[[0-?]*[ -/]*[@-~]', 'g') // NOSONAR -- S6324 segnala ESC/BEL anche scritti come escape \x: sono i caratteri ANSI che il pattern deve rimuovere, non dei refusi; riscriverlo cambierebbe cosa viene pulito.
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

function makeLine(segment: string, chunk: ConsoleChunk, id: number): ConsoleParsedLine {
  const raw = cleanDisplay(resolveCarriageReturns(segment))
  const text = raw.replace(escapePattern, '')
  const location = parseConsoleLocation(text)
  return { id, text, raw, stream: chunk.stream, sequence: chunk.sequence, path: location?.path, line: location?.line, column: location?.column ?? 1 }
}

interface ParseCache {
  chunks: ConsoleChunk[]
  /** Righe completate da ciascun chunk: servono a togliere quelle dei chunk usciti dal buffer. */
  lineCounts: number[]
  pending: string
  pendingChunk: ConsoleChunk
  lines: ConsoleParsedLine[]
  nextId: number
  result: ConsoleParsedLine[]
  serverURL: string
}

// L'analisi è incrementale: un evento `run.output` appende un chunk, quindi si analizza solo quello. La
// cache si ritrova dall'ultimo chunk già visto, perché quello in testa cambia quando il buffer arriva al
// limite: legarla al primo chunk rifaceva tutti i 4 MB a ogni aggiornamento proprio con l'output più
// intenso. La coda incompleta (una riga senza `\n` finale) è la riga viva in fondo, rifatta a ogni chiamata.
let caches = new WeakMap<ConsoleChunk, ParseCache>()

/** Reset dell'analisi incrementale: solo per i test. */
export function resetConsoleLineCache(): void {
  caches = new WeakMap()
}

function hasLocalHost(text: string): boolean {
  return text.includes('localhost') || text.includes('127.0.0.1') || text.includes('0.0.0.0') || text.includes('[::1]')
}

/** La cache di cui `chunks` è la continuazione: stessi chunk, meno quelli usciti in testa, più quelli nuovi. */
function continuedCache(chunks: ConsoleChunk[]): { cache: ParseCache; start: number } | null {
  for (let index = chunks.length - 1; index >= 0; index--) {
    const cache = caches.get(chunks[index])
    if (cache?.chunks[cache.chunks.length - 1] !== chunks[index]) continue
    const trimmed = cache.chunks.indexOf(chunks[0])
    if (trimmed < 0 || cache.chunks.length - trimmed !== index + 1) return null
    cache.lines.splice(0, cache.lineCounts.slice(0, trimmed).reduce((total, count) => total + count, 0))
    cache.lineCounts = cache.lineCounts.slice(trimmed)
    return { cache, start: index + 1 }
  }
  return null
}

function parsedCache(chunks: ConsoleChunk[]): ParseCache {
  const last = chunks[chunks.length - 1]
  const known = caches.get(last)
  if (known?.chunks === chunks) return known
  const continued = continuedCache(chunks)
  const cache: ParseCache = continued?.cache ?? { chunks, lineCounts: [], pending: '', pendingChunk: chunks[0], lines: [], nextId: 0, result: [], serverURL: '' }
  for (let index = continued?.start ?? 0; index < chunks.length; index++) {
    const chunk = chunks[index]
    const segments = (cache.pending + chunk.text).split('\n')
    cache.pending = segments.pop() ?? ''
    cache.pendingChunk = chunk
    cache.lineCounts.push(segments.length)
    for (const segment of segments) {
      const line = makeLine(segment, chunk, cache.nextId++)
      cache.lines.push(line)
      if (!cache.serverURL && hasLocalHost(line.text)) cache.serverURL = firstLocalServerURL(line.text) ?? ''
    }
  }
  cache.chunks = chunks
  cache.result = cache.pending ? [...cache.lines, makeLine(cache.pending, cache.pendingChunk, cache.nextId)] : [...cache.lines]
  caches.set(last, cache)
  return cache
}

export function parseConsoleLines(chunks: ConsoleChunk[]): ConsoleParsedLine[] {
  return chunks.length === 0 ? [] : parsedCache(chunks).result
}

/** Il primo URL locale dichiarato dall'esecuzione: resta anche quando la sua riga esce dal buffer. */
export function consoleServerURL(chunks: ConsoleChunk[]): string | undefined {
  if (chunks.length === 0) return undefined
  const cache = parsedCache(chunks)
  if (cache.serverURL) return cache.serverURL
  return hasLocalHost(cache.pending) ? firstLocalServerURL(cache.pending) ?? undefined : undefined
}
