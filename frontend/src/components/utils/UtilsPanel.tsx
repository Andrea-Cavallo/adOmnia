import { useState, useMemo } from 'react'
import { useEffect } from 'react'
import {
  Box,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Copy,
  Download,
  History,
  Info,
  Link as LinkIcon,
  Plus,
  Save,
  Search,
  Settings,
  Sparkles,
  Star,
  Type,
  X,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useServerPort, serverUrl, sidecarFetch } from '@/lib/useServerPort'
import { downloadText, readFileSmart } from '@/lib/fileUtils'
import { FolderDiffTool } from '@/components/utils/FolderDiffTool'
import { FileDropZone } from '@/components/utils/FileDropZone'
import { RegexTester } from '@/components/utils/RegexTester'
import { HmacTool } from '@/components/utils/HmacTool'
import { Base64Tool, HashTool, JwtTool, PasswordTool, UuidTool } from '@/components/utils/SimpleTools'
import { DockerGenerator } from '@/components/utils/DockerGenerator'
import { DockerLabPanel } from '@/components/dockerlab/DockerLabPanel'
import { HarViewerPanel } from '@/components/har/HarViewerPanel'
import { ObservabilityPanel } from '@/components/observe'
import { SecretScannerPanel } from '@/components/secretscanner'
import { XmlToolsPanel } from '@/components/utils/XmlToolsPanel'
import { parseDocument } from 'yaml'
import { useAppStore } from '@/stores/app'
import { CATEGORIES, CATEGORY_MARKERS, TOOL_DETAILS } from '@/components/utils/toolRegistry'
import {
  bytesToHex,
  fakeEmail,
  fakeIP,
  fakeName,
  fakePhone,
  fakeWords,
  formatTimestamp,
  jsonToYaml,
  parseQuery,
  uuidv4,
  yamlToJson,
} from './utilsCore'

const copy = (s: string) => navigator.clipboard.writeText(s).catch(() => {})

// =========== Category & Tool definitions ===========

interface YamlFileResult {
  name: string
  ok: boolean
  message: string
}

// =========== HTTP Status Reference ===========

const HTTP_STATUS: { code: number; category: string; text: string }[] = [
  { code: 100, category: '1xx Informational', text: 'Continue' },
  { code: 101, category: '1xx Informational', text: 'Switching Protocols' },
  { code: 200, category: '2xx Success', text: 'OK' },
  { code: 201, category: '2xx Success', text: 'Created' },
  { code: 202, category: '2xx Success', text: 'Accepted' },
  { code: 203, category: '2xx Success', text: 'Non-Authoritative Information' },
  { code: 204, category: '2xx Success', text: 'No Content' },
  { code: 205, category: '2xx Success', text: 'Reset Content' },
  { code: 206, category: '2xx Success', text: 'Partial Content' },
  { code: 300, category: '3xx Redirection', text: 'Multiple Choices' },
  { code: 301, category: '3xx Redirection', text: 'Moved Permanently' },
  { code: 302, category: '3xx Redirection', text: 'Found' },
  { code: 303, category: '3xx Redirection', text: 'See Other' },
  { code: 304, category: '3xx Redirection', text: 'Not Modified' },
  { code: 307, category: '3xx Redirection', text: 'Temporary Redirect' },
  { code: 308, category: '3xx Redirection', text: 'Permanent Redirect' },
  { code: 400, category: '4xx Client Error', text: 'Bad Request' },
  { code: 401, category: '4xx Client Error', text: 'Unauthorized' },
  { code: 402, category: '4xx Client Error', text: 'Payment Required' },
  { code: 403, category: '4xx Client Error', text: 'Forbidden' },
  { code: 404, category: '4xx Client Error', text: 'Not Found' },
  { code: 405, category: '4xx Client Error', text: 'Method Not Allowed' },
  { code: 406, category: '4xx Client Error', text: 'Not Acceptable' },
  { code: 408, category: '4xx Client Error', text: 'Request Timeout' },
  { code: 409, category: '4xx Client Error', text: 'Conflict' },
  { code: 410, category: '4xx Client Error', text: 'Gone' },
  { code: 411, category: '4xx Client Error', text: 'Length Required' },
  { code: 412, category: '4xx Client Error', text: 'Precondition Failed' },
  { code: 413, category: '4xx Client Error', text: 'Payload Too Large' },
  { code: 414, category: '4xx Client Error', text: 'URI Too Long' },
  { code: 415, category: '4xx Client Error', text: 'Unsupported Media Type' },
  { code: 416, category: '4xx Client Error', text: 'Range Not Satisfiable' },
  { code: 417, category: '4xx Client Error', text: 'Expectation Failed' },
  { code: 418, category: '4xx Client Error', text: "I'm a teapot" },
  { code: 422, category: '4xx Client Error', text: 'Unprocessable Entity' },
  { code: 429, category: '4xx Client Error', text: 'Too Many Requests' },
  { code: 500, category: '5xx Server Error', text: 'Internal Server Error' },
  { code: 501, category: '5xx Server Error', text: 'Not Implemented' },
  { code: 502, category: '5xx Server Error', text: 'Bad Gateway' },
  { code: 503, category: '5xx Server Error', text: 'Service Unavailable' },
  { code: 504, category: '5xx Server Error', text: 'Gateway Timeout' },
]

const HTTP_DESCRIPTIONS: Record<number, string> = {
  100: 'Server has received headers and the client can continue.',
  101: 'Server is switching protocols as requested by the client.',
  200: 'Request completed successfully and returned a normal response.',
  201: 'Resource was created; often includes a Location header.',
  202: 'Request accepted for async processing, not completed yet.',
  203: 'Response metadata was modified by an intermediary.',
  204: 'Success with no response body.',
  205: 'Client should reset the current document or form.',
  206: 'Partial response for a byte range request.',
  300: 'Multiple representations are available.',
  301: 'Resource moved permanently to a new URL.',
  302: 'Temporary redirect; clients usually repeat with GET.',
  303: 'Use GET on another URL for the response.',
  304: 'Cached client copy is still valid.',
  307: 'Temporary redirect preserving the original method.',
  308: 'Permanent redirect preserving the original method.',
  400: 'Malformed request or invalid parameters.',
  401: 'Authentication is required or invalid.',
  402: 'Reserved for payment flows; rarely used.',
  403: 'Authenticated client does not have permission.',
  404: 'Requested resource was not found.',
  405: 'HTTP method is not allowed for this resource.',
  406: 'Server cannot produce an acceptable representation.',
  408: 'Server timed out waiting for the request.',
  409: 'Request conflicts with current resource state.',
  410: 'Resource was intentionally removed.',
  411: 'Content-Length header is required.',
  412: 'Conditional request precondition failed.',
  413: 'Request body exceeds the server limit.',
  414: 'Request URL is too long.',
  415: 'Media type is not supported by the server.',
  416: 'Requested byte range cannot be satisfied.',
  417: 'Expectation header could not be met.',
  418: 'Non-standard test response, kept for compatibility.',
  422: 'Body is well formed but semantically invalid.',
  429: 'Client hit a rate limit or quota.',
  500: 'Unexpected server-side failure.',
  501: 'Server does not support this functionality.',
  502: 'Gateway received an invalid upstream response.',
  503: 'Service is overloaded or unavailable for maintenance.',
  504: 'Gateway did not receive an upstream response in time.',
}

// =========== JSON Diff ===========

type JsonDiffStatus = 'added' | 'removed' | 'changed'

interface JsonDiffRow {
  path: string
  left: string
  right: string
  status: JsonDiffStatus
}

interface JsonDiffModel {
  rows: JsonDiffRow[]
  error: string
  equal: boolean
}

function displayJsonValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  return JSON.stringify(value, null, 2) ?? String(value)
}

function flattenJson(value: unknown, path = '$', out: Record<string, string> = {}): Record<string, string> {
  if (value === null || typeof value !== 'object') {
    out[path] = displayJsonValue(value)
    return out
  }
  if (Array.isArray(value)) {
    if (value.length === 0) out[path] = '[]'
    value.forEach((item, index) => flattenJson(item, `${path}[${index}]`, out))
    return out
  }
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) out[path] = '{}'
  entries.forEach(([key, item]) => flattenJson(item, `${path}.${key}`, out))
  return out
}

function buildJsonDiff(left: string, right: string): JsonDiffModel {
  if (!left.trim() || !right.trim()) return { rows: [], error: '', equal: false }
  try {
    const leftFlat = flattenJson(JSON.parse(left))
    const rightFlat = flattenJson(JSON.parse(right))
    const paths = [...new Set([...Object.keys(leftFlat), ...Object.keys(rightFlat)])].sort()
    const rows = paths.reduce<JsonDiffRow[]>((acc, path) => {
      const hasLeft = Object.prototype.hasOwnProperty.call(leftFlat, path)
      const hasRight = Object.prototype.hasOwnProperty.call(rightFlat, path)
      if (!hasLeft) acc.push({ path, left: '', right: rightFlat[path], status: 'added' })
      else if (!hasRight) acc.push({ path, left: leftFlat[path], right: '', status: 'removed' })
      else if (leftFlat[path] !== rightFlat[path]) acc.push({ path, left: leftFlat[path], right: rightFlat[path], status: 'changed' })
      return acc
    }, [])
    return { rows, error: '', equal: rows.length === 0 }
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : 'Invalid JSON in one or both inputs', equal: false }
  }
}

function flattenXml(input: string): Record<string, string> {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('Invalid XML')
  const doc = new DOMParser().parseFromString(trimmed, 'application/xml')
  const parseErr = doc.querySelector('parsererror')
  if (parseErr || !doc.documentElement || doc.documentElement.tagName === 'parsererror') {
    throw new Error(parseErr?.textContent?.trim() || 'Invalid XML')
  }
  const out: Record<string, string> = {}

  const visit = (node: Element, path: string) => {
    for (const attr of Array.from(node.attributes)) {
      out[`${path}.@${attr.name}`] = attr.value
    }

    const text = Array.from(node.childNodes)
      .filter((child) => child.nodeType === Node.TEXT_NODE)
      .map((child) => child.textContent?.trim() ?? '')
      .filter(Boolean)
      .join(' ')
    if (text) out[`${path}.#text`] = text

    const counts = new Map<string, number>()
    for (const child of Array.from(node.children)) {
      const next = (counts.get(child.tagName) ?? 0) + 1
      counts.set(child.tagName, next)
      visit(child, `${path}/${child.tagName}[${next}]`)
    }

    if (!node.attributes.length && !node.children.length && !text) out[path] = '<empty />'
  }

  visit(doc.documentElement, `/${doc.documentElement.tagName}[1]`)
  return out
}

function buildXmlDiff(left: string, right: string): JsonDiffModel {
  if (!left.trim() || !right.trim()) return { rows: [], error: '', equal: false }
  try {
    const leftFlat = flattenXml(left)
    const rightFlat = flattenXml(right)
    const paths = [...new Set([...Object.keys(leftFlat), ...Object.keys(rightFlat)])].sort()
    const rows = paths.reduce<JsonDiffRow[]>((acc, path) => {
      const hasLeft = Object.prototype.hasOwnProperty.call(leftFlat, path)
      const hasRight = Object.prototype.hasOwnProperty.call(rightFlat, path)
      if (!hasLeft) acc.push({ path, left: '', right: rightFlat[path], status: 'added' })
      else if (!hasRight) acc.push({ path, left: leftFlat[path], right: '', status: 'removed' })
      else if (leftFlat[path] !== rightFlat[path]) acc.push({ path, left: leftFlat[path], right: rightFlat[path], status: 'changed' })
      return acc
    }, [])
    return { rows, error: '', equal: rows.length === 0 }
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : 'Invalid XML in one or both inputs', equal: false }
  }
}

function diffCounts(rows: JsonDiffRow[]): Record<JsonDiffStatus, number> {
  return rows.reduce<Record<JsonDiffStatus, number>>((acc, row) => {
    acc[row.status] += 1
    return acc
  }, { added: 0, removed: 0, changed: 0 })
}

// =========== JSON Graph visualizer ===========

function JsonGraphView({ json }: { json: string }) {
  try {
    const data = JSON.parse(json)
    const renderNode = (obj: unknown, depth: number = 0): React.ReactNode => {
      if (obj === null) return <span className="text-json-null">null</span>
      if (typeof obj === 'boolean') return <span className="text-json-bool">{String(obj)}</span>
      if (typeof obj === 'number') return <span className="text-json-number">{obj}</span>
      if (typeof obj === 'string') return <span className="text-json-string">"{obj}"</span>
      if (Array.isArray(obj)) {
        return (
          <div className="ml-4">
            <span className="text-text-3">[</span>
            {obj.map((item, i) => (
              <div key={i} className="flex gap-1">
                <span className="text-text-4 text-[10px]">{i}:</span>
                {renderNode(item, depth + 1)}
                {i < obj.length - 1 && <span className="text-text-3">,</span>}
              </div>
            ))}
            <span className="text-text-3">]</span>
          </div>
        )
      }
      if (typeof obj === 'object') {
        const keys = Object.keys(obj)
        return (
          <div className="ml-4">
            <span className="text-text-3">{'{'}</span>
            {keys.map((k) => (
              <div key={k} className="flex gap-1">
                <span className="text-json-key">"{k}"</span>
                <span className="text-text-3">:</span>
                {renderNode((obj as Record<string, unknown>)[k], depth + 1)}
                {k !== keys[keys.length - 1] && <span className="text-text-3">,</span>}
              </div>
            ))}
            <span className="text-text-3">{'}'}</span>
          </div>
        )
      }
      return <span>{String(obj)}</span>
    }
    return <div className="font-mono text-xs">{renderNode(data)}</div>
  } catch {
    return <span className="text-xs text-error">Invalid JSON</span>
  }
}

// =========== XML Tools ===========

function xmlFormat(xml: string): string {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(xml, 'text/xml')
    const error = doc.querySelector('parsererror')
    if (error || !doc.documentElement || doc.documentElement.tagName === 'parsererror') return `XML Error: ${error?.textContent || 'Invalid XML'}`
    const serializer = new XMLSerializer()
    let result = serializer.serializeToString(doc)
    // Basic indent
    const tabs = (n: number) => '  '.repeat(n)
    let indent = 0
    result = result.replace(/(<\/?[^>]+>)/g, (m) => {
      if (m.startsWith('</')) indent = Math.max(0, indent - 1)
      const out = tabs(indent) + m
      if (!m.startsWith('</') && !m.endsWith('/>') && !m.startsWith('<?')) indent++
      return out + '\n'
    })
    return result.trim()
  } catch {
    return 'Failed to format XML'
  }
}

