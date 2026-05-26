/**
 * WS-Security signing utilities for adOmnia SOAP Studio.
 *
 * Implements:
 *  - UsernameToken (PasswordText and PasswordDigest)
 *  - Timestamp token (wsu:Timestamp)
 *  - X.509 BinarySecurityToken + XML-DSig Signature (RSA-SHA256, Exclusive C14N)
 *
 * Uses the browser Web Crypto API (SubtleCrypto) — no native dependencies.
 */

// ─── WS-Security namespaces ───────────────────────────────────────────────────

const WSS_NS = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd'
const WSU_NS = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd'
const DS_NS = 'http://www.w3.org/2000/09/xmldsig#'
const EXC_C14N_NS = 'http://www.w3.org/2001/10/xml-exc-c14n#'
const X509_TOKEN_PROFILE = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#x9;')
    .replace(/\n/g, '&#xA;')
    .replace(/\r/g, '&#xD;')
}

function escapeText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r/g, '&#xD;')
}

function pemToBytes(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN[^-]+-----/g, '')
    .replace(/-----END[^-]+-----/g, '')
    .replace(/\r?\n/g, '')
    .trim()
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z')
}

function futureIso(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString().replace(/\.\d+Z$/, 'Z')
}

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

// ─── Exclusive XML Canonicalization (exc-c14n) ────────────────────────────────
//
// Implements W3C Exclusive XML Canonicalization
// https://www.w3.org/TR/xml-exc-c14n/
//
// Rules applied:
//  - Only namespace declarations "visibly utilized" by the element are rendered
//  - Namespace declarations that differ from the parent element's in-scope bindings are output
//  - Namespace declarations sorted: default namespace first, then alphabetical by prefix
//  - Non-namespace attributes sorted: no-NS attributes first (by local name), then by (NS-URI, local name)
//  - Comments are excluded (without-comments variant)
//  - CDATA sections are serialized as text

function getNsInScope(el: Element, prefix: string): string {
  let cur: Element | null = el
  while (cur) {
    const attr = prefix === '' ? cur.getAttribute('xmlns') : cur.getAttribute(`xmlns:${prefix}`)
    if (attr !== null) return attr
    cur = cur.parentElement
  }
  return ''
}

function getNsAtParent(el: Element, prefix: string): string {
  const parent = el.parentElement
  if (!parent) return ''
  return getNsInScope(parent, prefix)
}

function getDirectlyUtilizedPrefixes(el: Element): Set<string> {
  const prefixes = new Set<string>()
  if (el.prefix) prefixes.add(el.prefix)
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i]
    if (attr.prefix && attr.prefix !== 'xmlns' && attr.prefix !== 'xml') {
      prefixes.add(attr.prefix)
    }
  }
  return prefixes
}

function excC14NElement(el: Element): string {
  const utilized = getDirectlyUtilizedPrefixes(el)

  // If element has no prefix but has a namespace URI, include the default namespace
  const includeDefault = !el.prefix && !!el.namespaceURI

  // Collect namespace declarations to emit
  const nsDecls: Array<{ prefix: string; uri: string }> = []

  for (const prefix of utilized) {
    const cur = getNsInScope(el, prefix)
    const par = getNsAtParent(el, prefix)
    if (cur !== par) {
      nsDecls.push({ prefix, uri: cur })
    }
  }

  if (includeDefault) {
    const cur = getNsInScope(el, '')
    const par = getNsAtParent(el, '')
    if (cur !== par) {
      nsDecls.push({ prefix: '', uri: cur })
    }
  }

  // Sort: default namespace first, then alphabetical by prefix
  nsDecls.sort((a, b) => {
    if (a.prefix === '' && b.prefix !== '') return -1
    if (a.prefix !== '' && b.prefix === '') return 1
    return a.prefix.localeCompare(b.prefix)
  })

  const tagName = el.prefix ? `${el.prefix}:${el.localName}` : el.localName
  let out = `<${tagName}`

  for (const { prefix, uri } of nsDecls) {
    out += prefix === '' ? ` xmlns="${escapeAttr(uri)}"` : ` xmlns:${prefix}="${escapeAttr(uri)}"`
  }

  // Collect non-namespace attributes, sort per C14N spec
  type AttrEntry = { ns: string; local: string; name: string; value: string }
  const attrs: AttrEntry[] = []
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i]
    if (attr.name === 'xmlns' || attr.name.startsWith('xmlns:')) continue
    attrs.push({
      ns: attr.namespaceURI ?? '',
      local: attr.localName,
      name: attr.prefix ? `${attr.prefix}:${attr.localName}` : attr.localName,
      value: attr.value,
    })
  }

  // Sort: attributes with no NS first (by local name), then with NS (by NS-URI then local name)
  attrs.sort((a, b) => {
    if (!a.ns && b.ns) return -1
    if (a.ns && !b.ns) return 1
    if (a.ns !== b.ns) return a.ns.localeCompare(b.ns)
    return a.local.localeCompare(b.local)
  })

  for (const attr of attrs) {
    out += ` ${attr.name}="${escapeAttr(attr.value)}"`
  }

  out += '>'

  for (let i = 0; i < el.childNodes.length; i++) {
    const child = el.childNodes[i]
    if (child.nodeType === Node.ELEMENT_NODE) {
      out += excC14NElement(child as Element)
    } else if (child.nodeType === Node.TEXT_NODE || child.nodeType === Node.CDATA_SECTION_NODE) {
      out += escapeText(child.textContent ?? '')
    }
    // Comments excluded; processing instructions in body excluded for simplicity
  }

  out += `</${tagName}>`
  return out
}

