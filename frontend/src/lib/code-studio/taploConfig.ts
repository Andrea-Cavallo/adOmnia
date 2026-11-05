import type { TomlFormatOptions } from './tomlFormat'

export interface TaploFormatting {
  indentString?: string
  trailingNewline?: boolean
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\t/g, '\t').replace(/\\n/g, '\n')
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

/**
 * Reads the [formatting] section of a .taplo.toml. Only the options our WASM formatter can honour
 * are returned; schema rules and unsupported keys are ignored, never guessed.
 */
export function parseTaploFormatting(text: string): TaploFormatting {
  const formatting: TaploFormatting = {}
  let section = ''
  for (const raw of text.slice(0, 64_000).split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const header = /^\[([^\]]+)\]$/.exec(line)
    if (header) {
      section = header[1].trim()
      continue
    }
    if (section !== 'formatting') continue
    const pair = /^([A-Za-z0-9_-]+)\s*=\s*(.+?)(?:\s+#.*)?$/.exec(line)
    if (!pair) continue
    if (pair[1] === 'indent_string') formatting.indentString = unquote(pair[2])
    if (pair[1] === 'trailing_newline') formatting.trailingNewline = unquote(pair[2]) === 'true'
  }
  return formatting
}

/** Project options override the editor defaults, as .taplo.toml is meant to be shared by the project. */
export function taploFormatOptions(fallback: TomlFormatOptions, text: string): TomlFormatOptions {
  const formatting = parseTaploFormatting(text)
  const options = { ...fallback }
  if (formatting.indentString !== undefined && formatting.indentString !== '') {
    if (formatting.indentString === '\t') {
      options.insertSpaces = false
      options.tabSize = 1
    } else {
      options.insertSpaces = true
      options.tabSize = Math.max(1, Math.min(8, formatting.indentString.length))
    }
  }
  if (formatting.trailingNewline !== undefined) options.trailingNewline = formatting.trailingNewline
  return options
}