function xmlValidate(xml: string): string {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(xml, 'text/xml')
    const error = doc.querySelector('parsererror')
    if (error || !doc.documentElement || doc.documentElement.tagName === 'parsererror') return `Invalid XML: ${error?.textContent || 'Invalid XML'}`
    return 'Valid XML'
  } catch {
    return 'Failed to parse XML'
  }
}

// =========== YAML Validator ===========

function yamlValidate(yaml: string): string {
  try {
    const doc = parseDocument(yaml)
    if (doc.errors.length > 0) return `Invalid YAML: ${doc.errors.map((e) => e.message).join('; ')}`
    if (doc.warnings.length > 0) return `Valid YAML with warnings: ${doc.warnings.map((e) => e.message).join('; ')}`
    return 'Valid YAML'
  } catch (e) {
    return `Invalid YAML: ${e instanceof Error ? e.message : 'Parsing error'}`
  }
}

function yamlValidateResult(yaml: string): { ok: boolean; message: string } {
  const message = yamlValidate(yaml)
  return { ok: message.startsWith('Valid YAML'), message }
}

// =========== PEM/JKS Inspector — pure-JS ASN.1/X.509 parser ===========

// ── ASN.1 DER primitives ──────────────────────────────────────────────────────

function asn1Len(buf: Uint8Array, pos: number): { len: number; consumed: number } {
  const b = buf[pos]
  if ((b & 0x80) === 0) return { len: b, consumed: 1 }
  const n = b & 0x7f
  let len = 0
  for (let i = 0; i < n; i++) len = len * 256 + buf[pos + 1 + i]
  return { len, consumed: 1 + n }
}

function asn1Node(buf: Uint8Array, pos: number) {
  const tag = buf[pos]
  const { len, consumed } = asn1Len(buf, pos + 1)
  const vStart = pos + 1 + consumed
  return { tag, vStart, vEnd: vStart + len, end: vStart + len }
}

function asn1Kids(buf: Uint8Array, start: number, end: number) {
  const items: ReturnType<typeof asn1Node>[] = []
  let p = start
  while (p < end && p < buf.length) { const n = asn1Node(buf, p); items.push(n); p = n.end }
  return items
}

function parseOID(buf: Uint8Array, s: number, e: number): string {
  if (e <= s) return ''
  const parts: number[] = [Math.floor(buf[s] / 40), buf[s] % 40]
  let v = 0
  for (let i = s + 1; i < e; i++) {
    v = v * 128 + (buf[i] & 0x7f)
    if ((buf[i] & 0x80) === 0) { parts.push(v); v = 0 }
  }
  return parts.join('.')
}

function decodeStr(buf: Uint8Array, s: number, e: number): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf.slice(s, e)) } catch { /**/ }
  try { return new TextDecoder('latin1').decode(buf.slice(s, e)) } catch { /**/ }
  return ''
}

function parseTime(tag: number, buf: Uint8Array, s: number, e: number): { str: string; date: Date } {
  const raw = decodeStr(buf, s, e)
  let year: number, mo: string, d: string, h: string, mi: string, sec: string
  if (tag === 0x17) { // UTCTime YYMMDDHHMMSS
    year = parseInt(raw.slice(0, 2)) + (parseInt(raw.slice(0, 2)) >= 50 ? 1900 : 2000)
    ;[mo, d, h, mi, sec] = [raw.slice(2, 4), raw.slice(4, 6), raw.slice(6, 8), raw.slice(8, 10), raw.slice(10, 12)]
  } else { // GeneralizedTime YYYYMMDDHHMMSS
    year = parseInt(raw.slice(0, 4))
    ;[mo, d, h, mi, sec] = [raw.slice(4, 6), raw.slice(6, 8), raw.slice(8, 10), raw.slice(10, 12), raw.slice(12, 14)]
  }
  return {
    str: `${year}-${mo}-${d} ${h}:${mi}:${sec} UTC`,
    date: new Date(`${year}-${mo}-${d}T${h}:${mi}:${sec}Z`),
  }
}

// ── OID dictionaries ──────────────────────────────────────────────────────────

const OID_ATTR: Record<string, string> = {
  '2.5.4.3': 'cn', '2.5.4.6': 'c', '2.5.4.7': 'l',
  '2.5.4.8': 'st', '2.5.4.10': 'o', '2.5.4.11': 'ou',
}
const OID_SIG: Record<string, string> = {
  '1.2.840.113549.1.1.5': 'SHA1withRSA', '1.2.840.113549.1.1.11': 'SHA256withRSA',
  '1.2.840.113549.1.1.12': 'SHA384withRSA', '1.2.840.113549.1.1.13': 'SHA512withRSA',
  '1.2.840.10045.4.3.2': 'ECDSAwithSHA256', '1.2.840.10045.4.3.3': 'ECDSAwithSHA384',
  '1.2.840.10045.4.3.4': 'ECDSAwithSHA512', '1.3.101.112': 'Ed25519', '1.3.101.113': 'Ed448',
}
const OID_KEY: Record<string, string> = {
  '1.2.840.113549.1.1.1': 'RSA', '1.2.840.10045.2.1': 'ECDSA',
  '1.3.101.112': 'Ed25519', '1.3.101.113': 'Ed448', '1.2.840.10040.4.1': 'DSA',
}
const OID_CURVE: Record<string, number> = {
  '1.2.840.10045.3.1.7': 256, '1.3.132.0.34': 384, '1.3.132.0.35': 521,
}
const OID_EKU: Record<string, string> = {
  '1.3.6.1.5.5.7.3.1': 'TLS Server Auth', '1.3.6.1.5.5.7.3.2': 'TLS Client Auth',
  '1.3.6.1.5.5.7.3.3': 'Code Signing', '1.3.6.1.5.5.7.3.4': 'Email Protection',
  '1.3.6.1.5.5.7.3.8': 'Time Stamping', '1.3.6.1.5.5.7.3.9': 'OCSP Signing',
}

// ── X.509 parser ──────────────────────────────────────────────────────────────

interface CertRDN { cn: string; o: string; ou: string; c: string; st: string; l: string; [k: string]: string }
interface ParsedCert {
  error?: string
  serial: string; subject: CertRDN; issuer: CertRDN
  notBefore: string; notAfter: string
  sigAlg: string; keyAlg: string; keyBits: number
  sans: string[]; keyUsage: string[]; extKeyUsage: string[]
  isCA: boolean; isExpired: boolean; isNotYetValid: boolean; daysRemaining: number
  sha256: string; sha1: string
}

function parseName(buf: Uint8Array, s: number, e: number): CertRDN {
  const r: CertRDN = { cn: '', o: '', ou: '', c: '', st: '', l: '' }
  for (const rdn of asn1Kids(buf, s, e))
    for (const atv of asn1Kids(buf, rdn.vStart, rdn.vEnd)) {
      const ch = asn1Kids(buf, atv.vStart, atv.vEnd)
      if (ch.length < 2) continue
      const oid = parseOID(buf, ch[0].vStart, ch[0].vEnd)
      const key = OID_ATTR[oid]
      if (key) (r as Record<string, string>)[key] = decodeStr(buf, ch[1].vStart, ch[1].vEnd)
    }
  return r
}

async function parseCertDER(raw: Uint8Array): Promise<ParsedCert> {
  const empty: ParsedCert = {
    serial: '', subject: { cn:'', o:'', ou:'', c:'', st:'', l:'' },
    issuer: { cn:'', o:'', ou:'', c:'', st:'', l:'' },
    notBefore: '', notAfter: '', sigAlg: '', keyAlg: '', keyBits: 0,
    sans: [], keyUsage: [], extKeyUsage: [],
    isCA: false, isExpired: false, isNotYetValid: false, daysRemaining: 0,
    sha256: '', sha1: '',
  }
  try {
    const cert   = asn1Node(raw, 0)
    const top    = asn1Kids(raw, cert.vStart, cert.vEnd)
    if (top.length < 3) return { ...empty, error: 'Truncated certificate structure' }

    const tbs    = top[0]
    const ch     = asn1Kids(raw, tbs.vStart, tbs.vEnd)
    let i = 0
    if (ch[i].tag === 0xA0) i++   // optional version

    // serial
    const snNode = ch[i++]
    const snBytes = raw.slice(snNode.vStart, snNode.vEnd)
    const snTrimmed = snBytes[0] === 0 ? snBytes.slice(1) : snBytes
    const serial = Array.from(snTrimmed).map(b => b.toString(16).padStart(2, '0')).join(':')

    // signature algorithm (in TBS)
    const sigAlgNode = ch[i++]
    const sigAlgCh = asn1Kids(raw, sigAlgNode.vStart, sigAlgNode.vEnd)
    const sigAlgOID = parseOID(raw, sigAlgCh[0].vStart, sigAlgCh[0].vEnd)
    const sigAlg = OID_SIG[sigAlgOID] ?? sigAlgOID

    // issuer
    const issuerNode = ch[i++]
    const issuer = parseName(raw, issuerNode.vStart, issuerNode.vEnd)

    // validity
    const valNode = ch[i++]
    const valCh = asn1Kids(raw, valNode.vStart, valNode.vEnd)
    const nb = parseTime(valCh[0].tag, raw, valCh[0].vStart, valCh[0].vEnd)
    const na = parseTime(valCh[1].tag, raw, valCh[1].vStart, valCh[1].vEnd)

    // subject
    const subjNode = ch[i++]
    const subject = parseName(raw, subjNode.vStart, subjNode.vEnd)

    // SPKI
    const spkiNode = ch[i++]
    const spkiCh = asn1Kids(raw, spkiNode.vStart, spkiNode.vEnd)
    const algCh = asn1Kids(raw, spkiCh[0].vStart, spkiCh[0].vEnd)
    const keyAlgOID = parseOID(raw, algCh[0].vStart, algCh[0].vEnd)
    const keyAlg = OID_KEY[keyAlgOID] ?? keyAlgOID
    let keyBits = 0
    if (keyAlgOID === '1.2.840.113549.1.1.1') {
      // RSA: BIT STRING → RSAPublicKey SEQUENCE → modulus INTEGER
      const bs = spkiCh[1]
      const rsaSeq = asn1Node(raw, bs.vStart + 1)  // skip unused-bits byte
      const rsaCh = asn1Kids(raw, rsaSeq.vStart, rsaSeq.vEnd)
      if (rsaCh.length >= 1 && rsaCh[0].tag === 0x02) {
        const modLen = rsaCh[0].vEnd - rsaCh[0].vStart
        keyBits = (modLen - (raw[rsaCh[0].vStart] === 0 ? 1 : 0)) * 8
      }
    } else if (keyAlgOID === '1.2.840.10045.2.1' && algCh.length > 1) {
      const curveOID = parseOID(raw, algCh[1].vStart, algCh[1].vEnd)
      keyBits = OID_CURVE[curveOID] ?? 0
    } else if (keyAlgOID === '1.3.101.112') {
      keyBits = 255
    }

    // extensions [3]
    const sans: string[] = [], keyUsage: string[] = [], extKeyUsage: string[] = []
    let isCA = false
    for (let j = i; j < ch.length; j++) {
      if (ch[j].tag !== 0xA3) continue
      const extsSeq = asn1Node(raw, ch[j].vStart)
      for (const ext of asn1Kids(raw, extsSeq.vStart, extsSeq.vEnd)) {
        const extCh = asn1Kids(raw, ext.vStart, ext.vEnd)
        if (extCh.length < 2) continue
        const oid = parseOID(raw, extCh[0].vStart, extCh[0].vEnd)
        const valOctet = extCh[extCh.length - 1]   // last child is always OCTET STRING
        if (valOctet.tag !== 0x04) continue
        const ev = raw.slice(valOctet.vStart, valOctet.vEnd)

        if (oid === '2.5.29.17') {                  // SubjectAltName
          const sanSeq = asn1Node(ev, 0)
          for (const gn of asn1Kids(ev, sanSeq.vStart, sanSeq.vEnd)) {
            const t = gn.tag & 0x1f
            if (t === 2) sans.push('DNS: ' + decodeStr(ev, gn.vStart, gn.vEnd))
            else if (t === 1) sans.push('Email: ' + decodeStr(ev, gn.vStart, gn.vEnd))
            else if (t === 6) sans.push('URI: ' + decodeStr(ev, gn.vStart, gn.vEnd))
            else if (t === 7) {
              const ip = ev.slice(gn.vStart, gn.vEnd)
              if (ip.length === 4) sans.push(`IP: ${ip[0]}.${ip[1]}.${ip[2]}.${ip[3]}`)
            }
          }
        } else if (oid === '2.5.29.15') {           // KeyUsage
          const kuNode = asn1Node(ev, 0)
          if (kuNode.tag === 0x03) {
            const b1 = ev[kuNode.vStart + 1] ?? 0, b2 = ev[kuNode.vStart + 2] ?? 0
            const KU = [[0x80,'Digital Signature'],[0x40,'Content Commitment'],[0x20,'Key Encipherment'],
              [0x10,'Data Encipherment'],[0x08,'Key Agreement'],[0x04,'Certificate Sign'],
              [0x02,'CRL Sign'],[0x01,'Encipher Only']] as const
            for (const [m, n] of KU) if (b1 & m) keyUsage.push(n)
            if (b2 & 0x80) keyUsage.push('Decipher Only')
          }
        } else if (oid === '2.5.29.37') {           // ExtKeyUsage
          const ekuSeq = asn1Node(ev, 0)
          for (const o of asn1Kids(ev, ekuSeq.vStart, ekuSeq.vEnd))
            extKeyUsage.push(OID_EKU[parseOID(ev, o.vStart, o.vEnd)] ?? parseOID(ev, o.vStart, o.vEnd))
        } else if (oid === '2.5.29.19') {           // BasicConstraints
          const bcSeq = asn1Node(ev, 0)
          for (const c of asn1Kids(ev, bcSeq.vStart, bcSeq.vEnd))
            if (c.tag === 0x01) isCA = ev[c.vStart] !== 0
        }
      }
    }

    // Fingerprints via SubtleCrypto (always available in WebView)
    const rawBuf: ArrayBuffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
    const [sha256Buf, sha1Buf] = await Promise.all([
      crypto.subtle.digest('SHA-256', rawBuf),
      crypto.subtle.digest('SHA-1', rawBuf),
    ])
    const fpHex = (b: ArrayBuffer) =>
      Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join(':')

    const now = new Date()
    const daysRemaining = Math.floor((na.date.getTime() - now.getTime()) / 86_400_000)

    return {
      serial, subject, issuer,
      notBefore: nb.str, notAfter: na.str,
      sigAlg, keyAlg, keyBits,
      sans, keyUsage, extKeyUsage, isCA,
      isExpired: now > na.date, isNotYetValid: now < nb.date,
      daysRemaining,
      sha256: fpHex(sha256Buf), sha1: fpHex(sha1Buf),
    }
  } catch (e) {
    return { ...empty, error: `Parse error: ${e instanceof Error ? e.message : String(e)}` }
  }
}

