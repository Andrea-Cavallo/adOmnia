/** Un tool Go installabile con go install ed eseguibile dalla Run console. */
export interface GoStudioExtraTool {
  binary: string
  /** Modulo per go install, con versione; vuoto per un tool già nel PATH che adOmnia non installa. */
  module: string
  purpose: string
  defaultArgs: string
  custom?: boolean
}

export const BUILTIN_EXTRA_TOOLS: readonly GoStudioExtraTool[] = [
  { binary: 'govulncheck', module: 'golang.org/x/vuln/cmd/govulncheck@latest', purpose: 'Known vulnerabilities your code actually calls', defaultArgs: './...' },
  { binary: 'goimports', module: 'golang.org/x/tools/cmd/goimports@latest', purpose: 'Fix imports and format files', defaultArgs: '-l -w .' },
  { binary: 'mockgen', module: 'go.uber.org/mock/mockgen@latest', purpose: 'Mocks from interfaces', defaultArgs: '-source=service.go -destination=mocks/service_mock.go -package=mocks' },
  { binary: 'stringer', module: 'golang.org/x/tools/cmd/stringer@latest', purpose: 'String() for enum constants', defaultArgs: '-type=Color' },
]

const KEY = 'adomnia.goide.customTools'
const BINARY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const MODULE = /^[A-Za-z0-9][A-Za-z0-9._~/-]{2,199}@[A-Za-z0-9._+-]{1,64}$/

export function readCustomTools(): GoStudioExtraTool[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(parsed) ? (parsed as GoStudioExtraTool[]).filter((tool) => tool && BINARY.test(tool.binary)).map((tool) => ({ ...tool, custom: true })) : []
  } catch {
    return []
  }
}

/** Valida e salva un tool dell'utente; restituisce un messaggio d'errore o null. */
export function addCustomTool(tool: Omit<GoStudioExtraTool, 'custom'>): string | null {
  if (!BINARY.test(tool.binary)) return 'Binary name: letters, digits, dot, dash, underscore.'
  if (tool.module && !MODULE.test(tool.module)) return 'Module: import path@version, for example github.com/air-verse/air@latest.'
  const all = readCustomTools()
  if ([...BUILTIN_EXTRA_TOOLS, ...all].some((existing) => existing.binary === tool.binary)) return `${tool.binary} is already in the list.`
  try { localStorage.setItem(KEY, JSON.stringify([...all, tool])) } catch { return 'Could not save the tool on this machine.' }
  return null
}

export function removeCustomTool(binary: string): void {
  try { localStorage.setItem(KEY, JSON.stringify(readCustomTools().filter((tool) => tool.binary !== binary))) } catch { /* solo locale */ }
}

/** Argomenti come li scriverebbe una shell, con le virgolette per gli spazi; nessuna shell li interpreta. */
export function splitArguments(text: string): string[] {
  const result: string[] = []
  let current = ''
  let quote: string | null = null
  let started = false
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = null
      else current += char
    } else if (char === '"' || char === "'") {
      quote = char
      started = true
    } else if (/\s/.test(char)) {
      if (started) result.push(current)
      current = ''
      started = false
    } else {
      current += char
      started = true
    }
  }
  if (started) result.push(current)
  return result
}
