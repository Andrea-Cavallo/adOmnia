import { PROJECT_SETTINGS_JSON_SCHEMA } from './projectSettings'
import { GO_STUDIO_WHEN_TERMS } from './when'

/**
 * Contesto del cursore in un JSON di impostazioni: quali chiavi lo contengono e se si sta
 * scrivendo una chiave o un valore. Serve a derivare i suggerimenti dallo schema.
 */

export interface JsonCursorContext {
  /** Chiavi che contengono il cursore: `['editor']` oppure `['keymap','bindings','file.save']`. */
  path: string[]
  expecting: 'key' | 'value'
  /** Chiave di cui si sta scrivendo il valore (quando `expecting` è `value`). */
  currentKey: string | null
  /** Estensione della stringa su cui si trova il cursore, virgolette comprese. */
  stringSpan: { start: number; end: number } | null
}

export function jsonCursorContext(text: string, offset: number): JsonCursorContext {
  const stack: Array<{ kind: 'object' | 'array'; key: string | null }> = []
  let inString = false
  let escaped = false
  let openQuote = -1
  let token = ''
  let lastString: string | null = null
  let pendingKey: string | null = null
  let expecting: 'key' | 'value' = 'key'
  const limit = Math.max(0, Math.min(offset, text.length))
  for (let index = 0; index < limit; index++) {
    const char = text[index]
    if (inString) {
      if (escaped) { escaped = false; token += char; continue }
      if (char === '\\') { escaped = true; continue }
      if (char === '"') { inString = false; lastString = token; continue }
      token += char
      continue
    }
    switch (char) {
      case '"': inString = true; openQuote = index; token = ''; break
      case '{': stack.push({ kind: 'object', key: pendingKey }); pendingKey = null; lastString = null; expecting = 'key'; break
      case '[': stack.push({ kind: 'array', key: pendingKey }); pendingKey = null; lastString = null; break
      case '}':
      case ']': stack.pop(); pendingKey = null; lastString = null; expecting = 'key'; break
      case ':': expecting = 'value'; pendingKey = lastString; break
      case ',': expecting = stack[stack.length - 1]?.kind === 'object' ? 'key' : 'value'; pendingKey = null; lastString = null; break
      default: break
    }
  }
  let stringSpan: JsonCursorContext['stringSpan'] = null
  if (inString) {
    let end = limit
    for (let index = limit; index < text.length; index++) {
      if (text[index] === '\\') { index++; continue }
      if (text[index] === '"') { end = index + 1; break }
      if (text[index] === '\n') { end = index; break }
    }
    stringSpan = { start: openQuote, end }
    if (expecting === 'key' && stack[stack.length - 1]?.kind === 'array') expecting = 'value'
  }
  return {
    path: stack.map((frame) => frame.key).filter((key): key is string => !!key),
    expecting,
    currentKey: pendingKey,
    stringSpan,
  }
}

export interface SettingsJsonSuggestion {
  label: string
  kind: 'key' | 'value'
  detail: string
  /** Testo da inserire, virgolette comprese dove servono. */
  insert: string
}

type SchemaProperty = { type?: string; description?: string; enum?: readonly string[]; const?: unknown; properties?: Record<string, SchemaProperty>; additionalProperties?: unknown }

function rootProperty(name: string): SchemaProperty | undefined {
  return (PROJECT_SETTINGS_JSON_SCHEMA.properties as Record<string, SchemaProperty>)[name]
}

function sectionProperties(section: 'editor' | 'keymap'): Record<string, SchemaProperty> {
  return rootProperty(section)?.properties ?? {}
}

function bindingFieldSchema(name: string): SchemaProperty | undefined {
  return (rootProperty('keymap')?.properties?.bindings as { additionalProperties?: { oneOf?: Array<{ properties?: Record<string, SchemaProperty> }> } } | undefined)?.additionalProperties?.oneOf?.[1]?.properties?.[name]
}

function keySuggestion(name: string, property: SchemaProperty | undefined): SettingsJsonSuggestion {
  return { label: name, kind: 'key', detail: property?.description ?? '', insert: `"${name}"` }
}

function valueSuggestion(value: string, property: SchemaProperty | undefined): SettingsJsonSuggestion {
  return { label: value, kind: 'value', detail: property?.description ?? '', insert: /^(true|false|-?\d)/.test(value) ? value : `"${value}"` }
}

/** Suggerimenti per il punto del cursore: chiavi da lo schema, valori dagli enum, comandi reali. */
export function settingsJsonCompletions(context: JsonCursorContext, commandIds: readonly string[] = [], commandLabels: Readonly<Record<string, string>> = {}): SettingsJsonSuggestion[] {
  const { path, expecting, currentKey } = context
  if (expecting === 'key') {
    if (path.length === 0) return ['format', 'version', 'editor', 'keymap'].map((name) => keySuggestion(name, rootProperty(name)))
    const [section, area, entry] = path
    if (section === 'editor' && path.length === 1) {
      return Object.entries(sectionProperties('editor')).map(([name, property]) => keySuggestion(name, property))
    }
    if (section === 'keymap' && path.length === 1) {
      return Object.entries(sectionProperties('keymap')).map(([name, property]) => keySuggestion(name, property))
    }
    if (section === 'keymap' && area === 'bindings' && path.length === 2) {
      return commandIds.map((id) => ({ label: id, kind: 'key' as const, detail: commandLabels[id] ?? 'command id', insert: `"${id}"` }))
    }
    if (section === 'keymap' && area === 'bindings' && path.length === 3 && entry) {
      return ['key', 'mod', 'shift', 'alt', 'when'].map((name) => keySuggestion(name, bindingFieldSchema(name)))
    }
    return []
  }
  // Valori: gli enum dello schema per la chiave corrente, true/false per i booleani.
  const property = valueProperty(path, currentKey)
  if (property?.enum) return property.enum.map((value) => valueSuggestion(value, property))
  if (currentKey === 'when') return GO_STUDIO_WHEN_TERMS.map((term) => valueSuggestion(term, { description: 'Context term: use it alone or with && , || and !' }))
  if (property && property.type === 'boolean') return [valueSuggestion('true', property), valueSuggestion('false', property)]
  return []
}

function valueProperty(path: string[], currentKey: string | null): SchemaProperty | undefined {
  if (!currentKey) return undefined
  const [section, area] = path
  if (path.length === 0) return rootProperty(currentKey)
  if (section === 'editor' && path.length === 1) return sectionProperties('editor')[currentKey]
  if (section === 'keymap' && path.length === 1) return sectionProperties('keymap')[currentKey]
  if (section === 'keymap' && area === 'bindings' && path.length === 3) return bindingFieldSchema(currentKey)
  return undefined
}
