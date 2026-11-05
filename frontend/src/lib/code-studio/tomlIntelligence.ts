export interface TomlDiagnostic {
  line: number
  column: number
  message: string
}

const TOML_LOCATION = /line\s+(\d+),\s*column\s+(\d+)/i
const TOML_TABLES = ['package', 'workspace', 'dependencies', 'dev-dependencies', 'project', 'tool', 'build-system', 'profile', 'tool.poetry', 'tool.uv']

/** Taplo reports `TOML parse error at line N, column M`; keep the position, drop the source excerpt. */
export function tomlDiagnosticFromError(message: string): TomlDiagnostic | null {
  const match = TOML_LOCATION.exec(message)
  if (!match) return null
  const line = Number(match[1])
  const column = Number(match[2])
  if (!Number.isFinite(line) || !Number.isFinite(column) || line < 1 || column < 1) return null
  return { line, column, message: message.replace(/^TOML:\s*/i, '').split('\n')[0].trim() }
}

function tableAt(lines: string[], index: number): string {
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    const match = /^\s*\[([^\[\]]+)\]\s*$/.exec(lines[cursor])
    if (match) return match[1].trim()
  }
  return ''
}

/**
 * Local completions: table headers already in the file plus the usual manifests, and the keys
 * declared in the current table. Values suggest booleans. No network, no schema fetch.
 */
export function tomlCompletions(source: string, line: number, column: number): string[] {
  const lines = source.split('\n')
  const index = Math.max(0, Math.min(lines.length - 1, line - 1))
  const before = (lines[index] ?? '').slice(0, Math.max(0, column - 1))
  if (/^\s*\[[^\]]*$/.test(before)) {
    const existing = lines.join('\n').match(/^\s*\[([^\[\]]+)\]/gm)?.map((header) => header.trim().slice(1, -1).trim()) ?? []
    return [...new Set([...TOML_TABLES, ...existing])].filter((name) => name && !before.includes(`[${name}]`))
  }
  if (/=\s*[^#]*$/.test(before)) {
    return ['true', 'false', '""', '[]', '{}']
  }
  const table = tableAt(lines, index)
  const keys = new Set<string>(['name', 'version'])
  if (table) {
    const start = lines.findIndex((candidate, position) => position <= index && new RegExp(`^\\s*\\[${table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\s*$`).test(candidate))
    for (let cursor = Math.max(0, start + 1); cursor < index; cursor += 1) {
      const match = /^\s*([A-Za-z0-9_-]+)\s*=/.exec(lines[cursor])
      if (match) keys.add(match[1])
    }
  }
  const current = /^\s*([A-Za-z0-9_-]+)\s*=/.exec(before)
  if (current) keys.delete(current[1])
  return [...keys]
}
