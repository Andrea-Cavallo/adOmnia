/**
 * URL locali dichiarati da un server in esecuzione (uvicorn, Django, Flask, vite…) nell'output
 * della console. Solo rilevamento: aprire l'URL è un'azione esplicita dell'utente, mai un fetch
 * o un'apertura automatica al semplice rilevamento (PY-7.3).
 */
const SERVER_URL = /\bhttps?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d{2,5})?(\/[^\s"'<>]*)?/gi

/**
 * Righe che dichiarano l'indirizzo di ascolto **senza lo schema** (axum `listening on 0.0.0.0:3000`,
 * actix-web `… service on: 0.0.0.0:8080`, warp/tide `listening at`…): l'`host:port` di queste righe
 * diventa un URL `http://`, lo schema dei server di sviluppo locali (RS-3.5). Solo qui: un
 * `localhost:5432` nella riga di un log di database non è un server da aprire.
 */
const LISTENING_LINE = /\b(?:listening (?:on|at)|service on|started (?:on|at)|bound to|serving (?:on|at))\b/i

const BARE_ADDRESS = /\b(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d{2,5})\b/gi

/** Punteggiatura che chiude una frase attorno all'URL: tolta a mano, un `+$` riscansiona la coda a ogni posizione. */
const TRAILING_PUNCTUATION = '.,;:)}]'

function trimTrailingPunctuation(value: string): string {
  let end = value.length
  while (end > 0 && TRAILING_PUNCTUATION.includes(value[end - 1])) end -= 1
  return value.slice(0, end)
}

/**
 * URL locali trovati nell'output, unici e nell'ordine in cui compaiono. `0.0.0.0` e `[::1]`
 * diventano `localhost`, l'unicica su cui il browser può arrivare; gli host non locali escono.
 * Gli indirizzi senza schema valgono solo sulle righe di ascolto (RS-3.5).
 */
export function localServerURLs(text: string): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  const add = (scheme: string, host: string, port: string, path: string) => {
    const url = `${scheme}${host}${port}${path}`
    if (seen.has(url)) return
    seen.add(url)
    found.push(url)
  }
  for (const line of text.split(/\r?\n/)) {
    for (const match of line.matchAll(SERVER_URL)) {
      const host = /^(0\.0\.0\.0|\[::1\])$/i.test(match[1]) ? 'localhost' : match[1]
      const path = trimTrailingPunctuation(match[3] ?? '')
      add(match[0].slice(0, match[0].indexOf('://') + 3), host, match[2] ?? '', path)
    }
    // Indirizzo senza schema (`listening on 0.0.0.0:3000`): solo quando la riga dichiara l'ascolto
    // e non contiene già un URL completo, che ha la priorità.
    if (line.includes('://') || !LISTENING_LINE.test(line)) continue
    for (const match of line.matchAll(BARE_ADDRESS)) {
      const host = /^(0\.0\.0\.0|\[::1\])$/i.test(match[1]) ? 'localhost' : match[1]
      add('http://', host, match[2], '')
    }
  }
  return found
}

/** Il primo URL locale della console (quello del server appena avviato), null se non c'è. */
export function firstLocalServerURL(text: string): string | null {
  return localServerURLs(text)[0] ?? null
}
