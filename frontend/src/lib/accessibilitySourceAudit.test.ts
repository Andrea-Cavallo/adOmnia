import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const NON_SEMANTIC_TAGS = new Set(['article', 'div', 'label', 'li', 'p', 'section', 'span', 'td', 'tr'])

function tsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return tsxFiles(path)
    return entry.isFile() && entry.name.endsWith('.tsx') ? [path] : []
  })
}

function openingTags(source: string): Array<{ tag: string; text: string; line: number }> {
  const tags: Array<{ tag: string; text: string; line: number }> = []
  const matcher = /<(article|div|label|li|p|section|span|td|tr)\b/g
  let match: RegExpExecArray | null

  while ((match = matcher.exec(source))) {
    let braceDepth = 0
    let quote = ''
    let escaped = false
    let end = match.index + match[0].length

    for (; end < source.length; end += 1) {
      const character = source[end]
      if (escaped) { escaped = false; continue }
      if (quote && character === '\\') { escaped = true; continue }
      if (quote) { if (character === quote) quote = ''; continue }
      if (character === '"' || character === "'" || character === '`') { quote = character; continue }
      if (character === '{') { braceDepth += 1; continue }
      if (character === '}') { braceDepth -= 1; continue }
      if (character === '>' && braceDepth === 0) break
    }

    const text = source.slice(match.index, end + 1)
    tags.push({
      tag: match[1],
      text,
      line: source.slice(0, match.index).split('\n').length,
    })
    matcher.lastIndex = end + 1
  }

  return tags
}

describe('source accessibility audit', () => {
  it('does not introduce non-semantic click controls', () => {
    const sourceRoot = join(process.cwd(), 'src')
    const offenders: string[] = []

    for (const path of tsxFiles(sourceRoot)) {
      const source = readFileSync(path, 'utf8')
      for (const openingTag of openingTags(source)) {
        const isAccessibleControl = /\brole\s*=/.test(openingTag.text) && /\btabIndex\s*=/.test(openingTag.text)
        const isExplicitlyExempt = /\bdata-a11y-click-exempt(?:\s|=|>)/.test(openingTag.text)
        const isBackdrop = /\bclassName\s*=\s*["'][^"']*\bfixed\b[^"']*\binset-0\b/.test(openingTag.text)
        const isEventBoundary = /\bstopPropagation\s*\(/.test(openingTag.text)
        const isPresentationOnly = isExplicitlyExempt || isBackdrop || isEventBoundary
        const hasPointerActivation = /\bon(?:Click|DoubleClick|ContextMenu)\s*=/.test(openingTag.text)
        if (NON_SEMANTIC_TAGS.has(openingTag.tag) && hasPointerActivation && !isAccessibleControl && !isPresentationOnly) {
          offenders.push(`${relative(process.cwd(), path)}:${openingTag.line} <${openingTag.tag}>`)
        }
      }
    }

    expect(offenders, `Non-semantic pointer actions need role + tabIndex, or a presentation-only exemption:\n${offenders.join('\n')}`).toEqual([])
  })
})
