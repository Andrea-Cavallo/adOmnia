import type { RequestItem, KVRow, RequestAuth, HttpMethod } from '@/lib/types'
import { uid, blankBody, blankKVRow } from '@/lib/types'

function tokenize(cmd: string): string[] {
  const tokens: string[] = []
  let i = 0
  while (i < cmd.length) {
    const ch = cmd[i]
    if (ch === ' ' || ch === '\t') { i++; continue }
    if (ch === "'" || ch === '"') {
      const q = ch
      let j = i + 1
      let val = ''
      while (j < cmd.length && cmd[j] !== q) {
        if (cmd[j] === '\\' && q === '"' && j + 1 < cmd.length) {
          val += cmd[j + 1]
          j += 2
        } else {
          val += cmd[j++]
        }
      }
      tokens.push(val)
      i = j + 1
    } else {
      let j = i
      while (j < cmd.length && cmd[j] !== ' ' && cmd[j] !== '\t') j++
      tokens.push(cmd.slice(i, j))
      i = j
    }
  }
  return tokens
}

export interface ParsedCurl {
  method: HttpMethod
  url: string
  headers: KVRow[]
  body: string | null
  auth: RequestAuth | null
}

export function parseCurl(raw: string): ParsedCurl | null {
  const normalized = raw.replace(/\\\n\s*/g, ' ').trim()
  const tokens = tokenize(normalized)

  if (!tokens.length || tokens[0].toLowerCase() !== 'curl') return null

  let method: HttpMethod = 'GET'
  let url = ''
  const headers: KVRow[] = []
  let body: string | null = null
  let auth: RequestAuth | null = null

  let i = 1
  while (i < tokens.length) {
    const tok = tokens[i]

    if (tok === '-X' || tok === '--request') {
      method = (tokens[++i] ?? 'GET').toUpperCase() as HttpMethod
    } else if (tok === '-H' || tok === '--header') {
      const hdr = tokens[++i] ?? ''
      const colon = hdr.indexOf(':')
      if (colon > 0) {
        headers.push({ id: uid(), key: hdr.slice(0, colon).trim(), value: hdr.slice(colon + 1).trim(), enabled: true })
      }
    } else if (tok === '-d' || tok === '--data' || tok === '--data-raw' || tok === '--data-binary' || tok === '--data-urlencode') {
      body = tokens[++i] ?? ''
      if (method === 'GET') method = 'POST'
    } else if (tok === '-u' || tok === '--user') {
      const creds = tokens[++i] ?? ''
      const colon = creds.indexOf(':')
      auth = { type: 'basic', token: '', username: colon > 0 ? creds.slice(0, colon) : creds, password: colon > 0 ? creds.slice(colon + 1) : '' }
    } else if (tok === '--url') {
      url = tokens[++i] ?? ''
    } else if (tok === '--oauth2-bearer') {
      const token = tokens[++i] ?? ''
      auth = { type: 'bearer', token, username: '', password: '' }
    } else if (!tok.startsWith('-') && !url) {
      url = tok
    }

    i++
  }

  if (!url) return null
  return { method, url, headers, body, auth }
}

export function applyParsedCurl(parsed: ParsedCurl, existing: RequestItem): RequestItem {
  const body = blankBody()
  if (parsed.body) {
    body.type = 'raw'
    body.raw = parsed.body
    try {
      JSON.parse(parsed.body)
      body.lang = 'json'
    } catch { /* keep default */ }
  }

  const contentTypeHdr = parsed.headers.find(h => h.key.toLowerCase() === 'content-type')
  if (contentTypeHdr && contentTypeHdr.value.includes('application/json')) {
    body.lang = 'json'
  }

  const authHeader = parsed.headers.find(h => h.key.toLowerCase() === 'authorization')
  let auth = existing.auth
  if (parsed.auth) {
    auth = { ...existing.auth, ...parsed.auth }
  } else if (authHeader) {
    const val = authHeader.value
    if (val.startsWith('Bearer ')) {
      auth = { type: 'bearer', token: val.slice(7), username: '', password: '' }
    } else if (val.startsWith('Basic ')) {
      try {
        const decoded = atob(val.slice(6))
        const colon = decoded.indexOf(':')
        auth = { type: 'basic', token: '', username: colon > 0 ? decoded.slice(0, colon) : decoded, password: colon > 0 ? decoded.slice(colon + 1) : '' }
      } catch { /* ignore */ }
    }
  }

  const filteredHeaders = parsed.headers.filter(h => h.key.toLowerCase() !== 'authorization')
  const params: KVRow[] = [blankKVRow()]
  if (parsed.url.includes('?')) {
    try {
      const urlObj = new URL(parsed.url)
      urlObj.searchParams.forEach((v, k) => {
        params.push({ id: uid(), key: k, value: v, enabled: true })
      })
    } catch { /* ignore */ }
  }

  return {
    ...existing,
    method: parsed.method,
    url: parsed.url.split('?')[0],
    headers: filteredHeaders.length ? filteredHeaders : [blankKVRow()],
    params,
    bodies: [parsed.body ? body : blankBody()],
    activeBodyIdx: 0,
    auth,
  }
}
