// ─── WSDL Parser & SOAP Client ───────────────────────────────

export interface WsdlPort {
  name: string
  bindingName: string
  location: string
}

export interface WsdlService {
  name: string
  ports: WsdlPort[]
}

export interface WsdlMessagePart {
  name: string
  element?: string
  type?: string
}

export interface WsdlMessage {
  name: string
  parts: WsdlMessagePart[]
}

export interface WsdlOperation {
  name: string
  soapAction: string
  inputMessage?: WsdlMessage
  outputMessage?: WsdlMessage
  documentation?: string
}

export interface WsdlPortType {
  name: string
  operations: WsdlOperation[]
}

export interface WsdlBinding {
  name: string
  portTypeName: string
  operations: { name: string; soapAction: string }[]
}

export interface WsdlDocument {
  services: WsdlService[]
  portTypes: WsdlPortType[]
  bindings: WsdlBinding[]
  targetNamespace: string
  schemaElements: Record<string, XmlSchemaElement>
}

export interface XmlSchemaElement {
  name: string
  type?: string
  namespace?: string
  children?: Record<string, XmlSchemaElement>
  isArray?: boolean
  minOccurs?: number
  enumValues?: string[]
}

export interface SoapRequest {
  url: string
  soapAction: string
  envelope: string
  soapVersion: '1.1' | '1.2'
  customHeaders?: Record<string, string>
}

export interface SoapResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  ms: number
  size: number
  error?: string
}

export function parseWsdl(xml: string): WsdlDocument {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xml, 'text/xml')
  const err = doc.querySelector('parsererror')
  if (err) throw new Error('Invalid WSDL XML: ' + (err.textContent ?? 'parse error'))

  const root = doc.documentElement

  const ns: Record<string, string> = {}
  const attrs = root.attributes
  for (let i = 0; i < attrs.length; i++) {
    const a = attrs[i]
    if (a.name.startsWith('xmlns:')) {
      ns[a.name.slice(6)] = a.value
    } else if (a.name === 'xmlns') {
    }
  }

  const targetNamespace = root.getAttribute('targetNamespace') ?? ''

  // Extract schema elements
  const schemaElementsInit: Record<string, XmlSchemaElement> = {}
  const typesEl = findChild(root, 'types')
  if (typesEl) {
    const schemas = typesEl.getElementsByTagNameNS('*', 'schema')
    for (let i = 0; i < schemas.length; i++) {
      parseSchema(schemas[i], ns, schemaElementsInit)
    }
  }
  const schemaElements = schemaElementsInit

  // Parse messages
  const messageMap = new Map<string, WsdlMessage>()
  const messages = findChildren(root, 'message')
  for (const msgEl of messages) {
    const name = msgEl.getAttribute('name') ?? ''
    const parts: WsdlMessagePart[] = []
    const partEls = findChildren(msgEl, 'part')
    for (const p of partEls) {
      parts.push({
        name: p.getAttribute('name') ?? '',
        element: p.getAttribute('element') ?? undefined,
        type: p.getAttribute('type') ?? undefined,
      })
    }
    messageMap.set(name, { name, parts })
  }

  // Parse portTypes
  const portTypes: WsdlPortType[] = []
  const ptEls = findChildren(root, 'portType')
  for (const pt of ptEls) {
    const ptName = pt.getAttribute('name') ?? ''
    const operations: WsdlOperation[] = []
    const opEls = findChildren(pt, 'operation')
    for (const op of opEls) {
      const opName = op.getAttribute('name') ?? ''
      const input = findChild(op, 'input')
      const output = findChild(op, 'output')
      const docEl = findChild(op, 'documentation')
      const inputMsg = input?.getAttribute('message')
      const outputMsg = output?.getAttribute('message')
      // Remove ns prefix from message ref (e.g. "tns:GetUser" -> "GetUser")
      const inputMsgName = inputMsg ? inputMsg.split(':').pop() ?? '' : ''
      const outputMsgName = outputMsg ? outputMsg.split(':').pop() ?? '' : ''

      operations.push({
        name: opName,
        soapAction: '',
        inputMessage: messageMap.get(inputMsgName),
        outputMessage: messageMap.get(outputMsgName),
        documentation: docEl?.textContent?.trim() ?? undefined,
      })
    }
    portTypes.push({ name: ptName, operations })
  }

  // Parse bindings
  const bindings: WsdlBinding[] = []
  const bindingEls = findChildren(root, 'binding')
  for (const b of bindingEls) {
    const bName = b.getAttribute('name') ?? ''
    const bType = b.getAttribute('type') ?? ''
    const ptName = bType.split(':').pop() ?? ''
    const bOps: { name: string; soapAction: string }[] = []
    const bOpEls = findChildren(b, 'operation')
    for (const o of bOpEls) {
      const oName = o.getAttribute('name') ?? ''
      const saEl = o.getElementsByTagNameNS('*', 'operation').item(0)
        ?? o.getElementsByTagName('soap:operation').item(0)
        ?? o.getElementsByTagName('soap12:operation').item(0)
      const soapAction = saEl?.getAttribute('soapAction') ?? ''
      bOps.push({ name: oName, soapAction })
    }
    bindings.push({ name: bName, portTypeName: ptName, operations: bOps })
  }

  // Parse services/ports
  const services: WsdlService[] = []
  const svcEls = findChildren(root, 'service')
  for (const svc of svcEls) {
    const svcName = svc.getAttribute('name') ?? ''
    const ports: WsdlPort[] = []
    const portEls = findChildren(svc, 'port')
    for (const p of portEls) {
      const bindingRef = (p.getAttribute('binding') ?? '').split(':').pop() ?? ''
      const addrEl = p.getElementsByTagNameNS('*', 'address').item(0)
        ?? p.getElementsByTagName('soap:address').item(0)
        ?? p.getElementsByTagName('soap12:address').item(0)
      ports.push({
        name: p.getAttribute('name') ?? '',
        bindingName: bindingRef,
        location: addrEl?.getAttribute('location') ?? '',
      })
    }
    services.push({ name: svcName, ports })
  }

  // Enrich operations with soapAction from binding
  for (const svc of services) {
    for (const port of svc.ports) {
      const binding = bindings.find((b) => b.name === port.bindingName)
      const portType = portTypes.find((pt) => pt.name === binding?.portTypeName)
      if (binding && portType) {
        for (const op of portType.operations) {
          const bop = binding.operations.find((o) => o.name === op.name)
          if (bop) op.soapAction = bop.soapAction
        }
      }
    }
  }

  return { services, portTypes, bindings, targetNamespace, schemaElements }
}

