import type { Taplo as TaploInstance } from '@taplo/lib'

let engine: Promise<TaploInstance> | undefined
export interface TomlFormatOptions { tabSize: number; insertSpaces: boolean; trailingNewline?: boolean }

/** Called in the worker; no project config discovery, filesystem access or remote schemas. */
export async function formatToml(source: string, options: TomlFormatOptions): Promise<string> {
  if (source.length > 2_000_000) throw new Error('TOML formatting is limited to 2,000,000 characters')
  if (!source.trim()) return source
  engine ??= import('@taplo/lib').then(({ Taplo }) => Taplo.initialize()).catch(error => { engine = undefined; throw error })
  const taplo = await engine
  // Parse before formatting; the decoded representation is never used to rewrite the document.
  try { taplo.decode(source, false) } catch (error) { throw new Error(`TOML: ${error instanceof Error ? error.message : String(error)}`, { cause: error }) }
  return taplo.format(source, { options: {
    indentString: options.insertSpaces ? ' '.repeat(Math.max(1, Math.min(8, options.tabSize))) : '\t',
    trailingNewline: options.trailingNewline ?? source.endsWith('\n'),
    crlf: source.includes('\r\n'), reorderKeys: false,
  }, config: { schema: { enabled: false } } })
}
