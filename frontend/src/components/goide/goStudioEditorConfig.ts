import { useEffect, useState } from 'react'
import { closeGoIDEDocument, openGoIDEDocument } from '@/lib/goide-api'
import { useGoIDEStore } from '@/stores/goide'

/**
 * EditorConfig (https://editorconfig.org) per Go Studio: indentazione, spazi in coda e
 * newline finale. ponytail: vale il solo `.editorconfig` nella radice del progetto; quelli
 * annidati nelle sottocartelle vanno aggiunti quando servono (serve risalire l'albero per file).
 */

export interface EditorConfigProperties {
  indent_style?: 'tab' | 'space'
  indent_size?: number
  tab_width?: number
  trim_trailing_whitespace?: boolean
  insert_final_newline?: boolean
}

interface EditorConfigSection {
  pattern: RegExp
  properties: EditorConfigProperties
}

/** Converte un glob EditorConfig in regex sul percorso relativo alla radice del progetto. */
export function editorConfigGlob(glob: string): RegExp {
  let source = ''
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index]
    if (char === '*') {
      if (glob[index + 1] === '*') { source += '.*'; index++ } else source += '[^/]*'
    } else if (char === '?') source += '[^/]'
    else if (char === '{') {
      const end = glob.indexOf('}', index)
      if (end < 0) { source += '\\{'; continue }
      source += `(?:${glob.slice(index + 1, end).split(',').map((part) => part.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('|')})`
      index = end
    } else if (char === '[') {
      const end = glob.indexOf(']', index)
      if (end < 0) { source += '\\['; continue }
      source += `[${glob.slice(index + 1, end).replace(/^!/, '^')}]`
      index = end
    } else source += char.replace(/[.+^$()|\\]/g, '\\$&')
  }
  // Senza "/" il glob vale per il nome del file in qualunque cartella; con "/" dalla radice.
  const anchored = glob.includes('/') ? source.replace(/^\//, '') : `(?:.*/)?${source}`
  return new RegExp(`^${anchored}$`, 'i')
}

export function parseEditorConfig(text: string): EditorConfigSection[] {
  const sections: EditorConfigSection[] = []
  let current: EditorConfigSection | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    const header = /^\[(.+)\]$/.exec(line)
    if (header) {
      current = { pattern: editorConfigGlob(header[1]), properties: {} }
      sections.push(current)
      continue
    }
    const pair = /^([^=:]+)[=:](.*)$/.exec(line)
    if (!pair || !current) continue
    const key = pair[1].trim().toLowerCase()
    const value = pair[2].trim().toLowerCase()
    const props = current.properties
    if (key === 'indent_style' && (value === 'tab' || value === 'space')) props.indent_style = value
    if ((key === 'indent_size' || key === 'tab_width') && /^\d+$/.test(value)) props[key] = Number(value)
    if (key === 'indent_size' && value === 'tab') props.indent_style = 'tab'
    if ((key === 'trim_trailing_whitespace' || key === 'insert_final_newline') && (value === 'true' || value === 'false')) props[key] = value === 'true'
  }
  return sections
}

/** Proprietà del file: le sezioni successive sovrascrivono le precedenti, come da specifica. */
export function editorConfigFor(sections: EditorConfigSection[], relativePath: string): EditorConfigProperties {
  const path = relativePath.replace(/\\/g, '/')
  return sections.filter((section) => section.pattern.test(path)).reduce<EditorConfigProperties>((merged, section) => ({ ...merged, ...section.properties }), {})
}

const TAB_ONLY_LANGUAGES = new Set(['go', 'goasm', 'makefile'])

/** Indentazione per Monaco: Go, assembly e Makefile restano a tab (gofmt e make lo impongono). */
export function indentationFor(language: string, config: EditorConfigProperties): { tabSize: number; insertSpaces: boolean } {
  if (TAB_ONLY_LANGUAGES.has(language)) return { tabSize: config.tab_width ?? 4, insertSpaces: false }
  const insertSpaces = config.indent_style ? config.indent_style === 'space' : true
  return { tabSize: config.indent_size ?? config.tab_width ?? 2, insertSpaces }
}

/** Testo dopo le regole di salvataggio sugli spazi; null se non cambia nulla. */
export function applyWhitespaceRules(text: string, trimTrailing: boolean, finalNewline: boolean | undefined): string | null {
  let next = trimTrailing ? text.replace(/[ \t]+(?=\r?\n|$)/g, '') : text
  if (finalNewline === true && next.length > 0 && !next.endsWith('\n')) next += text.includes('\r\n') ? '\r\n' : '\n'
  return next === text ? null : next
}

const diskConfigs = new Map<string, Promise<string>>()

async function readRootEditorConfig(sessionId: string): Promise<string> {
  try {
    const document = await openGoIDEDocument(sessionId, '.editorconfig')
    await closeGoIDEDocument(sessionId, document.document.id).catch(() => undefined)
    return document.content
  } catch {
    return ''
  }
}

/** Testo attuale di `.editorconfig`: il buffer aperto nell'editor (anche non salvato) oppure il disco. */
export async function editorConfigText(sessionId: string): Promise<string> {
  const open = useGoIDEStore.getState().documents.find((item) => item.document.sessionId === sessionId && item.document.relativePath === '.editorconfig')
  if (open) return open.buffer
  if (!diskConfigs.has(sessionId)) diskConfigs.set(sessionId, readRootEditorConfig(sessionId))
  return diskConfigs.get(sessionId) ?? ''
}

/** Dimentica la copia su disco (es. dopo il salvataggio di `.editorconfig`). */
export function forgetEditorConfig(sessionId: string): void {
  diskConfigs.delete(sessionId)
}

export function useEditorConfig(sessionId: string, relativePath: string): EditorConfigProperties {
  const openBuffer = useGoIDEStore((state) => state.documents.find((item) => item.document.sessionId === sessionId && item.document.relativePath === '.editorconfig')?.buffer)
  const [config, setConfig] = useState<EditorConfigProperties>({})
  useEffect(() => {
    let cancelled = false
    void editorConfigText(sessionId).then((text) => { if (!cancelled) setConfig(editorConfigFor(parseEditorConfig(text), relativePath)) })
    return () => { cancelled = true }
  }, [openBuffer, relativePath, sessionId])
  return config
}
