import { monaco } from '@/lib/monacoSetup'
import { TOML_LANGUAGE } from './codeStudioTomlLanguage'
import { tomlOutline } from '@/lib/code-studio/tomlOutline'

let registered = false

/** go.sum: percorso del modulo, versione (eventualmente /go.mod) e hash h1:. Solo colorazione. */
const GO_SUM: monaco.languages.IMonarchLanguage = {
  tokenizer: {
    root: [
      [/^\S+/, 'type'],
      [/v\d+\.\d+\.\d+[^\s/]*/, 'number'],
      [/\/go\.mod/, 'keyword'],
      [/h1:[A-Za-z0-9+/=]+/, 'string'],
    ],
  },
}

/**
 * Assembly Plan9 di Go (file .s): direttive, registri, simboli ·nome(SB), costanti $ e commenti.
 * Nessuna funzione semantica: gopls non analizza l'assembly.
 */
const GO_ASM: monaco.languages.IMonarchLanguage = {
  directives: ['TEXT', 'DATA', 'GLOBL', 'FUNCDATA', 'PCDATA', 'NOSPLIT', 'RODATA', 'NOPTR', 'WRAPPER', 'NEEDCTXT', 'TOPFRAME', 'DUPOK'],
  tokenizer: {
    root: [
      [/\/\/[^\n]*/, 'comment'],
      [/\/\*/, 'comment', '@comment'],
      [/^\s*#\s*(include|define|ifdef|ifndef|else|endif|undef)\b/, 'keyword'],
      [/"[^"]*"/, 'string'],
      [/(?<!<)<[^>]+>/, 'string'],
      [/\$-?(0x[0-9A-Fa-f]+|\d+)/, 'number'],
      [/\b(0x[0-9A-Fa-f]+|\d+)(?![0-9A-Za-z_])/, 'number'],
      [/\b(R\d+|X\d+|Y\d+|Z\d+|F\d+|V\d+|[A-D]X|[SD]I|[SB]P|FP|SB|PC|LR|CTR|g)(?![0-9A-Za-z_])/, 'variable.predefined'],
      [/(?<![·\w])[·\w]+(?=\()/, 'entity.name.function'],
      [/^[A-Za-z_][\w]*:/, 'tag'],
      [/\b[A-Z][A-Z0-9_.]*\b/, { cases: { '@directives': 'keyword', '@default': 'keyword.operator' } }],
    ],
    comment: [
      [/\*\//, 'comment', '@pop'],
      [/./, 'comment'],
    ],
  },
}

/** Makefile: Monaco non lo include. Target, variabili, direttive, ricette e commenti; solo colorazione. */
const MAKEFILE: monaco.languages.IMonarchLanguage = {
  tokenizer: {
    root: [
      [/#[^\n]*/, 'comment'],
      [/^\s*(-?include|sinclude|ifeq|ifneq|ifdef|ifndef|else|endif|define|endef|export|unexport|override|vpath)(?=\s|$)/, 'keyword'],
      [/^\.[A-Z_]+(?=\s*:)/, 'keyword'],
      // Target e variabili partono da colonna 0: le righe di ricetta (tab) non li imitano.
      [/^[^\s:=#][^:=#]*(?=:(?!=))/, 'entity.name.function'],
      [/^[A-Za-z_][\w.]*(?=\s*[?:+!]?=)/, 'variable'],
      [/\$[({][^)}]*[)}]|\$[@<^?*%+|]|\$\$\w*/, 'variable.predefined'],
      [/"[^"]*"|'[^']*'/, 'string'],
      [/[:?+!]?=|::?/, 'operator'],
    ],
  },
}

/** .http / .rest request files: method and URL, headers, {{variables}}, ### separators and comments. */
const HTTP_FILE: monaco.languages.IMonarchLanguage = {
  tokenizer: {
    root: [
      [/^\s*###.*$/, 'comment.doc'],
      [/^\s*(#|\/\/).*$/, 'comment'],
      [/^(GET|QUERY|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)(?=\s)/i, 'keyword'],
      [/\{\{[^}]*\}\}/, 'variable'],
      [/^[\w-]+(?=:\s)/, 'type'],
      [/HTTP\/[\d.]+/, 'keyword'],
      [/https?:\/\/[^\s{]+/, 'string'],
    ],
  },
}

/** Registra una sola volta i linguaggi di supporto di Code Studio. */
export function registerCodeStudioExtraLanguages(): void {
  if (registered) return
  registered = true
  monaco.languages.register({ id: 'toml', extensions: ['.toml'], filenames: ['Cargo.lock', 'poetry.lock', 'uv.lock'] })
  monaco.languages.setMonarchTokensProvider('toml', TOML_LANGUAGE)
  monaco.languages.setLanguageConfiguration('toml', { comments: { lineComment: '#' }, brackets: [['[', ']'], ['{', '}']], autoClosingPairs: [{ open: '[', close: ']' }, { open: '{', close: '}' }, { open: '"', close: '"' }, { open: "'", close: "'" }] })
  monaco.languages.registerDocumentSymbolProvider('toml', { provideDocumentSymbols: model => tomlOutline(model.getValue()).map(node => toMonacoSymbol(node)) })
  monaco.languages.registerDocumentFormattingEditProvider('toml', {
    async provideDocumentFormattingEdits(model, options, token) {
      const controller = new AbortController()
      const off = token.onCancellationRequested(() => controller.abort())
      const version = model.getVersionId(), source = model.getValue()
      try {
        if (token.isCancellationRequested) return []
        const { formatTomlInWorker } = await import('@/lib/code-studio/tomlFormatterClient')
        const text = await formatTomlInWorker(source, options, controller.signal)
        if (model.isDisposed() || token.isCancellationRequested || model.getVersionId() !== version || text === source) return []
        return [{ range: model.getFullModelRange(), text }]
      } catch (error) {
        if (!token.isCancellationRequested) {
          const { useCodeStudioLspStore } = await import('@/stores/codeStudioLsp')
          useCodeStudioLspStore.setState({ message: error instanceof Error ? error.message : String(error) })
        }
        return []
      } finally { off.dispose() }
    },
  })
  monaco.languages.register({ id: 'gosum', filenames: ['go.sum', 'go.work.sum'] })
  monaco.languages.setMonarchTokensProvider('gosum', GO_SUM)
  monaco.languages.register({ id: 'goasm', extensions: ['.s'] })
  monaco.languages.setMonarchTokensProvider('goasm', GO_ASM)
  monaco.languages.setLanguageConfiguration('goasm', { comments: { lineComment: '//', blockComment: ['/*', '*/'] } })
  // Monaco has no grammar for these: colours come from the language server's semantic tokens.
  monaco.languages.register({ id: 'haskell', extensions: ['.hs'] })
  monaco.languages.setLanguageConfiguration('haskell', { comments: { lineComment: '--', blockComment: ['{-', '-}'] } })
  monaco.languages.register({ id: 'zig', extensions: ['.zig', '.zon'] })
  monaco.languages.setLanguageConfiguration('zig', { comments: { lineComment: '//' } })
  monaco.languages.register({ id: 'http', extensions: ['.http', '.rest'] })
  monaco.languages.setMonarchTokensProvider('http', HTTP_FILE)
  monaco.languages.setLanguageConfiguration('http', { comments: { lineComment: '#' } })
  monaco.languages.register({ id: 'makefile', filenames: ['Makefile', 'makefile', 'GNUmakefile'], extensions: ['.mk'] })
  monaco.languages.setMonarchTokensProvider('makefile', MAKEFILE)
  monaco.languages.setLanguageConfiguration('makefile', { comments: { lineComment: '#' } })
  // Declared languages without a Monaco grammar: colours come from the language server's semantic tokens.
  monaco.languages.register({ id: 'nix', extensions: ['.nix'] })
  monaco.languages.setLanguageConfiguration('nix', { comments: { lineComment: '#', blockComment: ['/*', '*/'] }, brackets: [['{', '}'], ['[', ']'], ['(', ')']] })
  monaco.languages.register({ id: 'latex', extensions: ['.tex', '.ltx', '.sty', '.cls', '.dtx', '.ins', '.bbx', '.cbx'] })
  monaco.languages.setLanguageConfiguration('latex', { comments: { lineComment: '%' }, brackets: [['{', '}'], ['[', ']'], ['(', ')']] })
  monaco.languages.register({ id: 'ocaml', extensions: ['.ml', '.mll', '.mly'] })
  monaco.languages.setLanguageConfiguration('ocaml', { comments: { blockComment: ['(*', '*)'] }, brackets: [['(', ')'], ['[', ']'], ['{', '}']] })
  monaco.languages.register({ id: 'erlang', extensions: ['.erl', '.hrl', '.escript'] })
  monaco.languages.setLanguageConfiguration('erlang', { comments: { lineComment: '%' } })
  monaco.languages.register({ id: 'groovy', extensions: ['.groovy', '.gradle', '.gvy', '.gy', '.gsh'], filenames: ['Jenkinsfile'] })
  monaco.languages.setLanguageConfiguration('groovy', { comments: { lineComment: '//', blockComment: ['/*', '*/'] }, brackets: [['{', '}'], ['[', ']'], ['(', ')']] })
  monaco.languages.register({ id: 'cmake', extensions: ['.cmake'], filenames: ['CMakeLists.txt', 'CMakeCache.txt'] })
  monaco.languages.setLanguageConfiguration('cmake', { comments: { lineComment: '#', blockComment: ['#[[', ']]'] }, brackets: [['(', ')']] })
  monaco.languages.register({ id: 'vue', extensions: ['.vue'] })
  monaco.languages.setLanguageConfiguration('vue', { comments: { blockComment: ['<!--', '-->'] } })
  monaco.languages.register({ id: 'svelte', extensions: ['.svelte'] })
  monaco.languages.setLanguageConfiguration('svelte', { comments: { blockComment: ['<!--', '-->'] } })
}

function toMonacoSymbol(node: import('@/lib/code-studio-lsp-api').GoIDESymbolNode): monaco.languages.DocumentSymbol {
  const convert = (value: typeof node.range) => ({ startLineNumber: value.startLine, startColumn: value.startColumn, endLineNumber: value.endLine, endColumn: value.endColumn })
  return { name: node.name, detail: '', kind: node.kind - 1, tags: [], range: convert(node.range), selectionRange: convert(node.selectionRange), children: node.children?.map(toMonacoSymbol) }
}

const GENERATED_HEADER = /^\/\/ Code generated .* DO NOT EDIT\.$/m
const GENERATED_SCAN_CHARS = 4096

/** Convenzione Go (go help generate): un file con questa riga all'inizio è generato e non va modificato a mano. */
export function isGeneratedGoFile(relativePath: string, text: string): boolean {
  return relativePath.endsWith('.go') && GENERATED_HEADER.test(text.slice(0, GENERATED_SCAN_CHARS))
}