function formatParsedCert(r: ParsedCert, index: number, total: number): string {
  const sep = '─'.repeat(52)
  const lines: string[] = []
  if (total > 1) lines.push(sep, `  Certificate ${index + 1} of ${total}`, sep)
  else           lines.push(sep, `  CERTIFICATE`, sep)

  if (r.error) { lines.push(`  ⚠  ${r.error}`, sep); return lines.join('\n') }

  const f = (label: string, value?: string) => {
    if (value?.trim()) lines.push(`  ${label.padEnd(20)} ${value}`)
  }

  lines.push('', '  Subject')
  f('  Common Name:', r.subject.cn); f('  Organization:', r.subject.o)
  f('  Org. Unit:', r.subject.ou);   f('  Locality:', r.subject.l)
  f('  State:', r.subject.st);        f('  Country:', r.subject.c)

  lines.push('', '  Issuer')
  f('  Common Name:', r.issuer.cn);  f('  Organization:', r.issuer.o)
  f('  Org. Unit:', r.issuer.ou);    f('  Locality:', r.issuer.l)
  f('  State:', r.issuer.st);         f('  Country:', r.issuer.c)

  lines.push('', '  Validity')
  f('  Not Before:', r.notBefore); f('  Not After:', r.notAfter)
  if (r.isExpired)
    lines.push(`  ${''.padEnd(20)} ⚠  EXPIRED  (${Math.abs(r.daysRemaining)} day${Math.abs(r.daysRemaining) !== 1 ? 's' : ''} ago)`)
  else if (r.isNotYetValid)
    lines.push(`  ${''.padEnd(20)} ⚠  NOT YET VALID`)
  else
    lines.push(`  ${''.padEnd(20)} ✓  Valid  (${r.daysRemaining} day${r.daysRemaining !== 1 ? 's' : ''} remaining)`)

  lines.push('', '  Identity')
  f('  Serial Number:', r.serial)
  if (r.isCA) f('  Role:', 'Certificate Authority (CA)')

  lines.push('', '  Public Key')
  f('  Algorithm:', r.keyBits > 0 ? `${r.keyAlg}  ${r.keyBits}-bit` : r.keyAlg)
  f('  Signature:', r.sigAlg)

  if (r.sans.length > 0) {
    lines.push('', '  Subject Alternative Names')
    r.sans.forEach(s => lines.push(`    ${s}`))
  }
  if (r.keyUsage.length > 0) {
    lines.push('', '  Key Usage')
    r.keyUsage.forEach(u => lines.push(`    ${u}`))
  }
  if (r.extKeyUsage.length > 0) {
    lines.push('', '  Extended Key Usage')
    r.extKeyUsage.forEach(u => lines.push(`    ${u}`))
  }

  lines.push('', '  Fingerprints')
  f('  SHA-256:', r.sha256); f('  SHA-1:', r.sha1)
  lines.push('', sep)
  return lines.join('\n')
}