// ─── Locate an element by wsu:Id in a parsed SOAP document ───────────────────

function findByWsuId(doc: Document, id: string): Element | null {
  const walker = doc.createTreeWalker(doc.documentElement, NodeFilter.SHOW_ELEMENT)
  let node: Node | null = walker.nextNode()
  while (node) {
    const el = node as Element
    const wsuId = el.getAttributeNS(WSU_NS, 'Id')
    if (wsuId === id) return el
    node = walker.nextNode()
  }
  return null
}

// ─── SHA-256 digest → base64 ─────────────────────────────────────────────────

async function sha256B64(text: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(text)
  const hashBuf = await crypto.subtle.digest('SHA-256', data)
  return bytesToB64(hashBuf)
}

// ─── Envelope helpers ─────────────────────────────────────────────────────────

function parseSoapDoc(envelope: string): Document {
  const parser = new DOMParser()
  const doc = parser.parseFromString(envelope, 'text/xml')
  const err = doc.querySelector('parsererror')
  if (err) throw new Error('SOAP XML parse error: ' + (err.textContent ?? ''))
  return doc
}

function serializeSoapDoc(doc: Document): string {
  const s = new XMLSerializer()
  return s.serializeToString(doc)
}

function getOrCreateSecurityHeader(doc: Document, soapNs: string): Element {
  // Find existing Security element
  const existing = doc.getElementsByTagNameNS(WSS_NS, 'Security').item(0)
  if (existing) return existing

  // Find or create Header
  let header = doc.getElementsByTagNameNS(soapNs, 'Header').item(0)
  if (!header) {
    const envelope = doc.getElementsByTagNameNS(soapNs, 'Envelope').item(0)
    if (!envelope) throw new Error('No SOAP Envelope found')
    header = doc.createElementNS(soapNs, 'soap:Header')
    envelope.insertBefore(header, envelope.firstChild)
  }

  // Create Security element
  const security = doc.createElementNS(WSS_NS, 'wsse:Security')
  security.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:wsse', WSS_NS)
  security.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:wsu', WSU_NS)
  header.appendChild(security)
  return security
}

function detectSoapNs(envelope: string): string {
  if (envelope.includes('http://www.w3.org/2003/05/soap-envelope')) {
    return 'http://www.w3.org/2003/05/soap-envelope'
  }
  return 'http://schemas.xmlsoap.org/soap/envelope/'
}

