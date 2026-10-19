import { monaco } from '@/lib/monacoSetup'

/**
 * Emmet per HTML, CSS e JSX/TSX: un suggerimento "Emmet Abbreviation" quando il testo prima del
 * cursore è un'abbreviazione che si espande. La libreria si carica alla prima richiesta, così non pesa
 * sull'avvio. Il language server HTML standard non include Emmet (che è un'estensione a parte).
 */

type EmmetModule = typeof import('emmet')

let loading: Promise<EmmetModule> | null = null
let registered = false

const load = (): Promise<EmmetModule> => (loading ??= import('emmet'))

const FIELD_OPEN = '\u0001'
const FIELD_CLOSE = '\u0002'
const FIELD_SEPARATOR = '\u0003'

/** Testo letterale reso sicuro per uno snippet Monaco: `\`, `$` e `}` hanno significato speciale. */
const escapeSnippet = (text: string) => text.replace(/[\\$}]/g, (character) => `\\${character}`)

/** Converte l'output di Emmet (campi marcati) in uno snippet Monaco con tabstop e segnaposto. */
export function toSnippet(expanded: string): string {
  const fields = new RegExp(`${FIELD_OPEN}(\\d+)${FIELD_SEPARATOR}([^${FIELD_CLOSE}]*)${FIELD_CLOSE}`, 'g')
  let snippet = ''
  let last = 0
  for (const match of expanded.matchAll(fields)) {
    snippet += escapeSnippet(expanded.slice(last, match.index))
    const [, index, placeholder] = match
    snippet += placeholder ? `\${${index}:${escapeSnippet(placeholder)}}` : `\${${index}}`
    last = match.index + match[0].length
  }
  return snippet + escapeSnippet(expanded.slice(last)) + '$0'
}

export const fieldRenderer = (index: number, placeholder: string) => `${FIELD_OPEN}${index}${FIELD_SEPARATOR}${placeholder}${FIELD_CLOSE}`

/** Dentro un tag aperto, in <style> o <script> non è markup: niente suggerimento. */
export function isMarkupPosition(textBefore: string): boolean {
  const lastOpen = textBefore.lastIndexOf('<')
  if (lastOpen > textBefore.lastIndexOf('>')) return false
  const lower = textBefore.toLowerCase()
  for (const tag of ['style', 'script']) {
    if (lower.lastIndexOf(`<${tag}`) > lower.lastIndexOf(`</${tag}`)) return false
  }
  return true
}

const STRUCTURE = /[.#>+*[\]{}()@^]/

interface Context {
  syntax: 'html' | 'jsx' | 'css'
  /** Richiede che l'abbreviazione abbia una struttura: una parola sola in un file JS è quasi sempre codice. */
  needsStructure: boolean
}

function contextFor(model: monaco.editor.ITextModel): Context | null {
  const language = model.getLanguageId()
  const path = model.uri.path.toLowerCase()
  if (language === 'html') return { syntax: 'html', needsStructure: false }
  if (language === 'css' || language === 'scss' || language === 'less') return { syntax: 'css', needsStructure: true }
  if ((language === 'javascript' || language === 'typescript') && /\.(jsx|tsx)$/.test(path)) return { syntax: 'jsx', needsStructure: true }
  return null
}

async function provide(model: monaco.editor.ITextModel, position: monaco.Position): Promise<monaco.languages.CompletionList> {
  const none = { suggestions: [] }
  const context = contextFor(model)
  if (!context) return none
  const before = model.getValueInRange({ startLineNumber: 1, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column })
  if (context.syntax !== 'css' && !isMarkupPosition(before)) return none
  const line = model.getLineContent(position.lineNumber).slice(0, position.column - 1)
  const emmet = await load()
  const extracted = emmet.extract(line, line.length, { type: context.syntax === 'css' ? 'stylesheet' : 'markup', lookAhead: false })
  if (!extracted) return none
  const abbreviation = extracted.abbreviation
  if (context.needsStructure && context.syntax === 'jsx' && !STRUCTURE.test(abbreviation)) return none
  if (context.syntax === 'css' && !/[\d#!-]/.test(abbreviation)) return none
  let expanded: string
  try {
    expanded = emmet.default(abbreviation, context.syntax === 'css'
      ? { type: 'stylesheet', syntax: model.getLanguageId() === 'css' ? 'css' : model.getLanguageId(), options: { 'output.field': fieldRenderer } }
      : { type: 'markup', syntax: context.syntax, options: { 'output.field': fieldRenderer, 'output.indent': '  ', 'jsx.enabled': context.syntax === 'jsx', 'output.selfClosingStyle': context.syntax === 'jsx' ? 'xhtml' : 'html' } })
  } catch {
    return none
  }
  const plain = expanded.replace(new RegExp(`${FIELD_OPEN}\\d+${FIELD_SEPARATOR}([^${FIELD_CLOSE}]*)${FIELD_CLOSE}`, 'g'), '$1')
  if (!plain || plain.trim() === abbreviation) return none
  const range = new monaco.Range(position.lineNumber, extracted.start + 1, position.lineNumber, position.column)
  return {
    suggestions: [{
      label: { label: abbreviation, description: 'Emmet' },
      kind: monaco.languages.CompletionItemKind.Snippet,
      detail: 'Emmet Abbreviation',
      documentation: { value: `\`\`\`${context.syntax === 'css' ? 'css' : 'html'}\n${plain}\n\`\`\`` },
      insertText: toSnippet(expanded),
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      range,
      // Prima degli altri suggerimenti: chi scrive "ul>li*3" vuole l'espansione, non una parola.
      sortText: '\u0000',
      preselect: true,
    }],
  }
}

/** Registra il provider una sola volta; la libreria Emmet si carica alla prima richiesta. */
export function registerEmmet(): void {
  if (registered) return
  registered = true
  for (const language of ['html', 'css', 'scss', 'less', 'javascript', 'typescript']) {
    monaco.languages.registerCompletionItemProvider(language, {
      triggerCharacters: ['>', '+', '*', ']', ')', '}', '.', '#', '!'],
      provideCompletionItems: provide,
    })
  }
}
