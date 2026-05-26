/**
 * Session-only cookie jar (P1-08).
 * Captures Set-Cookie headers from HTTP responses and replays matching cookies
 * on subsequent requests, respecting domain, path, Secure, and expiry attributes.
 * Data is never persisted — the jar is cleared when the app closes.
 */
import { create } from 'zustand'
import { useSettingsStore } from '@/stores/settings'

export interface JarEntry {
  name: string
  value: string
  domain: string     // effective domain, no leading dot
  path: string
  expires?: number   // Unix ms, undefined = session cookie
  secure: boolean
  httpOnly: boolean
  sameSite: 'Strict' | 'Lax' | 'None' | ''
}

interface CookieJarState {
  entries: JarEntry[]
  /** Parse one or more raw Set-Cookie values from a response and store them. */
  capture: (responseUrl: string, rawSetCookies: string[]) => void
  /** Return all valid jar cookies that should be sent for the given request URL. */
  getCookiesForUrl: (url: string) => JarEntry[]
  deleteCookie: (domain: string, name: string) => void
  clearAll: () => void
  clearDomain: (domain: string) => void
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function getHostname(url: string): string {
  try { return new URL(url).hostname.toLowerCase() } catch { return '' }
}

function getPathname(url: string): string {
  try { return new URL(url).pathname || '/' } catch { return '/' }
}

function isHttps(url: string): boolean {
  try { return new URL(url).protocol === 'https:' } catch { return false }
}

/**
 * Parse a single raw Set-Cookie header string.
 * Returns null if the header is malformed or has no name.
 */
function parseSetCookie(raw: string, requestUrl: string): JarEntry | null {
  const [nameValuePart, ...attrParts] = raw.split(';').map((s) => s.trim())
  if (!nameValuePart) return null
  const eqIdx = nameValuePart.indexOf('=')
  if (eqIdx < 1) return null

  const name = nameValuePart.slice(0, eqIdx).trim()
  const value = nameValuePart.slice(eqIdx + 1).trim()
  if (!name) return null

  const attrs: Record<string, string> = {}
  for (const part of attrParts) {
    const aeq = part.indexOf('=')
    const key = (aeq === -1 ? part : part.slice(0, aeq)).trim().toLowerCase()
    const val = aeq === -1 ? '' : part.slice(aeq + 1).trim()
    if (key) attrs[key] = val
  }

  const requestDomain = getHostname(requestUrl)
  const domain = attrs['domain'] ? attrs['domain'].replace(/^\./, '').toLowerCase() : requestDomain
  const path = attrs['path'] || getPathname(requestUrl)

  let expires: number | undefined
  if (attrs['max-age'] !== undefined) {
    const maxAge = parseInt(attrs['max-age'], 10)
    if (!isNaN(maxAge)) expires = maxAge <= 0 ? 0 : Date.now() + maxAge * 1000
  } else if (attrs['expires']) {
    const d = new Date(attrs['expires']).getTime()
    if (!isNaN(d)) expires = d
  }

  const secure = 'secure' in attrs
  const httpOnly = 'httponly' in attrs
  const rawSameSite = (attrs['samesite'] || '').toLowerCase()
  const sameSite: JarEntry['sameSite'] =
    rawSameSite === 'strict' ? 'Strict' :
    rawSameSite === 'lax' ? 'Lax' :
    rawSameSite === 'none' ? 'None' : ''

  return { name, value, domain, path, expires, secure, httpOnly, sameSite }
}

function domainMatches(cookieDomain: string, requestHost: string): boolean {
  return requestHost === cookieDomain || requestHost.endsWith(`.${cookieDomain}`)
}

function pathMatches(cookiePath: string, requestPath: string): boolean {
  if (cookiePath === '/') return true
  if (requestPath === cookiePath) return true
  const prefix = cookiePath.endsWith('/') ? cookiePath : `${cookiePath}/`
  return requestPath.startsWith(prefix)
}

// ─── store ────────────────────────────────────────────────────────────────────

export const useCookieJarStore = create<CookieJarState>((set, get) => ({
  entries: [],

  capture: (responseUrl, rawSetCookies) => {
    if (!useSettingsStore.getState().settings.requests.sendCookiesAutomatically) return
    const incoming = rawSetCookies
      .flatMap((h) => {
        // Some backends join multiple Set-Cookie values with \n
        return h.includes('\n') ? h.split('\n') : [h]
      })
      .map((h) => parseSetCookie(h.trim(), responseUrl))
      .filter((e): e is JarEntry => e !== null)
    if (!incoming.length) return

    set((s) => {
      const next = [...s.entries]
      for (const entry of incoming) {
        // Expired max-age=0 means delete
        if (entry.expires !== undefined && entry.expires <= Date.now()) {
          const idx = next.findIndex((e) => e.domain === entry.domain && e.path === entry.path && e.name === entry.name)
          if (idx >= 0) next.splice(idx, 1)
          continue
        }
        const idx = next.findIndex((e) => e.domain === entry.domain && e.path === entry.path && e.name === entry.name)
        if (idx >= 0) next[idx] = entry
        else next.push(entry)
      }
      return { entries: next }
    })
  },

  getCookiesForUrl: (url) => {
    if (!useSettingsStore.getState().settings.requests.sendCookiesAutomatically) return []
    const host = getHostname(url)
    if (!host) return []
    const reqPath = getPathname(url)
    const https = isHttps(url)
    const now = Date.now()
    return get().entries.filter((e) => {
      if (e.expires !== undefined && e.expires < now) return false
      if (e.secure && !https) return false
      if (!domainMatches(e.domain, host)) return false
      if (!pathMatches(e.path, reqPath)) return false
      return true
    })
  },

  deleteCookie: (domain, name) => {
    set((s) => ({ entries: s.entries.filter((e) => !(e.domain === domain && e.name === name)) }))
  },

  clearAll: () => set({ entries: [] }),

  clearDomain: (domain) => {
    set((s) => ({ entries: s.entries.filter((e) => e.domain !== domain) }))
  },
}))
