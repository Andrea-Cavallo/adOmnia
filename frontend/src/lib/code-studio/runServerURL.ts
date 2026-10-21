/**
 * URL locali dichiarati da un server in esecuzione (uvicorn, Django, Flask, vite…) nell'output
 * della console. Solo rilevamento: aprire l'URL è un'azione esplicita dell'utente, mai un fetch
 * o un'apertura automatica al semplice rilevamento (PY-7.3).
 */
const SERVER_URL = /\bhttps?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d{2,5})?(\/[^\s"'<>]*)?/gi

const TRAILING_PUNCTUATION = /[.,;:)\]}]+$/

/**
 * URL locali trovati nell'output, unici e nell'ordine in cui compaiono. `0.0.0.0` e `[::1]`
 * diventano `localhost`, l'unicica su cui il browser può arrivare; gli host non locali escono.
 */
export function localServerURLs(text: string): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  for (const match of text.matchAll(SERVER_URL)) {
    const host = /^(0\.0\.0\.0|\[::1\])$/i.test(match[1]) ? 'localhost' : match[1]
    const path = (match[3] ?? '').replace(TRAILING_PUNCTUATION, '')
    const url = `${match[0].slice(0, match[0].indexOf('://') + 3)}${host}${match[2] ?? ''}${path}`
    if (seen.has(url)) continue
    seen.add(url)
    found.push(url)
  }
  return found
}

/** Il primo URL locale della console (quello del server appena avviato), null se non c'è. */
export function firstLocalServerURL(text: string): string | null {
  return localServerURLs(text)[0] ?? null
}