function parseSchema(
  schemaEl: Element,
  _ns: Record<string, string>,
  out: Record<string, XmlSchemaElement>,
): void {
  const schemaNs = schemaEl.getAttribute('targetNamespace') ?? ''
  const elements = findChildren(schemaEl, 'element')
  for (const el of elements) {
    const name = el.getAttribute('name') ?? ''
    const type = el.getAttribute('type') ?? undefined
    const minOccurs = parseInt(el.getAttribute('minOccurs') ?? '1')

    const children: Record<string, XmlSchemaElement> = {}
    const complexType = findChild(el, 'complexType')
    if (complexType) {
      const seq = findChild(complexType, 'sequence')
        ?? findChild(complexType, 'all')
      if (seq) {
        const childEls = findChildren(seq, 'element')
        for (const ce of childEls) {
          const cName = ce.getAttribute('name') ?? ''
          children[cName] = {
            name: cName,
            type: ce.getAttribute('type') ?? 'string',
            minOccurs: parseInt(ce.getAttribute('minOccurs') ?? '1'),
          }
        }
      }
    }

    out[name] = { name, type, namespace: schemaNs || undefined, children: Object.keys(children).length ? children : undefined, minOccurs }
  }
}

function findChild(el: Element, localName: string): Element | null {
  for (let i = 0; i < el.children.length; i++) {
    const c = el.children[i]
    const ln = c.localName || c.tagName.split(':').pop() || ''
    if (ln === localName) return c
  }
  return null
}

function findChildren(el: Element, localName: string): Element[] {
  const result: Element[] = []
  for (let i = 0; i < el.children.length; i++) {
    const c = el.children[i]
    const ln = c.localName || c.tagName.split(':').pop() || ''
    if (ln === localName) result.push(c)
  }
  return result
}

// ─── Envelope generators ─────────────────────────────────────

