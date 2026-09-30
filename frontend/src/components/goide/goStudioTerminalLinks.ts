import { resolveConsolePath } from './goStudioConsolePaths'

/** Riferimento "file:riga[:colonna]" trovato in una riga del terminale; start/end sono indici 0-based nella riga. */
export interface GoStudioTerminalLink {
  start: number
  end: number
  path: string
  line: number
  column: number
}

// Estensioni dei sorgenti che compaiono in errori di build, stack trace e tool: così "example.com:443" non diventa un link.
// ponytail: niente spazi nei percorsi; li supporteremo se un progetto reale li stampa così.
const FILE_REFERENCE = /((?:[A-Za-z]:[\\/]|[\\/])?(?:[\w.@~+-]+[\\/])*[\w@~+-][\w.@~+-]*\.(?:go|s|mod|sum|proto|sql|tmpl|ya?ml|json|toml)):(\d+)(?::(\d+))?/g

/** Riferimenti a file cliccabili: errori di go build/vet/test e frame degli stack trace ("\t/path/main.go:12 +0x1d"). */
export function findTerminalLinks(text: string): GoStudioTerminalLink[] {
  return [...text.matchAll(FILE_REFERENCE)].map((match) => ({
    start: match.index!,
    end: match.index! + match[0].length,
    path: match[1],
    line: Number(match[2]),
    column: match[3] ? Number(match[3]) : 1,
  }))
}

export type GoStudioTerminalTarget = { kind: 'project'; relativePath: string } | { kind: 'external'; path: string }

/** Dove aprire il file: nel progetto (percorso relativo) o fuori (GOROOT, module cache), rispetto alla cartella del terminale. */
export function terminalLinkTarget(path: string, workingDirectory: string, projectRoots: readonly string[]): GoStudioTerminalTarget {
  const absolute = resolveConsolePath(path, workingDirectory)
  const relativePath = projectRelativePath(absolute, projectRoots)
  return relativePath ? { kind: 'project', relativePath } : { kind: 'external', path: absolute }
}

/** Percorso relativo alla radice del progetto ('' per la radice stessa), o null se è fuori dal progetto. */
export function projectRelativePath(absolute: string, projectRoots: readonly string[]): string | null {
  const normalized = absolute.replace(/\\/g, '/').replace(/\/+$/, '')
  for (const root of projectRoots) {
    if (!root) continue
    const base = root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    if (normalized.toLowerCase() === base) return ''
    if (normalized.toLowerCase().startsWith(base + '/')) return normalized.slice(base.length + 1)
  }
  return null
}

/** Comando `go` riconosciuto in una riga digitata nel terminale. */
export interface GoStudioDetectedGoCommand {
  subcommand: string
  /** Presente solo per `go test`: la stessa esecuzione nel Test Explorer. */
  test?: { packages: string[]; run?: string; bench?: string; race: boolean; coverage: boolean; buildTags: string[] }
}

const GO_COMMAND = /^\s*go(?:\.exe)?\s+([a-z][a-z0-9]*)\b(.*)$/i

