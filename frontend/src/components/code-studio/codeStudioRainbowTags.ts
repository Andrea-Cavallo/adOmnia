import { useEffect } from 'react'
import type { monaco } from '@/lib/monacoSetup'

export interface RainbowTagRange { start: number; end: number; level: number }
const VOID_TAGS = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '))

/** Offsets use UTF-16, like Monaco; attributes and embedded code keep their syntax colors. */
export function rainbowTagRanges(text: string, html: boolean): RainbowTagRange[] {
  if (text.length > 1_000_000) return []
  const result: RainbowTagRange[] = []
  const stack: { name: string; level: number }[] = []
  const tokens = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<\?[\s\S]*?(?:\?>|$)|<!DOCTYPE(?:[^>"'\[]|"[^"]*"|'[^']*'|\[[^\]]*\])*>|<\/?([A-Za-z_][\w:.-]*)(?=[\s/>])(?:[^>"']|"[^"]*"|'[^']*')*>/gi
  let raw: string | null = null
  for (const token of text.matchAll(tokens)) {
    if (!token[1]) continue
    const name = html ? token[1].toLowerCase() : token[1]
    const closing = token[0].startsWith('</')
    if (raw && !(closing && name === raw)) continue
    raw = null
    let level = stack.length
    if (closing) {
      const index = stack.map((entry) => entry.name).lastIndexOf(name)
      if (index < 0) continue
      level = stack[index].level
      stack.length = index
    }
    const start = token.index! + (closing ? 2 : 1)
    result.push({ start, end: start + token[1].length, level })
    if (!closing && !/\/\s*>$/.test(token[0]) && !(html && VOID_TAGS.has(name))) {
      stack.push({ name, level })
      if (html && ['script', 'style', 'textarea', 'title'].includes(name)) raw = name
    }
  }
  return result
}

export function useCodeStudioRainbowTags(editor: monaco.editor.IStandaloneCodeEditor | null): void {
  useEffect(() => {
    if (!editor) return
    const collection = editor.createDecorationsCollection()
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      collection.clear()
      clearTimeout(timer)
      timer = setTimeout(() => {
        const model = editor.getModel()
        if (!model || !['html', 'xml'].includes(model.getLanguageId())) return
        collection.set(rainbowTagRanges(model.getValue(), model.getLanguageId() === 'html').map((tag) => {
          const start = model.getPositionAt(tag.start)
          const end = model.getPositionAt(tag.end)
          return {
            range: { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column },
            options: { inlineClassName: `code-studio-rainbow-tag-${tag.level % 6}`, stickiness: 1 },
          }
        }))
      }, 150)
    }
    const subscriptions = [editor.onDidChangeModel(refresh), editor.onDidChangeModelLanguage(refresh), editor.onDidChangeModelContent(refresh)]
    refresh()
    return () => {
      clearTimeout(timer)
      subscriptions.forEach((subscription) => subscription.dispose())
      collection.clear()
    }
  }, [editor])
}
