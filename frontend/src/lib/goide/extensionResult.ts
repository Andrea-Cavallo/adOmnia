export interface ExtensionDiagnostic { line: number; column: number; endLine: number; endColumn: number; severity: number; message: string }
export interface ExtensionResult { text?: string; message?: string; diagnostics: ExtensionDiagnostic[] }

/** Public API v1: a replacement of the current buffer and bounded, 1-based diagnostics. */
export function extensionResult(data: unknown): ExtensionResult {
 if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Extension must return an object')
 const value = data as Record<string,unknown>
 if (value.text !== undefined && (typeof value.text !== 'string' || new TextEncoder().encode(value.text).length > 1024*1024)) throw new Error('Invalid extension replacement text (max 1 MiB)')
 if (value.diagnostics !== undefined && !Array.isArray(value.diagnostics)) throw new Error('Extension diagnostics must be an array')
 const diagnostics = (value.diagnostics as unknown[] | undefined ?? []).slice(0,500).map(raw => {
  const item = raw as Record<string,unknown>
  if (!item || typeof item.message !== 'string' || typeof item.line !== 'number' || !Number.isInteger(item.line) || item.line < 1) throw new Error('Invalid extension diagnostic')
  const integer = (n: unknown, fallback: number) => typeof n === 'number' && Number.isInteger(n) && n >= 1 ? n : fallback
  const line = item.line, column = integer(item.column,1), endLine = Math.max(line,integer(item.endLine,line)), endColumn = Math.max(endLine === line ? column+1 : 1,integer(item.endColumn,column+1))
  return {line,column,endLine,endColumn,severity: typeof item.severity === 'number' && [1,2,3,4].includes(item.severity) ? item.severity : 2,message:item.message.slice(0,2000)}
 })
 return {text:value.text as string | undefined,message:typeof value.message === 'string' ? value.message.slice(0,4000) : undefined,diagnostics}
}