/** Riconosce `go build`, `go test ./... -run X`, `go run .`… Con `go test` ricava la richiesta per il Test Explorer. */
export function detectGoCommand(commandLine: string): GoStudioDetectedGoCommand | null {
  const match = GO_COMMAND.exec(commandLine)
  if (!match) return null
  const subcommand = match[1].toLowerCase()
  if (subcommand !== 'test') return { subcommand }
  // Pipe, redirezioni e comandi concatenati non si traducono in un'esecuzione del Test Explorer.
  if (/[|&;<>`$]/.test(match[2])) return { subcommand }
  const test = { packages: [] as string[], race: false, coverage: false, buildTags: [] as string[], run: undefined as string | undefined, bench: undefined as string | undefined }
  const words = match[2].trim().split(/\s+/).filter(Boolean).map((word) => word.replace(/^(['"])(.*)\1$/, '$2'))
  for (let index = 0; index < words.length; index++) {
    const word = words[index]
    const [flag, inline] = word.startsWith('-') ? word.replace(/^--?/, '').split(/=(.*)/s) : [null, undefined]
    if (flag === null) { test.packages.push(word); continue }
    const value = () => inline ?? words[++index]
    if (flag === 'run') test.run = value()
    else if (flag === 'bench') test.bench = value()
    else if (flag === 'tags') test.buildTags = (value() ?? '').split(',').filter(Boolean)
    else if (flag === 'race') test.race = inline !== 'false'
    else if (flag === 'cover' || flag === 'coverprofile') { test.coverage = true; if (flag === 'coverprofile' && inline === undefined) index++ }
    else if (!['v', 'count', 'short', 'failfast', 'timeout', 'json'].includes(flag)) return { subcommand }
    else if ((flag === 'count' || flag === 'timeout') && inline === undefined) index++
  }
  if (test.packages.length === 0) test.packages.push('.')
  return { subcommand, test: { ...test, run: test.run || undefined, bench: test.bench || undefined } }
}

/**
 * Ricostruisce la riga digitata dai tasti inviati alla shell. Frecce, Tab e scorciatoie della shell
 * rendono la riga incerta: in quel caso il comando non viene registrato.
 * ponytail: euristica sui tasti, non legge il prompt; basta per cronologia e rilevamento dei comandi go.
 */
export class TerminalLineTracker {
  private line = ''
  private uncertain = false

  /** Restituisce i comandi completati (Invio) dentro questo blocco di input. */
  push(data: string): string[] {
    const done: string[] = []
    if (data.startsWith('\x1b[200~')) data = data.slice(6).replace(/\x1b\[201~$/, '')
    for (let index = 0; index < data.length; index++) {
      const char = data[index]
      if (char === '\r' || char === '\n') {
        const command = this.line.trim()
        if (command && !this.uncertain) done.push(command)
        this.line = ''
        this.uncertain = false
        if (char === '\r' && data[index + 1] === '\n') index++
      } else if (char === '\x7f' || char === '\b') {
        this.line = this.line.slice(0, -1)
      } else if (char === '\x03' || char === '\x15') {
        this.line = ''
        this.uncertain = false
      } else if (char === '\x1b' || char === '\t' || char < ' ') {
        this.uncertain = true
        if (char === '\x1b') index = skipEscape(data, index)
      } else {
        this.line += char
      }
    }
    return done
  }
}

function skipEscape(data: string, index: number): number {
  if (data[index + 1] !== '[' && data[index + 1] !== 'O') return index + 1
  let end = index + 2
  while (end < data.length && !/[A-Za-z~]/.test(data[end])) end++
  return end
}

const HISTORY_LIMIT = 50

// Comandi che probabilmente contengono credenziali: non finiscono mai nella cronologia salvata.
const SENSITIVE_COMMAND = /pass(?:word|wd)?|secret|token|api[_-]?key|bearer|authorization|credential|private[_-]?key/i

/** Aggiunge il comando in cima alla cronologia, senza duplicati, entro il limite; i comandi con segreti restano fuori. */
export function pushHistory(history: readonly string[], command: string): string[] {
  if (SENSITIVE_COMMAND.test(command)) return [...history]
  return [command, ...history.filter((item) => item !== command)].slice(0, HISTORY_LIMIT)
}

/** Testo del buffer senza sequenze ANSI, con le righe spezzate dal wrap ricomposte e gli spazi finali tolti. */
export function cleanBufferText(lines: readonly { text: string; wrapped: boolean }[]): string {
  const out: string[] = []
  for (const line of lines) {
    if (line.wrapped && out.length) out[out.length - 1] += line.text
    else out.push(line.text)
  }
  return out.map((line) => line.replace(/\s+$/, '')).join('\n').replace(/\n+$/, '')
}