export function generateSoapEnvelope(
  wsdl: WsdlDocument,
  operation: WsdlOperation,
  values: Record<string, string>,
  soapVersion: '1.1' | '1.2',
): string {
  const ns = wsdl.targetNamespace || 'urn:temp'
  const is12 = soapVersion === '1.2'
  const envNs = is12 ? 'http://www.w3.org/2003/05/soap-envelope' : 'http://schemas.xmlsoap.org/soap/envelope/'

  let bodyContent = `<ns0:${operation.name} xmlns:ns0="${ns}">`
  if (operation.inputMessage) {
    for (const part of operation.inputMessage.parts) {
      bodyContent += `\n    <${part.name}>`
      const val = values[part.name] ?? ''
      bodyContent += val
      bodyContent += `</${part.name}>`
    }
  }
  bodyContent += `\n  </ns0:${operation.name}>`

  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="${envNs}">
  <soap:Header>
  </soap:Header>
  <soap:Body>
    ${bodyContent}
  </soap:Body>
</soap:Envelope>`
}

export function generateEnvelopeWithSchema(
  operationName: string,
  schema: Record<string, XmlSchemaElement>,
  namespace: string,
  soapVersion: '1.1' | '1.2',
): string {
  const is12 = soapVersion === '1.2'
  const envNs = is12 ? 'http://www.w3.org/2003/05/soap-envelope' : 'http://schemas.xmlsoap.org/soap/envelope/'

  function schemaToXml(name: string, element: XmlSchemaElement, indent: number): string {
    const pad = ' '.repeat(indent)
    let xml = ``
    if (element.children) {
      xml += `<${name}`
      if (namespace) xml += ` xmlns="${namespace}"`
      xml += `>\n`
      for (const [cName, cEl] of Object.entries(element.children)) {
        if (cEl.children) {
          xml += schemaToXml(cName, cEl, indent + 2)
        } else {
          xml += `${pad}  <${cName}>?</${cName}>\n`
        }
      }
      xml += `${pad}</${name}>\n`
    } else {
      xml += `${pad}<${name}>?</${name}>\n`
    }
    return xml
  }

  const bodyEl = schema[operationName]
  let bodyContent = ''
  if (bodyEl && bodyEl.children) {
    bodyContent = `<ns0:${operationName} xmlns:ns0="${namespace}">\n`
    for (const [cName, cEl] of Object.entries(bodyEl.children)) {
      if (cEl.children) {
        bodyContent += schemaToXml(cName, cEl, 4)
      } else {
        bodyContent += `    <${cName}>?</${cName}>\n`
      }
    }
    bodyContent += `  </ns0:${operationName}>`
  } else {
    bodyContent = `<ns0:${operationName} xmlns:ns0="${namespace}" />`
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="${envNs}">
  <soap:Header>
  </soap:Header>
  <soap:Body>
    ${bodyContent}
  </soap:Body>
</soap:Envelope>`
}

export function addWsSecurityUsernameToken(
  envelope: string,
  username: string,
  password: string,
  _soapVersion: '1.1' | '1.2',
): string {
  const header = `<wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
    <wsse:UsernameToken>
      <wsse:Username>${escapeXml(username)}</wsse:Username>
      <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${escapeXml(password)}</wsse:Password>
    </wsse:UsernameToken>
  </wsse:Security>`

  return envelope.replace('<soap:Header>\n  </soap:Header>', `<soap:Header>\n    ${header}\n  </soap:Header>`)
}

// ─── Request execution ───────────────────────────────────────

export async function sendSoapRequest(
  req: SoapRequest,
  timeoutMs: number = 30000,
): Promise<SoapResponse> {
  const t0 = performance.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const ct = req.soapVersion === '1.2'
      ? 'application/soap+xml; charset=utf-8'
      : 'text/xml; charset=utf-8'

    const headers: Record<string, string> = { 'Content-Type': ct }
    if (req.soapAction) {
      headers['SOAPAction'] = req.soapAction
    }
    if (req.customHeaders) {
      Object.assign(headers, req.customHeaders)
    }

    const response = await fetch(req.url, {
      method: 'POST',
      headers,
      body: req.envelope,
      signal: controller.signal,
    })

    const body = await response.text()

    const respHeaders: Record<string, string> = {}
    response.headers.forEach((v, k) => {
      respHeaders[k] = v
    })

    return {
      status: response.status,
      statusText: response.statusText,
      headers: respHeaders,
      body,
      ms: Math.round(performance.now() - t0),
      size: new Blob([body]).size,
    }
  } catch (e) {
    return {
      status: 0,
      statusText: 'Error',
      headers: {},
      body: '',
      ms: Math.round(performance.now() - t0),
      size: 0,
      error: e instanceof Error ? e.message : String(e),
    }
  } finally {
    clearTimeout(timer)
  }
}

