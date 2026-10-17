import { useCallback, useState } from 'react'

export type CodeStudioMarkdownMode = 'editor' | 'split' | 'preview'

export const DEFAULT_MARKDOWN_MODE: CodeStudioMarkdownMode = 'preview'
const STORAGE_KEY = 'adomnia.codeStudio.markdownModes'
const MODES: readonly string[] = ['editor', 'split', 'preview']

function readAll(): Record<string, CodeStudioMarkdownMode> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    if (!parsed || typeof parsed !== 'object') return {}
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, CodeStudioMarkdownMode] => typeof entry[1] === 'string' && MODES.includes(entry[1])))
  } catch {
    return {}
  }
}

/** Modo salvato per un documento ("sessione:percorso"), altrimenti l'anteprima: un .md si legge prima di modificarlo. */
export function loadMarkdownMode(key: string): CodeStudioMarkdownMode {
  return readAll()[key] ?? DEFAULT_MARKDOWN_MODE
}

export function saveMarkdownMode(key: string, mode: CodeStudioMarkdownMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readAll(), [key]: mode }))
  } catch {
    // Storage non disponibile: il modo vale per questa sessione.
  }
}

/** Modo Markdown di un documento, persistito tra riaperture. */
export function useMarkdownMode(key: string): [CodeStudioMarkdownMode, (mode: CodeStudioMarkdownMode) => void] {
  const [modes, setModes] = useState<Record<string, CodeStudioMarkdownMode>>({})
  const mode = modes[key] ?? loadMarkdownMode(key)
  const change = useCallback((next: CodeStudioMarkdownMode) => {
    saveMarkdownMode(key, next)
    setModes((current) => ({ ...current, [key]: next }))
  }, [key])
  return [mode, change]
}

export function isMermaidPath(path: string): boolean {
  return /\.(mmd|mermaid)$/i.test(path)
}

/** Un file .mmd si mostra come un blocco ```mermaid del Markdown: stesso renderer, tema e gestione degli errori. */
export function mermaidAsMarkdown(source: string): string {
  const fence = source.includes('```') ? '~~~~' : '```'
  return `${fence}mermaid\n${source}\n${fence}\n`
}
