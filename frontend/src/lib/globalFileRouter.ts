export type RoutedToolFile =
  | { kind: 'har'; name: string; text: string }
  | { kind: 'wsdl'; name: string; text: string }
  | { kind: 'mermaid'; name: string; text: string }
  | { kind: 'latex'; name: string; text: string }
  | { kind: 'proto'; name: string; text: string }
  | { kind: 'sql'; name: string; text: string }
  | { kind: 'class'; name: string; bytes: Uint8Array }
  | { kind: 'pdf'; name: string; bytes: Uint8Array }

export type GlobalDropFile =
  | RoutedToolFile
  | { kind: 'environment'; name: string; text: string }
  | { kind: 'collection'; name: string; text: string }

function isHarDocument(text: string): boolean {
  try {
    const json = JSON.parse(text) as { log?: { entries?: unknown } }
    return Array.isArray(json.log?.entries)
  } catch {
    return false
  }
}

function isWsdlDocument(text: string): boolean {
  return /<(?:\w+:)?definitions(?:\s|>)/i.test(text) &&
    /(xmlns(?::\w+)?=["'][^"']*wsdl|<(?:\w+:)?service(?:\s|>))/i.test(text)
}

export async function routeGlobalDropFile(file: File): Promise<GlobalDropFile> {
  const lower = file.name.toLowerCase()

  if (lower.endsWith('.class')) {
    return { kind: 'class', name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }
  }
  if (lower.endsWith('.pdf')) {
    return { kind: 'pdf', name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }
  }

  const text = await file.text()
  if (lower.endsWith('.har') || isHarDocument(text)) {
    return { kind: 'har', name: file.name, text }
  }
  if (lower.endsWith('.wsdl') || isWsdlDocument(text)) {
    return { kind: 'wsdl', name: file.name, text }
  }
  if (/\.(mmd|mermaid)$/i.test(lower)) {
    return { kind: 'mermaid', name: file.name, text }
  }
  if (lower.endsWith('.tex')) {
    return { kind: 'latex', name: file.name, text }
  }
  if (lower.endsWith('.proto')) {
    return { kind: 'proto', name: file.name, text }
  }
  if (lower.endsWith('.sql')) {
    return { kind: 'sql', name: file.name, text }
  }
  if (lower === 'env.yaml') {
    return { kind: 'environment', name: file.name, text }
  }
  if (/\.(json|ya?ml|adomnia|bru)$/i.test(lower)) {
    return { kind: 'collection', name: file.name, text }
  }

  throw new Error('Unsupported file. Drop env.yaml, a collection JSON/YAML/.bru, Mermaid .mmd/.mermaid, LaTeX .tex, .proto, .sql, .har, .wsdl, .pdf, or Java .class file.')
}