export function soapXmlToJson(xml: string): unknown {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xml, 'text/xml')
  const body = doc.getElementsByTagNameNS('*', 'Body').item(0)
    ?? doc.getElementsByTagName('soap:Body').item(0)
    ?? doc.getElementsByTagName('soap12:Body').item(0)
  if (!body) return { _raw: xml }
  return elementToJson(body.firstElementChild)
}

function elementToJson(el: Element | null): unknown {
  if (!el) return null
  const local = el.localName || el.tagName.split(':').pop() || el.tagName
  if (el.children.length === 0) {
    const text = el.textContent?.trim() ?? ''
    if (text === 'true') return true
    if (text === 'false') return false
    const num = Number(text)
    if (!isNaN(num) && text !== '') return num
    return text
  }

  const result: Record<string, unknown> = {}
  for (let i = 0; i < el.children.length; i++) {
    const c = el.children[i]
    const cName = c.localName || c.tagName.split(':').pop() || c.tagName
    const val = elementToJson(c)
    if (result[cName] !== undefined) {
      const existing = result[cName]
      result[cName] = Array.isArray(existing) ? [...existing, val] : [existing, val]
    } else {
      result[cName] = val
    }
  }
  return { __tag: local, ...result }
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

export function validateSoapXml(xml: string): { valid: boolean; error?: string } {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xml, 'text/xml')
  const err = doc.querySelector('parsererror')
  if (err) return { valid: false, error: err.textContent ?? 'XML parse error' }
  const body = doc.getElementsByTagNameNS('*', 'Body').item(0)
    ?? doc.getElementsByTagName('soap:Body').item(0)
    ?? doc.getElementsByTagName('soap12:Body').item(0)
  if (!body) return { valid: true, error: 'No SOAP Body found (not a SOAP response?)' }
  const fault = doc.getElementsByTagNameNS('*', 'Fault').item(0)
    ?? doc.getElementsByTagName('soap:Fault').item(0)
    ?? doc.getElementsByTagName('soap12:Fault').item(0)
  if (fault) return { valid: false, error: 'SOAP Fault detected' }
  return { valid: true }
}

export function exportSoapCurl(soapReq: SoapRequest): string {
  const ct = soapReq.soapVersion === '1.2'
    ? 'application/soap+xml'
    : 'text/xml'
  let cmd = `curl -X POST "${soapReq.url}"`
  cmd += ` \\\n  -H "Content-Type: ${ct}"`
  if (soapReq.soapAction) {
    cmd += ` \\\n  -H "SOAPAction: ${soapReq.soapAction}"`
  }
  const body = soapReq.envelope.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  cmd += ` \\\n  -d "${body}"`
  return cmd
}

export function generateSoapClientCode(
  _operation: string,
  url: string,
  soapAction: string,
  soapVersion: '1.1' | '1.2',
): { python: string; curl: string; node: string } {
  const ct = soapVersion === '1.2' ? 'application/soap+xml' : 'text/xml'

  const python = `import requests

url = "${url}"
headers = {
    "Content-Type": "${ct}",${soapAction ? `\n    "SOAPAction": "${soapAction}",` : ''}
}
envelope = """<soap:Envelope ...>...</soap:Envelope>"""

response = requests.post(url, data=envelope, headers=headers)
print(response.status_code)
print(response.text)
`

  const nodeJs = `const https = require('https');

const envelope = \`<soap:Envelope ...>...</soap:Envelope>\`;

const options = {
  method: 'POST',
  headers: {
    'Content-Type': '${ct}',${soapAction ? `\n    'SOAPAction': '${soapAction}',` : ''}
    'Content-Length': Buffer.byteLength(envelope),
  },
};

const req = https.request("${url}", options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => { console.log(res.statusCode, data); });
});
req.write(envelope);
req.end();
`

  return { python, curl: '', node: nodeJs }
}

export interface SoapHistoryEntry {
  timestamp: number
  operation: string
  url: string
  envelope: string
  response: string
  status: number
  durationMs: number
}

const HISTORY_KEY = 'adomnia.soap.history'
const HISTORY_MAX = 50

export function loadSoapHistory(): SoapHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export function saveSoapHistory(entries: SoapHistoryEntry[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, HISTORY_MAX)))
  } catch { /* quota exceeded */ }
}

export function addSoapHistoryEntry(entry: SoapHistoryEntry): SoapHistoryEntry[] {
  const history = loadSoapHistory()
  history.unshift(entry)
  saveSoapHistory(history)
  return history.slice(0, HISTORY_MAX)
}
