export type RoutedToolFile =
  | { kind: 'har'; name: string; text: string }
  | { kind: 'wsdl'; name: string; text: string }
  | { kind: 'class'; name: string; bytes: Uint8Array }

export type GlobalDropFile =
  | RoutedToolFile
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

  const text = await file.text()
  if (lower.endsWith('.har') || isHarDocument(text)) {
    return { kind: 'har', name: file.name, text }
  }
  if (lower.endsWith('.wsdl') || isWsdlDocument(text)) {
    return { kind: 'wsdl', name: file.name, text }
  }
  if (/\.(json|ya?ml|adomnia)$/i.test(lower)) {
    return { kind: 'collection', name: file.name, text }
  }

  throw new Error('Unsupported file. Drop a collection JSON/YAML, .har, .wsdl, or Java .class file.')
}
