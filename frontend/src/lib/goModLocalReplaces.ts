/**
 * Replace locali in go.mod: quando si aggiunge `replace M => ../path` per sviluppare insieme a una
 * copia locale, un altro replace dello stesso modulo (quello "vero", verso un fork o una versione)
 * va spento, perché Go rifiuta due replace per lo stesso modulo. Lo si commenta con un marcatore e
 * lo si riattiva da solo quando il replace locale sparisce. Nessun altro testo viene toccato.
 */

const DISABLED_MARKER = '// adomnia-off: '

export interface GoModReplace {
  line: number
  module: string
  target: string
  local: boolean
  disabled: boolean
}

interface ParsedLine extends GoModReplace {
  indent: string
  body: string
}

const SINGLE = /^replace\s+(\S+)(?:\s+\S+)?\s*=>\s*(\S+)/
const BLOCK_ENTRY = /^(\S+)(?:\s+\S+)?\s*=>\s*(\S+)/

/** Un target è locale se è un percorso (./, ../, assoluto Unix o Windows), come per modfile.IsDirectoryPath. */
export function isLocalReplaceTarget(target: string): boolean {
  return /^(\.{1,2}[\\/]|\/|[A-Za-z]:[\\/]|\\\\)/.test(target) || target === '.' || target === '..'
}

function parse(lines: string[]): ParsedLine[] {
  const result: ParsedLine[] = []
  let inBlock = false
  lines.forEach((raw, index) => {
    const indent = raw.match(/^\s*/)?.[0] ?? ''
    let text = raw.trim()
    if (!inBlock && /^replace\s*\(\s*(\/\/.*)?$/.test(text)) { inBlock = true; return }
    if (inBlock && text.startsWith(')')) { inBlock = false; return }
    const disabled = text.startsWith(DISABLED_MARKER)
    if (disabled) text = text.slice(DISABLED_MARKER.length)
    else if (text.startsWith('//')) return
    const match = (inBlock ? BLOCK_ENTRY : SINGLE).exec(text)
    if (!match) return
    result.push({ line: index, module: match[1], target: match[2], local: isLocalReplaceTarget(match[2]), disabled, indent, body: text })
  })
  return result
}

/** Elenca i replace di go.mod, compresi quelli spenti da adOmnia. */
export function goModReplaces(text: string): GoModReplace[] {
  return parse(text.split(/\r?\n/)).map(({ line, module, target, local, disabled }) => ({ line, module, target, local, disabled }))
}

/** Restituisce il testo con i replace "veri" spenti o riattivati in base ai replace locali attivi. */
export function syncLocalReplaces(text: string): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const entries = parse(lines)
  const localModules = new Set(entries.filter((entry) => entry.local && !entry.disabled).map((entry) => entry.module))
  let changed = false
  for (const entry of entries) {
    if (entry.local) continue
    if (!entry.disabled && localModules.has(entry.module)) {
      lines[entry.line] = `${entry.indent}${DISABLED_MARKER}${entry.body}`
      changed = true
    } else if (entry.disabled && !localModules.has(entry.module)) {
      lines[entry.line] = `${entry.indent}${entry.body}`
      changed = true
    }
  }
  return changed ? lines.join(eol) : text
}

/** Replace locali attivi: da non pubblicare, perché altrove quei percorsi non esistono. */
export function activeLocalReplaces(text: string): GoModReplace[] {
  return goModReplaces(text).filter((entry) => entry.local && !entry.disabled)
}

export function isGoModPath(relativePath: string): boolean {
  return relativePath === 'go.mod' || relativePath.endsWith('/go.mod')
}
