// Colori per livello nella console Run: i log di Go (log, slog, zap, zerolog, logrus) quasi mai
// emettono ANSI e il pacchetto log scrive su stderr, quindi lo stream da solo non dice se è un errore.

export type ConsoleLogLevel = 'error' | 'warn' | 'info' | 'debug' | 'success'

const LEVEL_WORDS: Array<[RegExp, ConsoleLogLevel]> = [
  [/^(?:fatal|panic|dpanic|crit(?:ical)?|err(?:or|o)?|severe|alert|emerg(?:ency)?)$/i, 'error'],
  [/^(?:warn(?:ing)?|wrn)$/i, 'warn'],
  [/^(?:info|inf|notice)$/i, 'info'],
  [/^(?:debug|dbg|trace|trc)$/i, 'debug'],
]

function levelOf(word: string): ConsoleLogLevel | null {
  for (const [pattern, level] of LEVEL_WORDS) if (pattern.test(word)) return level
  return null
}

// JSON (slog, zap, zerolog) e logfmt: "level":"ERROR", level=warn, severity=info.
const FIELD_LEVEL = /(?:"(?:level|lvl|severity)"\s*:\s*"|\b(?:level|lvl|severity)=)"?([A-Za-z]+)/
// Token di testo: [ERROR], ERROR:, <INFO>, oppure la parola isolata nelle prime colonne (zap console, logrus).
const TOKEN_LEVEL = /(?:^|[\s[(<|])(FATAL|PANIC|DPANIC|CRITICAL|CRIT|ERROR|ERRO|ERR|WARNING|WARN|WRN|INFO|INF|NOTICE|DEBUG|DBG|TRACE|TRC)(?=$|[\s\]):>|,[])/i

/** Livello di una riga di log, oppure null se la riga non ne dichiara uno. */
export function consoleLogLevel(text: string): ConsoleLogLevel | null {
  const trimmed = text.trimStart()
  if (/^(?:panic:|fatal error:|--- FAIL|FAIL\b|goroutine \d+ \[)/.test(trimmed)) return 'error'
  if (/^(?:--- PASS|PASS$|ok\s)/.test(trimmed)) return 'success'
  const field = FIELD_LEVEL.exec(text)
  if (field) return levelOf(field[1])
  // Solo nell'intestazione della riga: "connection error" nel messaggio non fa di un INFO un errore.
  const token = TOKEN_LEVEL.exec(text.slice(0, 48))
  return token ? levelOf(token[1]) : null
}

// Data/ora in testa alla riga: 2026/10/02 08:41:35, 2026-10-02T08:41:35.123Z, 08:41:35.123.
const TIMESTAMP = /^(\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?|\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)/

export interface ConsoleSegment {
  text: string
  kind: 'timestamp' | 'level' | 'text'
}

/** Divide l'intestazione della riga: timestamp attenuato, token del livello evidenziato, resto del messaggio. */
export function consoleSegments(text: string): ConsoleSegment[] {
  const segments: ConsoleSegment[] = []
  let rest = text
  const stamp = TIMESTAMP.exec(rest)
  if (stamp) {
    segments.push({ text: stamp[1], kind: 'timestamp' })
    rest = rest.slice(stamp[1].length)
  }
  const token = TOKEN_LEVEL.exec(rest.slice(0, 32))
  if (token && levelOf(token[1])) {
    const start = token.index + token[0].length - token[1].length
    if (start > 0) segments.push({ text: rest.slice(0, start), kind: 'text' })
    segments.push({ text: token[1], kind: 'level' })
    rest = rest.slice(start + token[1].length)
  }
  if (rest) segments.push({ text: rest, kind: 'text' })
  return segments
}