function ensureBodyHasWsuId(doc: Document, soapNs: string, id: string): Element {
  const body = doc.getElementsByTagNameNS(soapNs, 'Body').item(0)
  if (!body) throw new Error('No SOAP Body found')
  if (!body.getAttributeNS(WSU_NS, 'Id')) {
    body.setAttributeNS(WSU_NS, 'wsu:Id', id)
    if (!body.getAttribute('xmlns:wsu')) {
      body.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:wsu', WSU_NS)
    }
  }
  return body
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Adds a WS-Security UsernameToken with plain-text password.
 */
export function addWssUsernameTokenText(
  envelope: string,
  username: string,
  password: string,
): string {
  const soapNs = detectSoapNs(envelope)
  const doc = parseSoapDoc(envelope)
  const security = getOrCreateSecurityHeader(doc, soapNs)

  const tokenId = randomId('UT')
  const created = nowIso()

  const token = doc.createElementNS(WSS_NS, 'wsse:UsernameToken')
  token.setAttributeNS(WSU_NS, 'wsu:Id', tokenId)
  token.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:wsu', WSU_NS)

  const uname = doc.createElementNS(WSS_NS, 'wsse:Username')
  uname.textContent = username
  token.appendChild(uname)

  const pass = doc.createElementNS(WSS_NS, 'wsse:Password')
  pass.setAttribute(
    'Type',
    'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText',
  )
  pass.textContent = password
  token.appendChild(pass)

  const createdEl = doc.createElementNS(WSU_NS, 'wsu:Created')
  createdEl.textContent = created
  token.appendChild(createdEl)

  security.appendChild(token)
  return serializeSoapDoc(doc)
}

/**
 * Adds a WS-Security UsernameToken with PasswordDigest.
 * PasswordDigest = Base64(SHA-1(nonce_bytes + created_bytes + password_bytes))
 */
export async function addWssUsernameTokenDigest(
  envelope: string,
  username: string,
  password: string,
): Promise<string> {
  const soapNs = detectSoapNs(envelope)
  const doc = parseSoapDoc(envelope)
  const security = getOrCreateSecurityHeader(doc, soapNs)

  const created = nowIso()

  // Generate 16-byte nonce
  const nonceBytes = new Uint8Array(16)
  crypto.getRandomValues(nonceBytes)
  const nonceB64 = bytesToB64(nonceBytes.buffer)

  // Compute digest: SHA-1(nonce_bytes + UTF-8(created) + UTF-8(password))
  const createdBytes = new TextEncoder().encode(created)
  const passwordBytes = new TextEncoder().encode(password)
  const concat = new Uint8Array(nonceBytes.length + createdBytes.length + passwordBytes.length)
  concat.set(nonceBytes, 0)
  concat.set(createdBytes, nonceBytes.length)
  concat.set(passwordBytes, nonceBytes.length + createdBytes.length)

  const hashBuf = await crypto.subtle.digest('SHA-1', concat)
  const digestB64 = bytesToB64(hashBuf)

  const tokenId = randomId('UT')
  const token = doc.createElementNS(WSS_NS, 'wsse:UsernameToken')
  token.setAttributeNS(WSU_NS, 'wsu:Id', tokenId)
  token.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:wsu', WSU_NS)

  const uname = doc.createElementNS(WSS_NS, 'wsse:Username')
  uname.textContent = username
  token.appendChild(uname)

  const pass = doc.createElementNS(WSS_NS, 'wsse:Password')
  pass.setAttribute(
    'Type',
    'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest',
  )
  pass.textContent = digestB64
  token.appendChild(pass)

  const nonceEl = doc.createElementNS(WSS_NS, 'wsse:Nonce')
  nonceEl.setAttribute(
    'EncodingType',
    'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary',
  )
  nonceEl.textContent = nonceB64
  token.appendChild(nonceEl)

  const createdEl = doc.createElementNS(WSU_NS, 'wsu:Created')
  createdEl.textContent = created
  token.appendChild(createdEl)

  security.appendChild(token)
  return serializeSoapDoc(doc)
}

/**
 * Adds (or replaces) a wsu:Timestamp in the WS-Security header.
 */
export function addWssTimestamp(
  envelope: string,
  ttlSeconds = 300,
): string {
  const soapNs = detectSoapNs(envelope)
  const doc = parseSoapDoc(envelope)
  const security = getOrCreateSecurityHeader(doc, soapNs)

  // Remove existing timestamp if present
  const existing = security.getElementsByTagNameNS(WSU_NS, 'Timestamp').item(0)
  if (existing) security.removeChild(existing)

  const tsId = randomId('TS')
  const ts = doc.createElementNS(WSU_NS, 'wsu:Timestamp')
  ts.setAttributeNS(WSU_NS, 'wsu:Id', tsId)

  const created = doc.createElementNS(WSU_NS, 'wsu:Created')
  created.textContent = nowIso()
  ts.appendChild(created)

  const expires = doc.createElementNS(WSU_NS, 'wsu:Expires')
  expires.textContent = futureIso(ttlSeconds)
  ts.appendChild(expires)

  // Prepend timestamp (must come before other tokens)
  security.insertBefore(ts, security.firstChild)
  return serializeSoapDoc(doc)
}

export type WssX509Options = {
  /** PEM-encoded X.509 certificate */
  pemCert: string
  /** PEM-encoded private key (PKCS#8 format, RSA) */
  pemKey: string
  /** Include a wsu:Timestamp in the signed elements. Default true */
  includeTimestamp?: boolean
  /** Timestamp TTL in seconds. Default 300 */
  ttlSeconds?: number
}

/**
 * Signs a SOAP envelope with WS-Security X.509 certificate using XML-DSig.
 *
 * Steps:
 *  1. Add wsu:Timestamp to Security header (if includeTimestamp)
 *  2. Add wsse:BinarySecurityToken containing the DER-encoded certificate
 *  3. Add wsu:Id to soap:Body
 *  4. Compute Exclusive C14N + SHA-256 digest of Body (and Timestamp)
 *  5. Build ds:SignedInfo, compute Exclusive C14N of it
 *  6. Sign with RSA-SHA256 (PKCS#1 v1.5)
 *  7. Inject complete ds:Signature into Security header
 */
export async function addWssX509Signature(
  envelope: string,
  options: WssX509Options,
): Promise<string> {
  const { pemCert, pemKey, includeTimestamp = true, ttlSeconds = 300 } = options
  const soapNs = detectSoapNs(envelope)

  // --- Parse the envelope ---
  const doc = parseSoapDoc(envelope)
  const security = getOrCreateSecurityHeader(doc, soapNs)

  const certDerB64 = pemToBytes(pemCert)
  const certB64 = bytesToB64(certDerB64.buffer as ArrayBuffer)

  // --- Timestamp ---
  let tsId: string | null = null
  if (includeTimestamp) {
    tsId = randomId('TS')
    const ts = doc.createElementNS(WSU_NS, 'wsu:Timestamp')
    ts.setAttributeNS(WSU_NS, 'wsu:Id', tsId)
    ts.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:wsu', WSU_NS)

    const created = doc.createElementNS(WSU_NS, 'wsu:Created')
    created.textContent = nowIso()
    ts.appendChild(created)

    const expires = doc.createElementNS(WSU_NS, 'wsu:Expires')
    expires.textContent = futureIso(ttlSeconds)
    ts.appendChild(expires)

    security.insertBefore(ts, security.firstChild)
  }

  // --- BinarySecurityToken ---
  const bstId = randomId('BST')
  const bst = doc.createElementNS(WSS_NS, 'wsse:BinarySecurityToken')
  bst.setAttributeNS(WSU_NS, 'wsu:Id', bstId)
  bst.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:wsu', WSU_NS)
  bst.setAttribute('ValueType', X509_TOKEN_PROFILE)
  bst.setAttribute(
    'EncodingType',
    'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary',
  )
  bst.textContent = certB64
  security.appendChild(bst)

  // --- Assign wsu:Id to Body ---
  const bodyId = randomId('Body')
  ensureBodyHasWsuId(doc, soapNs, bodyId)

  // --- Import private key ---
  const keyBytes = pemToBytes(pemKey)
  let cryptoKey: CryptoKey
  try {
    cryptoKey = await crypto.subtle.importKey(
      'pkcs8',
      keyBytes.buffer as ArrayBuffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    )
  } catch {
    throw new Error(
      'Failed to import private key. Make sure it is in PKCS#8 PEM format (-----BEGIN PRIVATE KEY-----).',
    )
  }

  // --- Compute digests of signed elements (must be done after DOM mutations) ---
  // We need to re-find the elements after all DOM mutations are done
  const bodyEl = doc.getElementsByTagNameNS(soapNs, 'Body').item(0)
  if (!bodyEl) throw new Error('No soap:Body found')

  const bodyC14N = excC14NElement(bodyEl)
  const bodyDigest = await sha256B64(bodyC14N)

  let tsDigest: string | null = null
  if (tsId) {
    const tsEl = findByWsuId(doc, tsId)
    if (!tsEl) throw new Error('Timestamp element not found after insertion')
    const tsC14N = excC14NElement(tsEl)
    tsDigest = await sha256B64(tsC14N)
  }

  // --- Build ds:SignedInfo XML string ---
  let signedInfoXml = `<ds:SignedInfo xmlns:ds="${DS_NS}">`
  signedInfoXml += `<ds:CanonicalizationMethod Algorithm="${EXC_C14N_NS}"/>`
  signedInfoXml += `<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>`

  if (tsId && tsDigest) {
    signedInfoXml += `<ds:Reference URI="#${tsId}">`
    signedInfoXml += `<ds:Transforms>`
    signedInfoXml += `<ds:Transform Algorithm="${EXC_C14N_NS}"/>`
    signedInfoXml += `</ds:Transforms>`
    signedInfoXml += `<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>`
    signedInfoXml += `<ds:DigestValue>${tsDigest}</ds:DigestValue>`
    signedInfoXml += `</ds:Reference>`
  }

  signedInfoXml += `<ds:Reference URI="#${bodyId}">`
  signedInfoXml += `<ds:Transforms>`
  signedInfoXml += `<ds:Transform Algorithm="${EXC_C14N_NS}"/>`
  signedInfoXml += `</ds:Transforms>`
  signedInfoXml += `<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>`
  signedInfoXml += `<ds:DigestValue>${bodyDigest}</ds:DigestValue>`
  signedInfoXml += `</ds:Reference>`
  signedInfoXml += `</ds:SignedInfo>`

  // --- Canonicalize SignedInfo and sign ---
  // Parse the SignedInfo fragment to canonicalize it
  const siDoc = parseSoapDoc(
    `<?xml version="1.0"?><root xmlns:ds="${DS_NS}">${signedInfoXml}</root>`,
  )
  const siEl = siDoc.getElementsByTagNameNS(DS_NS, 'SignedInfo').item(0)
  if (!siEl) throw new Error('Failed to parse SignedInfo')
  const signedInfoC14N = excC14NElement(siEl)

  const siBytes = new TextEncoder().encode(signedInfoC14N)
  const sigBuf = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, siBytes)
  const sigB64 = bytesToB64(sigBuf)

  // --- Inject ds:Signature into Security header ---
  const sigId = randomId('SIG')

  const sigXml = `<ds:Signature xmlns:ds="${DS_NS}" Id="${sigId}">`
    + signedInfoXml
    + `<ds:SignatureValue>${sigB64}</ds:SignatureValue>`
    + `<ds:KeyInfo>`
    + `<wsse:SecurityTokenReference xmlns:wsse="${WSS_NS}">`
    + `<wsse:Reference URI="#${bstId}" ValueType="${X509_TOKEN_PROFILE}"/>`
    + `</wsse:SecurityTokenReference>`
    + `</ds:KeyInfo>`
    + `</ds:Signature>`

  // Parse the Signature fragment and import into the document
  const sigFrag = parseSoapDoc(
    `<?xml version="1.0"?><root xmlns:ds="${DS_NS}" xmlns:wsse="${WSS_NS}">${sigXml}</root>`,
  )
  const sigEl = sigFrag.getElementsByTagNameNS(DS_NS, 'Signature').item(0)
  if (!sigEl) throw new Error('Failed to build Signature element')

  const importedSig = doc.importNode(sigEl, true)
  security.appendChild(importedSig)

  return serializeSoapDoc(doc)
}