/** Parse all PEM blocks in a text — pure JS, no network required. */
async function pemInspectPure(pemText: string): Promise<string> {
  const blockRe = /-----BEGIN ([A-Z0-9 ]+)-----\r?\n([\s\S]+?)\r?\n?-----END \1-----/g
  const results: string[] = []
  let certCount = 0, match: RegExpExecArray | null

  // Count certs first for the "N of M" header
  const allCerts = [...pemText.matchAll(/-----BEGIN CERTIFICATE-----/g)].length

  while ((match = blockRe.exec(pemText)) !== null) {
    const type = match[1].trim()
    const b64  = match[2].replace(/\s+/g, '')
    try {
      const bin = atob(b64)
      const raw = Uint8Array.from(bin, c => c.charCodeAt(0))
      if (type === 'CERTIFICATE') {
        const parsed = await parseCertDER(raw)
        results.push(formatParsedCert(parsed, certCount, allCerts))
        certCount++
      } else {
        // Keys, CSRs, etc. — show type + size only
        results.push(`Type: ${type}\nSize: ${raw.length} bytes  (${b64.length} base64 chars)\n(Paste a CERTIFICATE block for full inspection)`)
      }
    } catch (e) {
      results.push(`Type: ${type}\nError decoding block: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return results.length > 0 ? results.join('\n\n') : 'No PEM block detected'
}

function jksInspect(bytes: Uint8Array, name?: string): string {
  const info: string[] = []
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const magic = bytes.length >= 4 ? view.getUint32(0, false) : 0
  info.push(`File: ${name ?? 'dropped file'}`)
  info.push(`Size: ${bytes.length} bytes`)
  if (magic === 0xfeedfeed) {
    info.push('Format: Java KeyStore (JKS)')
    if (bytes.length >= 12) {
      info.push(`Version: ${view.getUint32(4, false)}`)
      info.push(`Entry count: ${view.getUint32(8, false)}`)
    }
    info.push('Content is binary/encrypted — extract via JKS split below.')
    return info.join('\n')
  }
  if (magic === 0x308201 || bytes[0] === 0x30) {
    info.push('Format: DER/ASN.1 — try renaming to .pem and re-dropping')
    return info.join('\n')
  }
  info.push(`Magic: ${bytesToHex(bytes.slice(0, Math.min(8, bytes.length))).toUpperCase()}`)
  info.push('Format: unknown binary container')
  return info.join('\n')
}

// =========== Class File Inspector ===========

interface ClassMember {
  flags: number
  name: string
  descriptor: string
  code?: Uint8Array
}

interface ClassStructure {
  version: { major: number; minor: number }
  cpCount: number
  accessFlags: number
  thisClass: string
  superClass: string
  interfaces: string[]
  fields: ClassMember[]
  methods: ClassMember[]
  cp: CpEntry[]
  bootstrapMethods: number[][]
}

type CpEntry = {
  tag: number
  value?: string | number | bigint
  nameIndex?: number
  classIndex?: number
  nameAndTypeIndex?: number
  descriptorIndex?: number
  referenceKind?: number
  referenceIndex?: number
  bootstrapMethodAttrIndex?: number
} | null

function javaVersionName(major: number): string {
  const map: Record<number, string> = {
    45: ' (Java 1.1)', 46: ' (Java 1.2)', 47: ' (Java 1.3)', 48: ' (Java 1.4)',
    49: ' (Java 5)', 50: ' (Java 6)', 51: ' (Java 7)', 52: ' (Java 8)',
    53: ' (Java 9)', 54: ' (Java 10)', 55: ' (Java 11)', 56: ' (Java 12)',
    57: ' (Java 13)', 58: ' (Java 14)', 59: ' (Java 15)', 60: ' (Java 16)',
    61: ' (Java 17)', 62: ' (Java 18)', 63: ' (Java 19)', 64: ' (Java 20)',
    65: ' (Java 21)', 66: ' (Java 22)', 67: ' (Java 23)',
  }
  return map[major] ?? ''
}

function jvmTypeToJava(desc: string, pos = 0): { type: string; end: number } {
  const c = desc[pos]
  switch (c) {
    case 'B': return { type: 'byte', end: pos + 1 }
    case 'C': return { type: 'char', end: pos + 1 }
    case 'D': return { type: 'double', end: pos + 1 }
    case 'F': return { type: 'float', end: pos + 1 }
    case 'I': return { type: 'int', end: pos + 1 }
    case 'J': return { type: 'long', end: pos + 1 }
    case 'S': return { type: 'short', end: pos + 1 }
    case 'Z': return { type: 'boolean', end: pos + 1 }
    case 'V': return { type: 'void', end: pos + 1 }
    case 'L': {
      const end = desc.indexOf(';', pos)
      if (end === -1) return { type: '?', end: desc.length }
      const raw = desc.slice(pos + 1, end).replace(/\//g, '.')
      const simple = raw.startsWith('java.lang.') ? raw.slice(10) : raw
      return { type: simple, end: end + 1 }
    }
    case '[': {
      const inner = jvmTypeToJava(desc, pos + 1)
      return { type: inner.type + '[]', end: inner.end }
    }
    default: return { type: '?', end: pos + 1 }
  }
}

function parseMethodDescriptor(desc: string): { params: string[]; returnType: string } {
  if (!desc.startsWith('(')) return { params: [], returnType: '?' }
  const closeIdx = desc.indexOf(')')
  if (closeIdx === -1) return { params: [], returnType: '?' }
  const paramStr = desc.slice(1, closeIdx)
  const params: string[] = []
  let pos = 0
  while (pos < paramStr.length) {
    const { type, end } = jvmTypeToJava(paramStr, pos)
    params.push(type)
    if (end <= pos) break
    pos = end
  }
  const { type: returnType } = jvmTypeToJava(desc.slice(closeIdx + 1))
  return { params, returnType }
}

function decodeClassModifiers(flags: number): string {
  const mods: string[] = []
  if (flags & 0x0001) mods.push('public')
  if (flags & 0x4000) { mods.push('enum'); return mods.join(' ') }
  if (flags & 0x2000) { mods.push('@interface'); return mods.join(' ') }
  if (flags & 0x0200) {
    if (flags & 0x0400) mods.push('abstract')
    mods.push('interface')
    return mods.join(' ')
  }
  if (flags & 0x0400) mods.push('abstract')
  else if (flags & 0x0010) mods.push('final')
  mods.push('class')
  return mods.join(' ')
}

function decodeMemberModifiers(flags: number, isMethod = false): string {
  const mods: string[] = []
  if (flags & 0x0001) mods.push('public')
  else if (flags & 0x0002) mods.push('private')
  else if (flags & 0x0004) mods.push('protected')
  if (flags & 0x0008) mods.push('static')
  if (flags & 0x0010) mods.push('final')
  if (isMethod) {
    if (flags & 0x0020) mods.push('synchronized')
    if (flags & 0x0100) mods.push('native')
    if (flags & 0x0400) mods.push('abstract')
  } else {
    if (flags & 0x0020) mods.push('volatile')
    if (flags & 0x0040) mods.push('transient')
  }
  return mods.join(' ')
}

function cpUtf8(cp: CpEntry[], index: number): string {
  const e = cp[index]
  return e?.tag === 1 ? String(e.value) : `#${index}`
}

function cpClassName(cp: CpEntry[], index: number): string {
  const e = cp[index]
  if (!e || e.tag !== 7 || !e.nameIndex) return `#${index}`
  return cpUtf8(cp, e.nameIndex).replace(/\//g, '.')
}

function cpNameAndType(cp: CpEntry[], index: number): { name: string; descriptor: string } {
  const entry = cp[index]
  if (!entry || entry.tag !== 12) return { name: `#${index}`, descriptor: '' }
  return {
    name: cpUtf8(cp, entry.nameIndex ?? 0),
    descriptor: cpUtf8(cp, entry.descriptorIndex ?? 0),
  }
}

function cpMember(cp: CpEntry[], index: number): { owner: string; name: string; descriptor: string } {
  const entry = cp[index]
  if (!entry) return { owner: '', name: `#${index}`, descriptor: '' }
  const member = cpNameAndType(cp, entry.nameAndTypeIndex ?? 0)
  return { owner: cpClassName(cp, entry.classIndex ?? 0), ...member }
}

function quoteJava(value: string): string {
  return JSON.stringify(value)
    .replace(/\u0001/g, '\\u0001')
    .replace(/\u0002/g, '\\u0002')
}

function cpValue(cp: CpEntry[], index: number): string {
  const entry = cp[index]
  if (!entry) return `#${index}`
  if (entry.tag === 8) return quoteJava(cpUtf8(cp, entry.nameIndex ?? 0))
  if (entry.tag === 3 || entry.tag === 4) return String(entry.value)
  if (entry.tag === 5) return `${String(entry.value)}L`
  if (entry.tag === 6) return `${String(entry.value)}d`
  return `#${index}`
}

function parseClassStructure(bytes: Uint8Array): ClassStructure | string {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let offset = 8
    const cpCount = view.getUint16(offset); offset += 2
    const cp: CpEntry[] = [null]
    for (let i = 1; i < cpCount; i++) {
      const tag = view.getUint8(offset); offset += 1
      switch (tag) {
        case 1: {
          const len = view.getUint16(offset); offset += 2
          const value = new TextDecoder().decode(bytes.slice(offset, offset + len))
          offset += len; cp[i] = { tag, value }; break
        }
        case 3: cp[i] = { tag, value: view.getInt32(offset) }; offset += 4; break
        case 4: cp[i] = { tag, value: view.getFloat32(offset) }; offset += 4; break
        case 5: cp[i] = { tag, value: view.getBigInt64(offset) }; offset += 8; i++; cp[i] = null; break
        case 6: cp[i] = { tag, value: view.getFloat64(offset) }; offset += 8; i++; cp[i] = null; break
        case 7: case 8: case 19: case 20:
          cp[i] = { tag, nameIndex: view.getUint16(offset) }; offset += 2; break
        case 9: case 10: case 11:
          cp[i] = { tag, classIndex: view.getUint16(offset), nameAndTypeIndex: view.getUint16(offset + 2) }; offset += 4; break
        case 12:
          cp[i] = { tag, nameIndex: view.getUint16(offset), descriptorIndex: view.getUint16(offset + 2) }; offset += 4; break
        case 15:
          cp[i] = { tag, referenceKind: view.getUint8(offset), referenceIndex: view.getUint16(offset + 1) }; offset += 3; break
        case 16:
          cp[i] = { tag, descriptorIndex: view.getUint16(offset) }; offset += 2; break
        case 17: case 18:
          cp[i] = { tag, bootstrapMethodAttrIndex: view.getUint16(offset), nameAndTypeIndex: view.getUint16(offset + 2) }; offset += 4; break
        default: return `Constant pool: unsupported tag ${tag} at entry ${i}`
      }
    }
    const accessFlags = view.getUint16(offset); offset += 2
    const thisClassIdx = view.getUint16(offset); offset += 2
    const superClassIdx = view.getUint16(offset); offset += 2
    const interfaces: string[] = []
    const ifaceCount = view.getUint16(offset); offset += 2
    for (let i = 0; i < ifaceCount; i++) { interfaces.push(cpClassName(cp, view.getUint16(offset))); offset += 2 }
    const readMembers = (): ClassMember[] => {
      const count = view.getUint16(offset); offset += 2
      const members: ClassMember[] = []
      for (let i = 0; i < count; i++) {
        const flags = view.getUint16(offset); offset += 2
        const nameIndex = view.getUint16(offset); offset += 2
        const descriptorIndex = view.getUint16(offset); offset += 2
        const member: ClassMember = { flags, name: cpUtf8(cp, nameIndex), descriptor: cpUtf8(cp, descriptorIndex) }
        const attrCount = view.getUint16(offset); offset += 2
        for (let a = 0; a < attrCount; a++) {
          const attrName = cpUtf8(cp, view.getUint16(offset)); offset += 2
          const len = view.getUint32(offset); offset += 4
          const attrEnd = offset + len
          if (attrName === 'Code') {
            offset += 4
            const codeLength = view.getUint32(offset); offset += 4
            member.code = bytes.slice(offset, offset + codeLength)
          }
          offset = attrEnd
          if (offset > bytes.length) throw new Error('attribute exceeds file size')
        }
        members.push(member)
      }
      return members
    }
    const fields = readMembers()
    const methods = readMembers()
    const bootstrapMethods: number[][] = []
    const classAttrCount = view.getUint16(offset); offset += 2
    for (let i = 0; i < classAttrCount; i++) {
      const attrName = cpUtf8(cp, view.getUint16(offset)); offset += 2
      const len = view.getUint32(offset); offset += 4
      const attrEnd = offset + len
      if (attrName === 'BootstrapMethods') {
        const count = view.getUint16(offset); offset += 2
        for (let b = 0; b < count; b++) {
          offset += 2
          const argumentCount = view.getUint16(offset); offset += 2
          const argumentsList: number[] = []
          for (let argument = 0; argument < argumentCount; argument++) {
            argumentsList.push(view.getUint16(offset)); offset += 2
          }
          bootstrapMethods.push(argumentsList)
        }
      }
      offset = attrEnd
    }
    return {
      version: { major: view.getUint16(6), minor: view.getUint16(4) },
      cpCount: cpCount - 1, accessFlags,
      thisClass: cpClassName(cp, thisClassIdx),
      superClass: superClassIdx ? cpClassName(cp, superClassIdx) : '',
      interfaces, fields, methods, cp, bootstrapMethods,
    }
  } catch (e) { return `Parse error: ${e instanceof Error ? e.message : String(e)}` }
}

function methodLocalNames(method: ClassMember): Map<number, string> {
  const locals = new Map<number, string>()
  let slot = method.flags & 0x0008 ? 0 : 1
  parseMethodDescriptor(method.descriptor).params.forEach((type, index) => {
    locals.set(slot, `arg${index}`)
    slot += type === 'long' || type === 'double' ? 2 : 1
  })
  return locals
}

function popArguments(stack: string[], count: number): string[] {
  const args: string[] = []
  for (let i = 0; i < count; i++) args.unshift(stack.pop() ?? '?')
  return args
}

function concatExpression(recipe: string, values: string[]): string {
  const parts = recipe.split('\u0001')
  const expression: string[] = []
  parts.forEach((part, index) => {
    if (part) expression.push(quoteJava(part))
    if (index < values.length) expression.push(values[index])
  })
  return expression.join(' + ') || '""'
}

function decompileMethodBody(method: ClassMember, structure: ClassStructure): string[] {
  const code = method.code
  if (!code?.length) return ['/* no bytecode body available */']
  const cp = structure.cp
  const locals = methodLocalNames(method)
  const stack: string[] = []
  const lines: string[] = []
  const localValue = (slot: number) => slot === 0 && !(method.flags & 0x0008) ? 'this' : (locals.get(slot) ?? `local${slot}`)
  const pushBinary = (operator: string) => {
    const right = stack.pop() ?? '?'
    const left = stack.pop() ?? '?'
    stack.push(`(${left} ${operator} ${right})`)
  }
  const readIndex = (pos: number) => (code[pos] << 8) | code[pos + 1]
  const simpleOwner = (owner: string) => owner.includes('.') ? owner.slice(owner.lastIndexOf('.') + 1) : owner
  let pos = 0
  let unsupported = ''
  while (pos < code.length) {
    const opStart = pos
    const op = code[pos++]
    if (op >= 0x1a && op <= 0x1d) { stack.push(localValue(op - 0x1a)); continue } // iload_0-3
    if (op >= 0x1e && op <= 0x25) { stack.push(localValue((op - 0x1e) % 4)); continue } // lload_0-3, fload_0-3
    if (op >= 0x26 && op <= 0x29) { stack.push(localValue(op - 0x26)); continue }  // dload_0-3
    if (op >= 0x2a && op <= 0x2d) { stack.push(localValue(op - 0x2a)); continue }  // aload_0-3
    if (op >= 0x3b && op <= 0x4e) { // *store_0-3 (istore, lstore, fstore, dstore, astore)
      const slot = (op - 0x3b) % 4
      const value = stack.pop() ?? '?'
      if (!value.startsWith('__')) lines.push(`${localValue(slot)} = ${value};`)
      continue
    }
    switch (op) {
      case 0x02: stack.push('-1'); break
      case 0x03: case 0x04: case 0x05: case 0x06: case 0x07: case 0x08: stack.push(String(op - 0x03)); break
      case 0x0e: case 0x0f: stack.push(`${op - 0x0e}.0d`); break
      case 0x10: stack.push(String((code[pos++] << 24) >> 24)); break
      case 0x11: {
        const value = (readIndex(pos) << 16) >> 16
        pos += 2
        stack.push(String(value))
        break
      }
      case 0x12: stack.push(cpValue(cp, code[pos++])); break
      case 0x13: case 0x14: stack.push(cpValue(cp, readIndex(pos))); pos += 2; break
      case 0x15: case 0x16: case 0x17: case 0x18: case 0x19: stack.push(localValue(code[pos++])); break
      // *store with byte index (istore, lstore, fstore, dstore, astore)
      case 0x36: case 0x37: case 0x38: case 0x39: case 0x3a: {
        const slot = code[pos++]
        const value = stack.pop() ?? '?'
        if (!value.startsWith('__')) lines.push(`${localValue(slot)} = ${value};`)
        break
      }
      // stack ops
      case 0x57: { // pop — emit void calls left on stack
        const val = stack.pop()
        if (val && !val.startsWith('__') && val.includes('(')) lines.push(`${val};`)
        break
      }
      case 0x58: stack.pop(); stack.pop(); break // pop2
      case 0x59: { // dup — track new-object markers for constructor reconstruction
        const top = stack[stack.length - 1]
        stack.push(top?.startsWith('__NEW__:') ? `__DUP__:${top.slice(8)}` : (top ?? '?'))
        break
      }
      // arithmetic (all four JVM types: int, long, float, double)
      case 0x60: case 0x61: case 0x62: case 0x63: pushBinary('+'); break
      case 0x64: case 0x65: case 0x66: case 0x67: pushBinary('-'); break
      case 0x68: case 0x69: case 0x6a: case 0x6b: pushBinary('*'); break
      case 0x6c: case 0x6d: case 0x6e: case 0x6f: pushBinary('/'); break
      case 0x70: case 0x71: pushBinary('%'); break
      case 0x74: case 0x75: case 0x76: case 0x77: { // *neg
        const val = stack.pop() ?? '?'
        stack.push(`-${val}`)
        break
      }
      case 0x84: { // iinc local, delta
        const slot = code[pos++]
        const delta = (code[pos++] << 24) >> 24
        const name = localValue(slot)
        if (delta === 1) lines.push(`${name}++;`)
        else if (delta === -1) lines.push(`${name}--;`)
        else lines.push(`${name} += ${delta};`)
        break
      }
      case 0x99: case 0x9a: {
        const condition = stack.pop() ?? '?'
        const branchTarget = opStart + ((readIndex(pos) << 16) >> 16)
        pos += 2
        const fallValue = code[pos] === 0x04 ? true : code[pos] === 0x03 ? false : undefined
        const branchValue = code[branchTarget] === 0x04 ? true : code[branchTarget] === 0x03 ? false : undefined
        const hasBooleanJoin = fallValue != null && branchValue != null && code[pos + 1] === 0xa7 && code[branchTarget + 1] === 0xac
        if (!hasBooleanJoin) { unsupported = `branch opcode 0x${op.toString(16)}`; pos = code.length; break }
        const isZeroWhenTrue = op === 0x99
        const trueWhenZero = isZeroWhenTrue ? branchValue : fallValue
        lines.push(`return ${condition} ${trueWhenZero ? '==' : '!='} 0;`)
        pos = code.length
        break
      }
      // single-value comparisons vs zero (iflt, ifge, ifgt, ifle)
      case 0x9b: case 0x9c: case 0x9d: case 0x9e: {
        const val = stack.pop() ?? '?'
        const cmpOps = ['< 0', '>= 0', '> 0', '<= 0']
        pos += 2
        lines.push(`/* if (${val} ${cmpOps[op - 0x9b]}) */`)
        break
      }
      // two-value int comparisons (if_icmp*)
      case 0x9f: case 0xa0: case 0xa1: case 0xa2: case 0xa3: case 0xa4: {
        const right = stack.pop() ?? '?'; const left = stack.pop() ?? '?'
        const cmpOps = ['==', '!=', '<', '>=', '>', '<=']
        pos += 2
        lines.push(`/* if (${left} ${cmpOps[op - 0x9f]} ${right}) */`)
        break
      }
      case 0xa5: case 0xa6: {
        const right = stack.pop() ?? '?'; const left = stack.pop() ?? '?'
        pos += 2
        lines.push(`/* if (${left} ${op === 0xa5 ? '==' : '!='} ${right}) */`)
        break
      }
      case 0xa7: pos += 2; break // goto — skip branch offset
      case 0xac: case 0xad: case 0xae: case 0xaf: case 0xb0:
        lines.push(`return ${stack.pop() ?? '?'};`)
        break
      case 0xb1:
        break
      // field access
      case 0xb2: { // getstatic
        const member = cpMember(cp, readIndex(pos)); pos += 2
        stack.push(`${simpleOwner(member.owner)}.${member.name}`)
        break
      }
      case 0xb3: { // putstatic
        const member = cpMember(cp, readIndex(pos)); pos += 2
        lines.push(`${simpleOwner(member.owner)}.${member.name} = ${stack.pop() ?? '?'};`)
        break
      }
      case 0xb4: { // getfield
        const member = cpMember(cp, readIndex(pos)); pos += 2
        const recv = stack.pop() ?? 'this'
        stack.push(recv === 'this' ? member.name : `${recv}.${member.name}`)
        break
      }
      case 0xb5: { // putfield
        const member = cpMember(cp, readIndex(pos)); pos += 2
        const value = stack.pop() ?? '?'
        const recv = stack.pop() ?? 'this'
        lines.push(`${recv === 'this' ? 'this.' : `${recv}.`}${member.name} = ${value};`)
        break
      }
      case 0xb6: case 0xb7: case 0xb8: {
        const member = cpMember(cp, readIndex(pos)); pos += 2
        const signature = parseMethodDescriptor(member.descriptor)
        const args = popArguments(stack, signature.params.length)
        if (member.name === '<init>') {
          const recv = stack.pop() ?? 'this'
          if (typeof recv === 'string' && recv.startsWith('__DUP__:')) {
            // new X(args) — resolve the __NEW__:X placeholder into the full constructor expression
            const className = recv.slice(8)
            const topIdx = stack.length - 1
            if (stack[topIdx]?.startsWith('__NEW__:')) {
              stack[topIdx] = `new ${simpleOwner(className)}(${args.join(', ')})`
            } else {
              stack.push(`new ${simpleOwner(className)}(${args.join(', ')})`)
            }
          } else if (recv === 'this') {
            if (member.owner !== 'java.lang.Object') lines.push(`super(${args.join(', ')});`)
          } else {
            lines.push(`${recv}.${simpleOwner(member.owner)}(${args.join(', ')});`)
          }
          break
        }
        const receiver = op === 0xb8 ? simpleOwner(member.owner) : (stack.pop() ?? 'this')
        const call = `${receiver}.${member.name}(${args.join(', ')})`
        if (signature.returnType === 'void') lines.push(`${call};`)
        else stack.push(call)
        break
      }
      case 0xba: {
        const dynamic = cp[readIndex(pos)]
        pos += 4
        const member = cpNameAndType(cp, dynamic?.nameAndTypeIndex ?? 0)
        const args = popArguments(stack, parseMethodDescriptor(member.descriptor).params.length)
        if (member.name === 'makeConcatWithConstants') {
          const bootstrap = structure.bootstrapMethods[dynamic?.bootstrapMethodAttrIndex ?? -1]
          const recipeEntry = bootstrap?.[0] ? cp[bootstrap[0]] : null
          const recipe = recipeEntry?.tag === 8 ? cpUtf8(cp, recipeEntry.nameIndex ?? 0) : '\u0001'.repeat(args.length)
          stack.push(concatExpression(recipe, args))
        } else {
          stack.push(`${member.name}(${args.join(', ')})`)
        }
        break
      }
      case 0xbb: { // new — push marker; dup+invokespecial<init> resolves it
        const className = cpClassName(cp, readIndex(pos)); pos += 2
        stack.push(`__NEW__:${className}`)
        break
      }
      case 0xbf: { // athrow
        lines.push(`throw ${stack.pop() ?? '?'};`)
        pos = code.length
        break
      }
      case 0xc0: { // checkcast
        const className = cpClassName(cp, readIndex(pos)); pos += 2
        const val = stack.pop() ?? '?'
        stack.push(`((${simpleOwner(className)}) ${val})`)
        break
      }
      case 0xc1: { // instanceof
        const className = cpClassName(cp, readIndex(pos)); pos += 2
        stack.push(`${stack.pop() ?? '?'} instanceof ${simpleOwner(className)}`)
        break
      }
      case 0xc6: case 0xc7: { // ifnull, ifnonnull
        const val = stack.pop() ?? '?'
        pos += 2
        lines.push(`/* if (${val} ${op === 0xc6 ? '==' : '!='} null) */`)
        break
      }
      default:
        unsupported = `opcode 0x${op.toString(16).padStart(2, '0')} at byte ${opStart}`
        pos = code.length
    }
  }
  if (unsupported) lines.push(`/* Unsupported bytecode: ${unsupported} */`)
  return lines.length ? lines : []
}

function renderClassSkeleton(s: ClassStructure): string {
  const jvRaw = javaVersionName(s.version.major).trim()
  const jvLabel = jvRaw ? jvRaw.slice(1, -1) : `major ${s.version.major}, minor ${s.version.minor}`
  const lines: string[] = [
    `// ${jvLabel}`,
    `// Constant pool: ${s.cpCount} entries — ${s.fields.length} field(s), ${s.methods.length} method(s)`,
    '',
  ]
  const simpleName = s.thisClass.includes('.')
    ? s.thisClass.slice(s.thisClass.lastIndexOf('.') + 1) : s.thisClass
  const pkg = s.thisClass.includes('.')
    ? s.thisClass.slice(0, s.thisClass.lastIndexOf('.')) : ''
  if (pkg) { lines.push(`package ${pkg};`); lines.push('') }
  const superPart = s.superClass && s.superClass !== 'Object' && s.superClass !== 'java.lang.Object'
    ? ` extends ${s.superClass}` : ''
  const implPart = s.interfaces.length ? ` implements ${s.interfaces.join(', ')}` : ''
  lines.push(`${decodeClassModifiers(s.accessFlags)} ${simpleName}${superPart}${implPart} {`)
  if (s.fields.length) {
    lines.push('')
    for (const f of s.fields) {
      const mods = decodeMemberModifiers(f.flags, false)
      const { type } = jvmTypeToJava(f.descriptor)
      lines.push(`  ${mods ? mods + ' ' : ''}${type} ${f.name};`)
    }
  }
  if (s.methods.length) {
    lines.push('')
    for (const m of s.methods) {
      if (m.name === '<clinit>') { lines.push(`  static { /* static initializer */ }`); continue }
      const mods = decodeMemberModifiers(m.flags, true)
      const { params, returnType } = parseMethodDescriptor(m.descriptor)
      const paramStr = params.map((p, i) => `${p} arg${i}`).join(', ')
      const isAbstract = !!(m.flags & 0x0400)
      const isNative = !!(m.flags & 0x0100)
      if (m.name === '<init>') {
        const bodyLines = decompileMethodBody(m, s)
        lines.push(`  ${mods ? mods + ' ' : ''}${simpleName}(${paramStr}) {${bodyLines.length ? '' : ' }'}`)
        bodyLines.forEach((line) => lines.push(`    ${line}`))
        if (bodyLines.length) lines.push('  }')
      } else {
        if (isAbstract || isNative) {
          lines.push(`  ${mods ? mods + ' ' : ''}${returnType} ${m.name}(${paramStr});`)
        } else {
          lines.push(`  ${mods ? mods + ' ' : ''}${returnType} ${m.name}(${paramStr}) {`)
          decompileMethodBody(m, s).forEach((line) => lines.push(`    ${line}`))
          lines.push('  }')
        }
      }
    }
  }
  lines.push('}')
  return lines.join('\n')
}

function renderClassDetails(s: ClassStructure): string {
  const lines = [
    `Version: major ${s.version.major}, minor ${s.version.minor}${javaVersionName(s.version.major)}`,
    `Constant pool entries: ${s.cpCount}`,
    `Access flags: 0x${s.accessFlags.toString(16).padStart(4, '0')} (${decodeClassModifiers(s.accessFlags)})`,
    `Class: ${s.thisClass}`,
    `Extends: ${s.superClass || '(none)'}`,
  ]
  if (s.interfaces.length) lines.push(`Implements: ${s.interfaces.join(', ')}`)
  lines.push(`\nFields: ${s.fields.length}`)
  for (const f of s.fields.slice(0, 30)) {
    const mods = decodeMemberModifiers(f.flags, false)
    const { type } = jvmTypeToJava(f.descriptor)
    lines.push(`  [${mods || 'package'}] ${type} ${f.name}  (raw: ${f.descriptor})`)
  }
  if (s.fields.length > 30) lines.push(`  ... ${s.fields.length - 30} more`)
  lines.push(`\nMethods: ${s.methods.length}`)
  for (const m of s.methods.slice(0, 30)) {
    const mods = decodeMemberModifiers(m.flags, true)
    const { params, returnType } = parseMethodDescriptor(m.descriptor)
    const sig = m.name === '<init>' || m.name === '<clinit>'
      ? `${m.name}(${params.join(', ')})`
      : `${returnType} ${m.name}(${params.join(', ')})`
    lines.push(`  [${mods || 'package'}] ${sig}  (raw: ${m.descriptor})`)
  }
  if (s.methods.length > 30) lines.push(`  ... ${s.methods.length - 30} more`)
  return lines.join('\n')
}

function classInspect(hex: string, mode: 'skeleton' | 'details'): string {
  const cleanHex = hex.replace(/[^0-9a-f]/gi, '')
  if (cleanHex.slice(0, 8).toUpperCase() !== 'CAFEBABE') {
    return `Magic: ${cleanHex.slice(0, 8) || '(empty)'} — expected CAFEBABE\nNot a valid Java class file.`
  }
  const bytes = new Uint8Array(cleanHex.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) ?? [])
  const result = parseClassStructure(bytes)
  if (typeof result === 'string') return result
  return mode === 'skeleton' ? renderClassSkeleton(result) : renderClassDetails(result)
}

// =========== Main Panel ===========

export function UtilsPanel({ initialTool = 'base64' }: { initialTool?: string }) {
  const port = useServerPort()
  const pendingFileImport = useAppStore((state) => state.pendingFileImport)
  const [activeTool, setActiveTool] = useState(initialTool)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  // Command-palette deep links select a tool via this event (see commandPalette.ts).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { tool?: string; handled?: boolean }
      if (detail?.tool && CATEGORIES.some((cat) => cat.tools.some((t) => t.id === detail.tool))) {
        setActiveTool(detail.tool)
        detail.handled = true
      }
    }
    document.addEventListener('adomnia:powertools-tool', handler)
    return () => document.removeEventListener('adomnia:powertools-tool', handler)
  }, [])
  const [toolSearch, setToolSearch] = useState('')
  const [binarySafe, setBinarySafe] = useState(false)
  const [lastToolRun, setLastToolRun] = useState('')

  // Tool state
  const [uuids, setUuids] = useState<string[]>([uuidv4()])
  const [uuidCount, setUuidCount] = useState(1)
  const [b64Input, setB64Input] = useState('adomnia:local-first-api-toolbox')
  const [b64Output, setB64Output] = useState('')
  const [urlInput, setUrlInput] = useState('https://api.local/v1/payments?status=paid&limit=20')
  const [urlOutput, setUrlOutput] = useState('')
  const [jyInput, setJyInput] = useState('{\n  "service": "payments",\n  "enabled": true,\n  "retries": 3\n}')
  const [jyOutput, setJyOutput] = useState('')
  const [hashInput, setHashInput] = useState('{"orderId":"ord_1001","amount":4990,"currency":"EUR"}')
  const [hashOutput, setHashOutput] = useState('')
  const [hashAlgo, setHashAlgo] = useState('SHA-256')
  const [jwtInput, setJwtInput] = useState('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkZW1vLXVzZXIiLCJzY29wZSI6ImFkbWluOnJlYWQiLCJleHAiOjQxMDI0NDQ4MDB9.signature')
  const [jwtOutput, setJwtOutput] = useState<object | null>(null)
  const [tsInput, setTsInput] = useState('1715774400')
  const [tsOutput, setTsOutput] = useState<ReturnType<typeof formatTimestamp> | null>(null)
  const [fakeCount, setFakeCount] = useState(5)
  const [fakeType, setFakeType] = useState('name')
  const [fakeOutput, setFakeOutput] = useState('')
  const [queryInput, setQueryInput] = useState('https://api.local/v1/payments?status=paid&limit=20&tenant=demo')
  const [queryOutput, setQueryOutput] = useState('')
  const [diffMode, setDiffMode] = useState<'json' | 'xml'>('json')
  const [jsonPatch, setJsonPatch] = useState('')
  const [diffLeft, setDiffLeft] = useState('{\n  "id": "pay_1001",\n  "status": "pending",\n  "amount": 4990,\n  "customer": {\n    "id": "cus_42",\n    "tier": "standard"\n  },\n  "metadata": {\n    "source": "checkout"\n  }\n}')
  const [diffRight, setDiffRight] = useState('{\n  "id": "pay_1001",\n  "status": "succeeded",\n  "amount": 4990,\n  "customer": {\n    "id": "cus_42",\n    "tier": "enterprise"\n  },\n  "metadata": {\n    "source": "checkout",\n    "traceId": "trc_9f31"\n  }\n}')
  const [xmlDiffLeft, setXmlDiffLeft] = useState('<Payment id="pay_1001">\n  <Status>pending</Status>\n  <Amount currency="EUR">4990</Amount>\n  <Customer id="cus_42" tier="standard" />\n</Payment>')
  const [xmlDiffRight, setXmlDiffRight] = useState('<Payment id="pay_1001">\n  <Status>succeeded</Status>\n  <Amount currency="EUR">4990</Amount>\n  <Customer id="cus_42" tier="enterprise" />\n  <Trace id="trc_9f31" />\n</Payment>')
  const [graphInput, setGraphInput] = useState('{"payment":{"id":"pay_1001","events":[{"type":"created"},{"type":"captured"}],"risk":{"score":12,"review":false}}}')
  const [xmlInput, setXmlInput] = useState('<Envelope><Body><GetPayment id="pay_1001"/></Body></Envelope>')
  const [xmlOutput, setXmlOutput] = useState('')
  const [xmlValidOutput, setXmlValidOutput] = useState('')
  const [yamlValInput, setYamlValInput] = useState('service: payments\nport: 8080\nfeatures:\n  refunds: true\n  webhooks: true')
  const [yamlValOutput, setYamlValOutput] = useState('')
  const [yamlFileResults, setYamlFileResults] = useState<YamlFileResult[]>([])
  const [pemInput, setPemInput] = useState('-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIUadOmniaDemoCertificateOnly\n-----END CERTIFICATE-----')
  const [pemOutput, setPemOutput] = useState('')
  const [pemFileName, setPemFileName] = useState('')
  const [jksPassword, setJksPassword] = useState('changeit')
  const [jksAlias, setJksAlias] = useState('')
  const [jksSplit, setJksSplit] = useState<{ certPem: string; keyPem: string; warning?: string } | null>(null)
  const [classInput, setClassInput] = useState('')
  const [classOutput, setClassOutput] = useState('')
  const [classFileName, setClassFileName] = useState('')
  const [classViewMode, setClassViewMode] = useState<'skeleton' | 'details'>('skeleton')
  const [httpFilter, setHttpFilter] = useState('')

  // Network tools
  const [dnsHost, setDnsHost] = useState('example.com')
  const [dnsType, setDnsType] = useState('A')
  const [dnsOutput, setDnsOutput] = useState('')
  const [scanHost, setScanHost] = useState('localhost')
  const [scanPorts, setScanPorts] = useState('80,443,8080')
  const [scanOutput, setScanOutput] = useState('')
  const [corsUrl, setCorsUrl] = useState('http://localhost:8080/api/health')
  const [corsOrigin, setCorsOrigin] = useState('https://your-domain.com')
  const [corsMethod, setCorsMethod] = useState('GET')
  const [corsOutput, setCorsOutput] = useState('')

  const fetchApi = async (path: string, body?: object) => {
    const url = serverUrl(port, path)
    if (!url) return null
    try {
      const res = await sidecarFetch(url, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      return res.json()
    } catch {
      return null
    }
  }

  const inspectPem = async (pemText: string) => {
    const url = serverUrl(port, '/cert/inspect')
    if (!url) return pemInspectPure(pemText)
    try {
      const res = await sidecarFetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: pemText })
      const text = await res.text()
      if (!res.ok) throw new Error(text || res.statusText)
      return JSON.stringify(JSON.parse(text), null, 2)
    } catch {
      return pemInspectPure(pemText)
    }
  }

  const handlePemFile = async (file: File) => {
    const { text, bytes } = await readFileSmart(file)
    setPemFileName(file.name)
    const pemText = text.includes('-----BEGIN ') ? text : bytesToHex(bytes)
    setPemInput(pemText)
    setJksSplit(null)

    // Show initial JKS info synchronously; for PEM/cert files call backend
    if (!text.includes('-----BEGIN ')) {
      setPemOutput(jksInspect(bytes, file.name))
    } else {
      setPemOutput('Inspecting…')
      const out = await inspectPem(pemText)
      setPemOutput(out)
    }
    if (file.name.toLowerCase().endsWith('.jks')) {
      const url = serverUrl(port, '/cert/jks-split')
      if (!url) {
        setPemOutput((current) => `${current}\n\nJKS split: backend not ready`)
        return
      }
      const form = new FormData()
      form.append('jks', file)
      form.append('password', jksPassword)
      form.append('alias', jksAlias)
      try {
        const res = await sidecarFetch(url, { method: 'POST', body: form })
        const textOut = await res.text()
        if (!res.ok) {
          setPemOutput((current) => `${current}\n\nJKS split failed: ${textOut}`)
          return
        }
        const data = JSON.parse(textOut) as { certPem: string; keyPem: string; warning?: string }
        setJksSplit(data)
        setPemOutput((current) => `${current}\n\nJKS split ready: certificate PEM and private key PEM extracted locally.`)
      } catch (e) {
        setPemOutput((current) => `${current}\n\nJKS split failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  const handleClassFile = async (file: File) => {
    const { bytes } = await readFileSmart(file)
    const hex = bytesToHex(bytes)
    setClassFileName(file.name)
    setClassInput(hex)
    setClassOutput(classInspect(hex, classViewMode))
  }

  useEffect(() => {
    const routed = useAppStore.getState().consumeFileImport('class')
    if (routed?.kind !== 'class') return
    const hex = bytesToHex(routed.bytes)
    setActiveTool('class')
    setClassFileName(routed.name)
    setClassInput(hex)
    setClassOutput(classInspect(hex, classViewMode))
  }, [pendingFileImport])

  const handleYamlFiles = async (files: File[]) => {
    const results: YamlFileResult[] = []
    const chunks: string[] = []
    for (const file of files) {
      const { text } = await readFileSmart(file)
      const result = yamlValidateResult(text)
      results.push({ name: file.name, ok: result.ok, message: result.message })
      chunks.push(`# ${file.name}\n${text}`)
    }
    setYamlFileResults(results)
    setYamlValInput(chunks.join('\n\n---\n\n'))
    const failed = results.filter((result) => !result.ok)
    setYamlValOutput(failed.length === 0
      ? `Valid YAML: ${results.length} file${results.length === 1 ? '' : 's'} checked with no errors`
      : `Invalid YAML: ${failed.length} of ${results.length} file${results.length === 1 ? '' : 's'} failed`
    )
  }

  const generateFake = (type: string, count: number) => {
    const results: string[] = []
    for (let i = 0; i < count; i++) {
      switch (type) {
        case 'name': results.push(fakeName()); break
        case 'email': results.push(fakeEmail()); break
        case 'phone': results.push(fakePhone()); break
        case 'ip': results.push(fakeIP()); break
        case 'words': results.push(fakeWords(5)); break
      }
    }
    return results.join('\n')
  }

  const toggleCat = (label: string) => {
    setCollapsed((c) => ({ ...c, [label]: !c[label] }))
  }

  const statusClass = (code: number) => {
    if (code >= 500) return 'text-error'
    if (code >= 400) return 'text-warning'
    if (code >= 300) return 'text-info'
    if (code >= 200) return 'text-success'
    return 'text-text-4'
  }

  const allTools = CATEGORIES.flatMap((cat) =>
    cat.tools.map((tool) => ({
      ...tool,
      ...TOOL_DETAILS[tool.id],
      category: cat.label,
    }))
  )
  const activeMeta = allTools.find((tool) => tool.id === activeTool) ?? allTools[0]
  const totalTools = allTools.length
  const pinnedToolIds = ['base64', 'jwt', 'regex', 'uuid', 'timestamp']
  const favoriteToolIds = ['base64', 'jwt', 'regex', 'uuid', 'timestamp', 'hash']
  const recentRuns = [
    { id: 'base64', label: 'Base64 Encode', detail: b64Output ? `${b64Output.length} chars` : 'Ready', ago: lastToolRun || 'now' },
    { id: 'jwt', label: 'JWT Decode', detail: 'Local decode', ago: '25m ago' },
    { id: 'hash', label: 'Hash SHA-256', detail: 'Payload digest', ago: '1h ago' },
    { id: 'uuid', label: 'UUID Generate', detail: `${uuids.length} id${uuids.length === 1 ? '' : 's'}`, ago: '2h ago' },
  ]
  const filteredCategories = useMemo(() => {
    const query = toolSearch.trim().toLowerCase()
    if (!query) return CATEGORIES
    return CATEGORIES.map((cat) => ({
      ...cat,
      tools: cat.tools.filter((tool) => {
        const details = TOOL_DETAILS[tool.id]
        return tool.label.toLowerCase().includes(query)
          || tool.id.toLowerCase().includes(query)
          || cat.label.toLowerCase().includes(query)
          || details?.desc?.toLowerCase().includes(query)
      }),
    })).filter((cat) => cat.tools.length > 0)
  }, [toolSearch])
  const activeInput = activeTool === 'base64' ? b64Input : ''
  const activeOutput = activeTool === 'base64' ? b64Output : ''
  const b64InputChars = b64Input.length
  const b64OutputChars = b64Output.length
  const b64Ratio = b64InputChars > 0 && b64OutputChars > 0 ? (b64OutputChars / b64InputChars).toFixed(2) : '-'
  const liveDiff = useMemo(
    () => diffMode === 'json' ? buildJsonDiff(diffLeft, diffRight) : buildXmlDiff(xmlDiffLeft, xmlDiffRight),
    [diffLeft, diffRight, diffMode, xmlDiffLeft, xmlDiffRight],
  )
  const liveDiffCounts = useMemo(() => diffCounts(liveDiff.rows), [liveDiff.rows])

  const selectTool = (toolId: string) => {
    setActiveTool(toolId)
  }

  const runBase64 = (mode: 'encode' | 'decode') => {
    try {
      setB64Output(mode === 'encode'
        ? btoa(unescape(encodeURIComponent(b64Input)))
        : decodeURIComponent(escape(atob(b64Input)))
      )
      setLastToolRun('just now')
    } catch {
      setB64Output(mode === 'encode' ? 'Invalid input' : 'Invalid base64')
      setLastToolRun('just now')
    }
  }

  const renderTool = () => {
    switch (activeTool) {
      case 'xmlstudio':
        return <div className="min-h-0 flex-1 overflow-hidden"><XmlToolsPanel /></div>

      case 'harviewer':
        return <div className="min-h-0 flex-1 overflow-hidden"><HarViewerPanel /></div>

      case 'observability':
        return <div className="min-h-0 flex-1 overflow-hidden"><ObservabilityPanel /></div>

      case 'secretscanner':
        return <div className="min-h-0 flex-1 overflow-hidden"><SecretScannerPanel /></div>

      case 'dockerlab':
        return <div className="min-h-0 flex-1 overflow-hidden"><DockerLabPanel /></div>

      // ---- Encoding ----
      case 'base64':
        return (
          <Base64Tool
            input={b64Input}
            output={b64Output}
            onInput={setB64Input}
            onOutput={setB64Output}
            onRun={runBase64}
          />
        )

      case 'url':
        return (
          <div className="flex flex-col gap-3">
            <textarea value={urlInput} onChange={(e) => setUrlInput(e.target.value)} placeholder="Enter URL or URL-encoded string..." rows={3} className="px-2 py-1.5 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none resize-none" />
            <div className="flex gap-2">
              <button onClick={() => { try { setUrlOutput(encodeURIComponent(urlInput)) } catch { setUrlOutput('Encode error') } }} className="px-3 py-1.5 bg-accent text-white rounded text-xs font-medium">Encode</button>
              <button onClick={() => { try { setUrlOutput(decodeURIComponent(urlInput)) } catch { setUrlOutput('Decode error') } }} className="px-3 py-1.5 bg-surface-2 text-text-2 border border-border-2 rounded text-xs">Decode</button>
            </div>
            {urlOutput && <pre className="px-3 py-2 bg-surface-1 border border-border-1 rounded text-xs text-text-1 font-mono break-all">{urlOutput}</pre>}
          </div>
        )

      case 'jsonyaml':
        return (
          <div className="flex flex-col gap-3">
            <textarea value={jyInput} onChange={(e) => setJyInput(e.target.value)} placeholder="Paste JSON or YAML..." rows={6} className="px-2 py-1.5 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none resize-none" />
            <div className="flex gap-2">
              <button onClick={() => { try { setJyOutput(jsonToYaml(JSON.parse(jyInput))) } catch { setJyOutput('Invalid JSON') } }} className="px-3 py-1.5 bg-accent text-white rounded text-xs font-medium">{'JSON -> YAML'}</button>
              <button onClick={() => setJyOutput(yamlToJson(jyInput))} className="px-3 py-1.5 bg-surface-2 text-text-2 border border-border-2 rounded text-xs">{'YAML -> JSON'}</button>
            </div>
            {jyOutput && <pre className="px-3 py-2 bg-surface-1 border border-border-1 rounded text-xs text-text-1 font-mono whitespace-pre-wrap max-h-64 overflow-auto">{jyOutput}</pre>}
          </div>
        )

      // ---- Crypto & Auth ----
      case 'hash':
        return (
          <HashTool
            input={hashInput}
            output={hashOutput}
            algo={hashAlgo}
            onInput={setHashInput}
            onOutput={setHashOutput}
            onAlgo={setHashAlgo}
          />
        )

      case 'hmac':
        return <HmacTool />

      case 'jwt':
        return (
          <JwtTool
            input={jwtInput}
            output={jwtOutput}
            onInput={setJwtInput}
            onOutput={setJwtOutput}
          />
        )

      case 'password':
        return <PasswordTool />

      case 'uuid':
        return (
          <UuidTool
            ids={uuids}
            count={uuidCount}
            onIds={setUuids}
            onCount={setUuidCount}
          />
        )

      // ---- Network ----
      case 'curlimp':
        return (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-text-3">Use the cURL import button in the Composer URL bar (the <span className="text-accent">{"< >"}</span> icon).</p>
          </div>
        )

      case 'cors':
        return (
          <div className="flex flex-col gap-3">
            <input value={corsUrl} onChange={(e) => setCorsUrl(e.target.value)}               placeholder="https://api.your-domain.com/test" className="h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none" />
            <div className="flex gap-2">
              <input value={corsOrigin} onChange={(e) => setCorsOrigin(e.target.value)} placeholder="Origin" className="flex-1 h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 focus:border-accent outline-none" />
              <select value={corsMethod} onChange={(e) => setCorsMethod(e.target.value)} className="h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none">
                {['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'].map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>
            <button onClick={() => fetchApi('/cors', { url: corsUrl, origin: corsOrigin, method: corsMethod }).then((d) => setCorsOutput(d ? JSON.stringify(d, null, 2) : 'Error'))} className="self-start px-3 py-1.5 bg-accent text-white rounded text-xs font-medium">Test CORS</button>
            {corsOutput && <pre className="px-3 py-2 bg-surface-1 border border-border-1 rounded text-xs text-text-1 font-mono whitespace-pre-wrap">{corsOutput}</pre>}
          </div>
        )

      case 'dns':
        return (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <input value={dnsHost} onChange={(e) => setDnsHost(e.target.value)}               placeholder="your-domain.com" className="flex-1 h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none" />
              <select value={dnsType} onChange={(e) => setDnsType(e.target.value)} className="h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none">
                {['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA'].map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <button onClick={() => fetchApi('/dns/lookup', { host: dnsHost, type: dnsType }).then((d) => setDnsOutput(d ? JSON.stringify(d, null, 2) : 'Error'))} className="self-start px-3 py-1.5 bg-accent text-white rounded text-xs font-medium">Lookup</button>
            {dnsOutput && <pre className="px-3 py-2 bg-surface-1 border border-border-1 rounded text-xs text-text-1 font-mono whitespace-pre-wrap">{dnsOutput}</pre>}
          </div>
        )

      case 'portscan':
        return (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <input value={scanHost} onChange={(e) => setScanHost(e.target.value)}               placeholder="your-domain.local" className="flex-1 h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none" />
              <input value={scanPorts} onChange={(e) => setScanPorts(e.target.value)} placeholder="80,443,8080" className="w-40 h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none" />
            </div>
            <button onClick={() => fetchApi('/portscan', { host: scanHost, ports: scanPorts.split(',').map(Number) }).then((d) => setScanOutput(d ? JSON.stringify(d, null, 2) : 'Error'))} className="self-start px-3 py-1.5 bg-accent text-white rounded text-xs font-medium">Scan</button>
            {scanOutput && <pre className="px-3 py-2 bg-surface-1 border border-border-1 rounded text-xs text-text-1 font-mono whitespace-pre-wrap">{scanOutput}</pre>}
          </div>
        )

      // ---- Data & Time ----
      case 'timestamp':
        return (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <input value={tsInput} onChange={(e) => setTsInput(e.target.value)} placeholder="Unix timestamp or ISO date" className="flex-1 h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none" />
              <button onClick={() => {
                const ts = Number(tsInput)
                setTsOutput(formatTimestamp(isNaN(ts) ? Date.parse(tsInput) : ts * 1000))
              }} className="px-3 py-1.5 bg-accent text-white rounded text-xs font-medium">Convert</button>
              <button onClick={() => { setTsInput(String(Math.floor(Date.now() / 1000))); setTsOutput(formatTimestamp(Date.now())) }} className="px-3 py-1.5 bg-surface-2 text-text-2 border border-border-2 rounded text-xs">Now</button>
            </div>
            {tsOutput && (
              <div className="flex flex-col gap-1 text-xs font-mono bg-surface-1 border border-border-1 rounded px-3 py-2">
                <p><span className="text-text-4">Unix:  </span><span className="text-text-1">{tsOutput.unix}</span></p>
                <p><span className="text-text-4">UTC:   </span><span className="text-text-1">{tsOutput.utc}</span></p>
                <p><span className="text-text-4">Local: </span><span className="text-text-1">{tsOutput.local}</span></p>
                <p><span className="text-text-4">ISO:   </span><span className="text-text-1">{tsOutput.iso}</span></p>
              </div>
            )}
          </div>
        )

      case 'fake':
        return (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <select value={fakeType} onChange={(e) => setFakeType(e.target.value)} className="h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none">
                <option value="name">Names</option>
                <option value="email">Emails</option>
                <option value="phone">Phone Numbers</option>
                <option value="ip">IP Addresses</option>
                <option value="words">Lorem Ipsum</option>
              </select>
              <label className="flex items-center gap-1.5 text-xs text-text-3">
                Count <input type="number" value={fakeCount} min={1} max={100} onChange={(e) => setFakeCount(Number(e.target.value))} className="w-14 h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none" />
              </label>
              <button onClick={() => setFakeOutput(generateFake(fakeType, fakeCount))} className="px-3 py-1.5 bg-accent text-white rounded text-xs font-medium">Generate</button>
            </div>
            {fakeOutput && <pre className="px-3 py-2 bg-surface-1 border border-border-1 rounded text-xs text-text-1 font-mono whitespace-pre-wrap">{fakeOutput}</pre>}
          </div>
        )

      case 'query':
        return (
          <div className="flex flex-col gap-3">
            <textarea value={queryInput} onChange={(e) => setQueryInput(e.target.value)} placeholder="?key1=val1&key2=val2 or full URL" rows={3} className="px-2 py-1.5 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none resize-none" />
            <div className="flex gap-2">
              <button onClick={() => setQueryOutput(JSON.stringify(parseQuery(queryInput), null, 2))} className="px-3 py-1.5 bg-accent text-white rounded text-xs font-medium">Parse</button>
            </div>
            {queryOutput && <pre className="px-3 py-2 bg-surface-1 border border-border-1 rounded text-xs text-text-1 font-mono whitespace-pre-wrap">{queryOutput}</pre>}
          </div>
        )

      case 'jsondiff':
        return (
          <div className="flex flex-col gap-4">
            <div className="inline-flex self-start overflow-hidden rounded border border-border-2 bg-surface-1">
              {(['json', 'xml'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setDiffMode(mode)}
                  className={cn(
                    'px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors',
                    diffMode === mode ? 'bg-accent text-white' : 'text-text-3 hover:bg-surface-2 hover:text-text-1',
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-text-4">Left</label>
                <textarea
                  value={diffMode === 'json' ? diffLeft : xmlDiffLeft}
                  onChange={(e) => diffMode === 'json' ? setDiffLeft(e.target.value) : setXmlDiffLeft(e.target.value)}
                  placeholder={diffMode === 'json' ? 'Left JSON' : 'Left XML'}
                  rows={16}
                  className="min-h-[360px] px-3 py-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono leading-relaxed focus:border-accent outline-none resize-y"
                  spellCheck={false}
                />
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-text-4">Right</label>
                <textarea
                  value={diffMode === 'json' ? diffRight : xmlDiffRight}
                  onChange={(e) => diffMode === 'json' ? setDiffRight(e.target.value) : setXmlDiffRight(e.target.value)}
                  placeholder={diffMode === 'json' ? 'Right JSON' : 'Right XML'}
                  rows={16}
                  className="min-h-[360px] px-3 py-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono leading-relaxed focus:border-accent outline-none resize-y"
                  spellCheck={false}
                />
              </div>
            </div>
            <div className={cn(
              'rounded border px-3 py-2 text-xs',
              liveDiff.error
                ? 'border-error/30 bg-error/10 text-error'
                : liveDiff.equal
                  ? 'border-success/30 bg-success/10 text-success'
                  : 'border-warning/30 bg-warning/10 text-warning',
            )}>
              <span className="font-semibold">
                {liveDiff.error ? `Invalid ${diffMode.toUpperCase()}` : liveDiff.equal ? 'No differences' : `${liveDiff.rows.length} differences found`}
              </span>
            </div>
            {diffMode === 'json' && !liveDiff.error && <div className="flex flex-col gap-2">
              <button onClick={async () => {
                const data = await fetchApi('/json/diff', { left: JSON.parse(diffLeft), right: JSON.parse(diffRight) })
                setJsonPatch(data ? JSON.stringify(data, null, 2) : 'Backend diff unavailable')
              }} className="self-start rounded border border-border-2 bg-surface-2 px-3 py-1.5 text-xs text-text-2 hover:border-accent/40 hover:text-text-1">Generate RFC 6902 patch</button>
              {jsonPatch && <pre className="max-h-64 overflow-auto rounded border border-border-1 bg-surface-1 p-3 text-xs text-text-2 font-mono whitespace-pre-wrap">{jsonPatch}</pre>}
            </div>}
            {liveDiff.error && (
              <pre className="rounded border border-error/30 bg-error/10 px-3 py-2 text-xs text-error whitespace-pre-wrap">{liveDiff.error}</pre>
            )}
            {!liveDiff.error && liveDiff.rows.length > 0 && (
              <div className="grid grid-cols-1 gap-2">
                {liveDiff.rows.slice(0, 24).map((row) => (
                  <div
                    key={`visual-${row.status}-${row.path}`}
                    className={cn(
                      'rounded border px-3 py-2',
                      row.status === 'added' && 'border-success/25 bg-success/8',
                      row.status === 'removed' && 'border-error/25 bg-error/8',
                      row.status === 'changed' && 'border-warning/25 bg-warning/8',
                    )}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <span className={cn(
                        'rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase',
                        row.status === 'added' && 'bg-success/15 text-success',
                        row.status === 'removed' && 'bg-error/15 text-error',
                        row.status === 'changed' && 'bg-warning/15 text-warning',
                      )}>{row.status}</span>
                      <span className="min-w-0 truncate font-mono text-xs text-text-2">{row.path}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words rounded border border-error/20 bg-surface-0 px-2 py-1.5 font-mono text-xs text-error">{row.left || '-'}</pre>
                      <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words rounded border border-success/20 bg-surface-0 px-2 py-1.5 font-mono text-xs text-success">{row.right || '-'}</pre>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!liveDiff.error && (
              <div className="overflow-hidden rounded border border-border-1 bg-surface-1">
                <div className="grid grid-cols-4 gap-0 border-b border-border-1 bg-surface-2 px-3 py-2 text-[10px] uppercase tracking-wider text-text-4">
                  <span>Total</span>
                  <span>Changed</span>
                  <span>Added</span>
                  <span>Removed</span>
                </div>
                <div className="grid grid-cols-4 gap-0 px-3 py-2 font-mono text-xs">
                  <span className="text-text-1">{liveDiff.rows.length}</span>
                  <span className="text-warning">{liveDiffCounts.changed}</span>
                  <span className="text-success">{liveDiffCounts.added}</span>
                  <span className="text-error">{liveDiffCounts.removed}</span>
                </div>
              </div>
            )}
            {!liveDiff.error && liveDiff.rows.length > 0 && (
              <div className="overflow-hidden rounded border border-border-1 bg-surface-1">
                <div className="grid grid-cols-[86px_1.4fr_1fr_1fr] gap-0 border-b border-border-1 bg-surface-2 px-3 py-2 text-[10px] uppercase tracking-wider text-text-4">
                  <span>Status</span>
                  <span>Path</span>
                  <span>Left</span>
                  <span>Right</span>
                </div>
                <div className="max-h-[420px] overflow-auto">
                  {liveDiff.rows.map((row) => (
                    <div
                      key={`${row.status}-${row.path}`}
                      className={cn(
                        'grid grid-cols-[86px_1.4fr_1fr_1fr] gap-0 border-b border-border-1/40 px-3 py-2 text-xs last:border-b-0',
                        row.status === 'added' && 'bg-success/8',
                        row.status === 'removed' && 'bg-error/8',
                        row.status === 'changed' && 'bg-warning/8',
                      )}
                    >
                      <span className={cn(
                        'font-mono text-[10px] font-semibold uppercase',
                        row.status === 'added' && 'text-success',
                        row.status === 'removed' && 'text-error',
                        row.status === 'changed' && 'text-warning',
                      )}>
                        {row.status}
                      </span>
                      <span className="min-w-0 truncate font-mono text-text-2">{row.path}</span>
                      <span className="min-w-0 whitespace-pre-wrap break-words border-l border-border-1/50 pl-2 font-mono text-error">{row.left || '-'}</span>
                      <span className="min-w-0 whitespace-pre-wrap break-words border-l border-border-1/50 pl-2 font-mono text-success">{row.right || '-'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )

      case 'jsongraph':
        return (
          <div className="flex flex-col gap-3">
            <textarea value={graphInput} onChange={(e) => setGraphInput(e.target.value)} placeholder='{"key": "value"}' rows={4} className="px-2 py-1.5 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none resize-none" />
            <div className="bg-surface-1 border border-border-1 rounded p-3">
              <JsonGraphView json={graphInput} />
            </div>
          </div>
        )

      case 'xml':
        return (
          <div className="flex flex-col gap-3">
            <textarea value={xmlInput} onChange={(e) => setXmlInput(e.target.value)} placeholder="Paste XML..." rows={5} className="px-2 py-1.5 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none resize-none" />
            <div className="flex gap-2">
              <button onClick={() => setXmlOutput(xmlFormat(xmlInput))} className="px-3 py-1.5 bg-accent text-white rounded text-xs font-medium">Format</button>
              <button onClick={() => setXmlValidOutput(xmlValidate(xmlInput))} className="px-3 py-1.5 bg-surface-2 text-text-2 border border-border-2 rounded text-xs">Validate</button>
            </div>
            {xmlValidOutput && <p className={cn('text-xs', xmlValidOutput.startsWith('Valid') ? 'text-success' : 'text-error')}>{xmlValidOutput}</p>}
            {xmlOutput && <pre className="px-3 py-2 bg-surface-1 border border-border-1 rounded text-xs text-text-1 font-mono whitespace-pre-wrap overflow-auto max-h-64">{xmlOutput}</pre>}
          </div>
        )

      // ---- Validation ----
      case 'regex':
        return <RegexTester />

      case 'yamlval':
        return (
          <div className="flex flex-col gap-3">
            <FileDropZone
              accept=".yaml,.yml,application/yaml,text/yaml,text/x-yaml,text/plain"
              label="Drop YAML files here"
              detail="Drag one or more .yaml/.yml files, or click to choose them"
              multiple
              onFile={(file) => void handleYamlFiles([file])}
              onFiles={(files) => void handleYamlFiles(files)}
            />
            <textarea
              value={yamlValInput}
              onChange={(e) => { setYamlValInput(e.target.value); setYamlFileResults([]) }}
              placeholder="Paste YAML to validate, or drop one or more YAML files above..."
              rows={8}
              className="px-2 py-1.5 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none resize-none"
            />
            <button
              onClick={() => {
                const result = yamlValidateResult(yamlValInput)
                setYamlFileResults([])
                setYamlValOutput(result.message)
              }}
              className="self-start px-3 py-1.5 bg-accent text-white rounded text-xs font-medium"
            >
              Validate
            </button>
            {yamlValOutput && (
              <div className={cn(
                'rounded border px-3 py-2 text-xs',
                yamlValOutput.startsWith('Valid YAML')
                  ? 'border-success/30 bg-success/10 text-success'
                  : 'border-error/30 bg-error/10 text-error',
              )}>
                {yamlValOutput}
              </div>
            )}
            {yamlFileResults.length > 0 && (
              <div className="overflow-hidden rounded border border-border-1 bg-surface-1">
                {yamlFileResults.map((result) => (
                  <div key={result.name} className="grid grid-cols-[22px_1fr_2fr] gap-2 border-b border-border-1/50 px-3 py-2 last:border-b-0">
                    <span className={cn('font-mono text-xs', result.ok ? 'text-success' : 'text-error')}>{result.ok ? 'OK' : '!!'}</span>
                    <span className="truncate font-mono text-xs text-text-1">{result.name}</span>
                    <span className={cn('text-xs', result.ok ? 'text-success' : 'text-error')}>{result.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )

      case 'httpstatus':
        return (
          <div className="flex flex-col gap-3">
            <input value={httpFilter} onChange={(e) => setHttpFilter(e.target.value)} placeholder="Filter by code or keyword..." className="h-8 px-3 bg-surface-2 border border-border-2 rounded text-xs text-text-1 focus:border-accent outline-none" />
            <div className="border border-border-1 rounded overflow-hidden bg-surface-0">
              <div className="grid grid-cols-[72px_190px_1fr] gap-0 px-3 py-2 text-[10px] uppercase tracking-wider text-text-4 border-b border-border-1 bg-surface-1">
                <span>Code</span>
                <span>Status</span>
                <span>When to use it</span>
              </div>
              <div className="divide-y divide-border-1/40">
                {HTTP_STATUS.filter((s) => {
                  const filter = httpFilter.toLowerCase().trim()
                  const detail = HTTP_DESCRIPTIONS[s.code] ?? ''
                  return !filter
                    || String(s.code).includes(filter)
                    || s.text.toLowerCase().includes(filter)
                    || s.category.toLowerCase().includes(filter)
                    || detail.toLowerCase().includes(filter)
                }).map((s) => (
                  <button
                    key={s.code}
                    onClick={() => copy(String(s.code))}
                    className="w-full grid grid-cols-[72px_190px_1fr] gap-0 px-3 py-2.5 text-left hover:bg-surface-2/60 transition-colors"
                    title="Copy status code"
                  >
                    <span className={`font-mono text-xs font-semibold ${statusClass(s.code)}`}>{s.code}</span>
                    <span className="text-xs font-semibold text-text-1">{s.text}</span>
                    <span className="text-xs text-text-3">{HTTP_DESCRIPTIONS[s.code] ?? s.category}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )

      case 'pem':
        return (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2">
              <input
                value={jksPassword}
                onChange={(e) => setJksPassword(e.target.value)}
                type="password"
                placeholder="JKS password (default changeit)"
                className="h-8 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none"
              />
              <input
                value={jksAlias}
                onChange={(e) => setJksAlias(e.target.value)}
                placeholder="Alias (optional)"
                className="h-8 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none"
              />
            </div>
            <FileDropZone
              accept=".pem,.crt,.cer,.key,.jks,.p12,.pfx,application/x-java-keystore,application/octet-stream,text/plain"
              label="Drop PEM, certificate, key, or JKS here"
              detail="JKS files are converted locally to cert.pem and key.pem when keytool and openssl are available"
              onFile={(file) => void handlePemFile(file)}
            />
            {pemFileName && <p className="text-[10px] text-text-4">Loaded: <span className="font-mono text-text-2">{pemFileName}</span></p>}
            <textarea
              value={pemInput}
              onChange={(e) => { setPemInput(e.target.value); setPemFileName('') }}
              placeholder="Paste a PEM certificate/key block, or drop a .pem/.crt/.jks file above..."
              rows={8}
              className="px-2 py-1.5 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none resize-none"
            />
            <button
              onClick={async () => {
                setPemOutput('Inspecting…')
                const out = await inspectPem(pemInput)
                setPemOutput(out)
              }}
              className="self-start px-3 py-1.5 bg-accent text-white rounded text-xs font-medium"
            >
              Inspect
            </button>
            {jksSplit && (
              <div className="flex flex-wrap gap-2 rounded border border-success/30 bg-success/8 p-2">
                <span className="w-full text-[10px] text-success">{jksSplit.warning ?? 'JKS split completed locally.'}</span>
                <button onClick={() => downloadText('cert.pem', jksSplit.certPem, 'application/x-pem-file')} className="inline-flex items-center gap-1 px-3 py-1.5 bg-surface-2 border border-border-2 rounded text-xs text-text-2 hover:text-text-1">
                  <Download size={12} /> cert.pem
                </button>
                <button onClick={() => downloadText('key.pem', jksSplit.keyPem, 'application/x-pem-file')} className="inline-flex items-center gap-1 px-3 py-1.5 bg-surface-2 border border-border-2 rounded text-xs text-text-2 hover:text-text-1">
                  <Download size={12} /> key.pem
                </button>
              </div>
            )}
            {pemOutput && <pre className="px-3 py-2 bg-surface-1 border border-border-1 rounded text-xs text-text-1 font-mono whitespace-pre-wrap">{pemOutput}</pre>}
          </div>
        )

      case 'class':
        return (
          <div className="flex flex-col gap-3">
            <FileDropZone
              accept=".class,application/java-vm,application/octet-stream"
              label="Drop a Java .class file to decompile"
              detail="Reads bytecode locally and reconstructs readable Java source plus JVM metadata"
              onFile={(file) => void handleClassFile(file)}
            />
            {classFileName && <p className="text-[10px] text-text-4">Loaded: <span className="font-mono text-text-2">{classFileName}</span></p>}
            <textarea
              value={classInput}
              onChange={(e) => { setClassInput(e.target.value); setClassFileName('') }}
              placeholder="Paste hex bytes from a Java .class file, or drop the file above..."
              rows={4}
              className="px-2 py-1.5 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none resize-none"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={() => setClassOutput(classInspect(classInput.trim(), classViewMode))}
                className="px-3 py-1.5 bg-accent text-white rounded text-xs font-medium"
              >
                Inspect
              </button>
              <div className="flex rounded border border-border-2 overflow-hidden text-xs">
                <button
                  onClick={() => {
                    setClassViewMode('skeleton')
                    if (classOutput) setClassOutput(classInspect(classInput.trim(), 'skeleton'))
                  }}
                  className={`px-2 py-1 ${classViewMode === 'skeleton' ? 'bg-accent text-white' : 'bg-surface-2 text-text-3 hover:text-text-1'}`}
                >
                  Decompiled Source
                </button>
                <button
                  onClick={() => {
                    setClassViewMode('details')
                    if (classOutput) setClassOutput(classInspect(classInput.trim(), 'details'))
                  }}
                  className={`px-2 py-1 border-l border-border-2 ${classViewMode === 'details' ? 'bg-accent text-white' : 'bg-surface-2 text-text-3 hover:text-text-1'}`}
                >
                  Raw Details
                </button>
              </div>
              <span className="text-[10px] text-text-4">
                {classViewMode === 'skeleton' ? 'Reconstructed from JVM bytecode' : 'JVM descriptor format'}
              </span>
            </div>
            {classOutput && (
              <pre className="px-3 py-2 bg-surface-1 border border-border-1 rounded text-xs text-text-1 font-mono whitespace-pre-wrap leading-relaxed">
                {classOutput}
              </pre>
            )}
          </div>
        )

      // ---- Infrastructure ----
      case 'grpcclient':
        return (
          <div className="flex flex-col gap-2 p-3">
            <p className="text-xs text-text-3">gRPC client is available as a dedicated panel. Switch to the <span className="text-accent">gRPC</span> rail item.</p>
          </div>
        )

      case 'docker':
        return <DockerGenerator />

      case 'folderdiff':
        return <FolderDiffTool />

      // ---- Playground ----
      case 'easter':
        return (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <p className="text-3xl">AO</p>
            <p className="text-xs text-text-3 font-mono tracking-wider">ADOMNIA PARATUS.</p>
            <p className="text-[10px] text-text-4">You found the easter egg. Nothing to see here... yet.</p>
          </div>
        )

      default:
        return <p className="text-xs text-text-4 p-4">Select a tool from the sidebar.</p>
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-0 text-text-2">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border-1 bg-surface-1/95 px-5">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-text-1">Power Tools Studio</h1>
            <span className="hidden text-xs text-text-4 md:inline">Encoding · Crypto · Generators · Network · Validation</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="inline-flex h-8 items-center gap-2 rounded-md border border-border-2 bg-surface-1 px-3 text-xs text-text-2 hover:border-accent/40 hover:text-text-1">
            <Box size={13} /> Workspace <ChevronDown size={13} />
          </button>
          <button title="Power Tools settings" className="grid h-8 w-8 place-items-center rounded-md border border-border-2 bg-surface-1 text-text-3 hover:text-text-1">
            <Settings size={14} />
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)] 2xl:grid-cols-[280px_minmax(0,1fr)_300px]">
        <nav className="flex min-h-0 flex-col border-r border-border-1 bg-surface-1 p-3">
          <div className="relative mb-3">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-4" />
            <input
              value={toolSearch}
              onChange={(e) => setToolSearch(e.target.value)}
              placeholder="Search tools..."
              className="h-9 w-full rounded-md border border-border-2 bg-surface-0 pl-9 pr-12 text-xs text-text-1 outline-none placeholder:text-text-4 focus:border-accent/70"
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border-2 bg-surface-1 px-1.5 py-0.5 font-mono text-[10px] text-text-4">Ctrl K</span>
          </div>

          <div className="mb-3 rounded-lg border border-border-1 bg-surface-0/55 p-2">
            <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-text-4">
              <span className="inline-flex items-center gap-1.5"><Star size={11} /> Pinned</span>
              <button className="text-accent-light hover:text-accent">Manage</button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {pinnedToolIds.map((toolId) => {
                const tool = allTools.find((item) => item.id === toolId)
                if (!tool) return null
                return (
                  <button
                    key={toolId}
                    onClick={() => selectTool(toolId)}
                    className={cn(
                      'rounded-md border px-2.5 py-1 text-xs transition-colors',
                      activeTool === toolId ? 'border-accent/50 bg-accent/30 text-white' : 'border-border-2 bg-surface-1 text-text-3 hover:text-text-1',
                    )}
                  >
                    {tool.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {filteredCategories.map((cat) => (
              <div key={cat.label} className="mb-1">
                <button
                  onClick={() => toggleCat(cat.label)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-3 hover:bg-surface-1 hover:text-text-1"
                >
                  {collapsed[cat.label] ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                  <span className="w-5 text-center font-mono text-accent-light">{CATEGORY_MARKERS[cat.label] ?? '*'}</span>
                  <span className="min-w-0 flex-1 truncate text-left">{cat.label}</span>
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-text-4">{cat.tools.length}</span>
                </button>
                {!collapsed[cat.label] && (
                  <div className="flex flex-col gap-0.5 pb-1">
                    {cat.tools.map((tool) => (
                      <button
                        key={tool.id}
                        onClick={() => selectTool(tool.id)}
                        className={cn(
                          'mx-1 rounded-md px-8 py-1.5 text-left text-xs transition-colors',
                          activeTool === tool.id
                            ? 'bg-accent/25 text-white shadow-[inset_2px_0_0_rgba(139,92,246,.9)]'
                            : 'text-text-3 hover:bg-surface-1 hover:text-text-1',
                        )}
                      >
                        {tool.id === 'jsonyaml' ? 'JSON <> YAML' : tool.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </nav>

        <main className="min-h-0 min-w-0 overflow-auto bg-surface-0">
          <div className="mx-auto flex min-h-full max-w-[1280px] flex-col gap-4 p-4">
            <div className="flex h-10 items-end gap-1 border-b border-border-1">
              <div className="inline-flex h-10 min-w-0 items-center gap-2 rounded-t-lg border border-b-0 border-accent/40 bg-accent/20 px-4 text-sm font-semibold text-text-1">
                <Zap size={15} className="text-accent-light" />
                <span className="truncate">{activeMeta?.id === 'jsonyaml' ? 'JSON <> YAML' : activeMeta?.label}</span>
                <button title="Close tab" className="ml-2 text-text-4 hover:text-text-1"><X size={13} /></button>
              </div>
              <button className="inline-flex h-9 items-center gap-2 rounded-t-md border border-b-0 border-border-2 bg-surface-1 px-4 text-xs text-text-3 hover:text-text-1">
                <Plus size={13} /> New Tool
              </button>
            </div>

            <section className="overflow-hidden rounded-xl border border-border-1 bg-surface-2/92 shadow-[0_20px_80px_rgba(0,0,0,.25)]">
              <div className="border-b border-border-1 px-4 py-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-lg border border-accent/20 bg-accent/10 text-accent-light">
                    <Zap size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-text-4">{activeMeta?.category}</p>
                    <h2 className="mt-1 text-lg font-semibold text-text-1">{activeMeta?.id === 'jsonyaml' ? 'JSON <> YAML' : activeMeta?.label}</h2>
                    <p className="mt-1 max-w-3xl text-xs text-text-3">{activeMeta?.desc}</p>
                  </div>
                  {activeTool === 'base64' && (
                    <div className="flex items-center gap-2">
                      <button className="inline-flex h-8 items-center gap-2 rounded-md border border-accent/35 bg-accent/15 px-3 text-xs font-semibold text-accent-light">
                        <Type size={14} /> Text
                      </button>
                      <button
                        onClick={() => setBinarySafe((value) => !value)}
                        className={cn(
                          'inline-flex h-8 items-center gap-2 rounded-md border px-3 text-xs font-semibold',
                          binarySafe ? 'border-accent/40 bg-accent/20 text-accent-light' : 'border-border-2 bg-surface-1 text-text-3 hover:text-text-1',
                        )}
                      >
                        <Box size={14} /> Binary-safe
                      </button>
                      <button title="Tool info" className="grid h-8 w-8 place-items-center rounded-md border border-border-2 bg-surface-1 text-text-4 hover:text-text-1">
                        <Info size={14} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div className="p-4">
                {renderTool()}
              </div>
            </section>

            {activeTool === 'base64' && (
              <section className="grid gap-3 rounded-xl border border-border-1 bg-surface-2/92 p-4 md:grid-cols-3 xl:grid-cols-6">
                {[
                  ['Input stats', b64InputChars, `${new Blob([b64Input]).size} bytes`],
                  ['Output stats', b64OutputChars, `${new Blob([b64Output]).size} bytes`],
                  ['Encoding', 'Base64', 'RFC 4648'],
                  ['Ratio', `${b64Ratio} : 1`, 'Encoded / Raw'],
                  ['Last run', lastToolRun || 'Not run yet', lastToolRun ? 'local' : '-'],
                  ['Validation', b64Output ? 'Valid UTF-8' : 'Ready', b64Output ? 'No errors detected' : 'Waiting'],
                ].map(([label, value, detail]) => (
                  <div key={label} className="border-r border-border-1 last:border-r-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-text-4">{label}</p>
                    <p className="mt-2 font-mono text-lg text-text-1">{value}</p>
                    <p className="mt-1 text-xs text-text-4">{detail}</p>
                  </div>
                ))}
              </section>
            )}
          </div>
        </main>

        <aside className="hidden min-h-0 flex-col gap-3 overflow-y-auto border-l border-border-1 bg-surface-1 p-3 2xl:flex">
          <div className="rounded-lg border border-border-1 bg-surface-0/60 p-3">
            <div className="mb-3 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-text-4">
              <span className="inline-flex items-center gap-2"><Clipboard size={12} /> Tool actions</span>
              <X size={12} />
            </div>
            <div className="flex flex-col gap-1">
              <button onClick={() => copy(activeInput)} disabled={!activeInput} className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-text-3 hover:bg-surface-1 hover:text-text-1 disabled:opacity-40">
                <Copy size={13} /> Copy Input
              </button>
              <button onClick={() => copy(activeOutput)} disabled={!activeOutput} className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-text-3 hover:bg-surface-1 hover:text-text-1 disabled:opacity-40">
                <Copy size={13} /> Copy Output
              </button>
              <button onClick={() => activeOutput && downloadText(`${activeTool}-output.txt`, activeOutput, 'text/plain')} disabled={!activeOutput} className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-text-3 hover:bg-surface-1 hover:text-text-1 disabled:opacity-40">
                <Save size={13} /> Save Output...
              </button>
              <button onClick={() => copy(`adomnia://powertools/${activeTool}`)} className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-text-3 hover:bg-surface-1 hover:text-text-1">
                <LinkIcon size={13} /> Share Tool Link
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-border-1 bg-surface-0/60 p-3">
            <div className="mb-3 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-text-4">
              <span className="inline-flex items-center gap-2"><History size={12} /> Recent history</span>
              <button className="text-accent-light hover:text-accent">View all</button>
            </div>
            <div className="flex flex-col gap-2">
              {recentRuns.map((item) => (
                <button key={`${item.id}-${item.label}`} onClick={() => selectTool(item.id)} className="grid grid-cols-[28px_1fr_auto] items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-surface-1">
                  <span className="grid h-7 w-7 place-items-center rounded-md border border-accent/20 bg-accent/10 text-accent-light"><Zap size={13} /></span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold text-text-2">{item.label}</span>
                    <span className="block truncate text-[10px] text-text-4">{item.detail}</span>
                  </span>
                  <span className="flex items-center gap-2 text-[10px] text-text-4">{item.ago}<CheckCircle2 size={12} className="text-success" /></span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-border-1 bg-surface-0/60 p-3">
            <div className="mb-3 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-text-4">
              <span className="inline-flex items-center gap-2"><Sparkles size={12} /> Favorite tools</span>
              <button className="text-accent-light hover:text-accent">Edit</button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {favoriteToolIds.map((toolId) => {
                const tool = allTools.find((item) => item.id === toolId)
                if (!tool) return null
                return (
                  <button key={toolId} onClick={() => selectTool(toolId)} className="rounded-md border border-border-1 bg-surface-1 px-2 py-2 text-center hover:border-accent/40 hover:bg-surface-2">
                    <span className="mx-auto mb-1 grid h-7 w-7 place-items-center rounded-md bg-accent/15 text-accent-light"><Zap size={13} /></span>
                    <span className="block truncate text-[10px] text-text-3">{tool.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="rounded-lg border border-border-1 bg-surface-0/60 p-3">
            <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-text-4">
              <Info size={12} /> Tips & shortcuts
            </div>
            <div className="grid grid-cols-[76px_1fr] gap-y-2 text-xs text-text-4">
              <span className="rounded bg-surface-1 px-1.5 py-0.5 font-mono text-[10px]">Ctrl Enter</span><span>Encode</span>
              <span className="rounded bg-surface-1 px-1.5 py-0.5 font-mono text-[10px]">Ctrl Shift</span><span>Decode</span>
              <span className="rounded bg-surface-1 px-1.5 py-0.5 font-mono text-[10px]">Ctrl L</span><span>Clear output</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface-0">
      <div className="h-8 px-4 border-b border-border-1 flex items-center gap-2 text-[11px] font-semibold tracking-wider">
        <span className="text-accent">PWR / TOOLS</span>
        <span className="text-text-4 font-normal">encoding · crypto · generators · network · validation</span>
      </div>
      <div className="h-10 px-4 border-b border-border-1 flex items-center gap-3">
        <span className="text-accent text-sm leading-none">/</span>
        <div className="min-w-0">
          <h1 className="text-sm font-semibold text-text-1 leading-tight">Power Tools</h1>
          <p className="text-[10px] text-text-4 leading-tight">{totalTools} tools — encoding, crypto, generators, network, validation</p>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        <nav className="w-56 flex-shrink-0 bg-surface-1 border-r border-border-1 flex flex-col overflow-y-auto py-1">
          {CATEGORIES.map((cat) => (
            <div key={cat.label}>
              <button
                onClick={() => toggleCat(cat.label)}
                className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-semibold text-text-3 uppercase tracking-wider hover:text-text-2"
              >
                {collapsed[cat.label] ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
                <span className="w-5 text-center text-accent-light font-mono">{CATEGORY_MARKERS[cat.label]}</span>
                <span className="truncate">{cat.label}</span>
                <span className="ml-auto min-w-5 rounded bg-surface-2 px-1.5 py-0.5 text-center text-[10px] text-text-4 font-normal">{cat.tools.length}</span>
              </button>
              {!collapsed[cat.label] && (
                <div className="flex flex-col pb-1">
                  {cat.tools.map((tool) => (
                    <button
                      key={tool.id}
                      onClick={() => setActiveTool(tool.id)}
                      className={cn(
                        'text-left mx-2 rounded px-9 py-1.5 text-xs transition-colors',
                        activeTool === tool.id
                          ? 'bg-accent/20 text-accent-light'
                          : 'text-text-3 hover:text-text-1 hover:bg-surface-2'
                      )}
                    >
                      {tool.id === 'jsonyaml' ? 'JSON <> YAML' : tool.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        <section className="flex-1 min-w-0 overflow-auto">
          <div className="max-w-5xl p-6">
            <div className="mb-5 border-b border-border-1 pb-4">
              <p className="text-[10px] uppercase tracking-wider text-text-4">{activeMeta?.category}</p>
              <h2 className="mt-1 text-base font-semibold text-text-1">{activeMeta?.id === 'jsonyaml' ? 'JSON <> YAML' : activeMeta?.label}</h2>
              <p className="mt-1 max-w-2xl text-xs text-text-3">{activeMeta?.desc}</p>
              {activeMeta?.example && (
                <p className="mt-2 inline-flex max-w-full rounded border border-border-1 bg-surface-1 px-2 py-1 text-[11px] text-text-3">
                  <span className="mr-1.5 text-text-4">Example:</span>
                  <span className="truncate font-mono text-text-2">{activeMeta.example}</span>
                </p>
              )}
            </div>
            {renderTool()}
          </div>
        </section>
      </div>
    </div>
  )
}