// ─── WssConfig type ───────────────────────────────────────────────────────────

export type WssMode = 'none' | 'username_text' | 'username_digest' | 'timestamp' | 'x509'

export interface WssConfig {
  mode: WssMode
  username: string
  password: string
  ttlSeconds: number
  pemCert: string
  pemKey: string
  includeTimestamp: boolean
}

export function defaultWssConfig(): WssConfig {
  return {
    mode: 'none',
    username: '',
    password: '',
    ttlSeconds: 300,
    pemCert: '',
    pemKey: '',
    includeTimestamp: true,
  }
}

/**
 * Apply WS-Security to an envelope according to the given config.
 * Returns the modified envelope string.
 */
export async function applyWssSecurity(envelope: string, config: WssConfig): Promise<string> {
  switch (config.mode) {
    case 'none':
      return envelope
    case 'username_text':
      return addWssUsernameTokenText(envelope, config.username, config.password)
    case 'username_digest':
      return addWssUsernameTokenDigest(envelope, config.username, config.password)
    case 'timestamp':
      return addWssTimestamp(envelope, config.ttlSeconds)
    case 'x509':
      return addWssX509Signature(envelope, {
        pemCert: config.pemCert,
        pemKey: config.pemKey,
        includeTimestamp: config.includeTimestamp,
        ttlSeconds: config.ttlSeconds,
      })
    default:
      return envelope
  }
}
