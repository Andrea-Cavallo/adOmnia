import { monaco } from '@/lib/monacoSetup'

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
      [/\/\/.*$/, 'comment'],
      [/\/\*/, 'comment', '@comment'],
      [/^\s*#\s*(include|define|ifdef|ifndef|else|endif|undef)\b/, 'keyword'],
      [/"[^"]*"/, 'string'],
      [/<[^>]+>/, 'string'],
      [/\$-?(0x[0-9A-Fa-f]+|\d+)/, 'number'],
      [/\b(0x[0-9A-Fa-f]+|\d+)\b/, 'number'],
      [/\b(R\d+|X\d+|Y\d+|Z\d+|F\d+|V\d+|[A-D]X|[SD]I|[SB]P|R(8|9|1[0-5])|SP|FP|SB|PC|LR|CTR|g)\b/, 'variable.predefined'],
      [/[·\w]+(?=\()/, 'entity.name.function'],
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
      [/#.*$/, 'comment'],
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

/** Registra una sola volta i linguaggi di supporto di Go Studio. */
export function registerGoStudioExtraLanguages(): void {
  if (registered) return
  registered = true
  monaco.languages.register({ id: 'gosum', filenames: ['go.sum', 'go.work.sum'] })
  monaco.languages.setMonarchTokensProvider('gosum', GO_SUM)
  monaco.languages.register({ id: 'goasm', extensions: ['.s'] })
  monaco.languages.setMonarchTokensProvider('goasm', GO_ASM)
  monaco.languages.setLanguageConfiguration('goasm', { comments: { lineComment: '//', blockComment: ['/*', '*/'] } })
  monaco.languages.register({ id: 'makefile', filenames: ['Makefile', 'makefile', 'GNUmakefile'], extensions: ['.mk'] })
  monaco.languages.setMonarchTokensProvider('makefile', MAKEFILE)
  monaco.languages.setLanguageConfiguration('makefile', { comments: { lineComment: '#' } })
}

const GENERATED_HEADER = /^\/\/ Code generated .* DO NOT EDIT\.$/m
const GENERATED_SCAN_CHARS = 4096

/** Convenzione Go (go help generate): un file con questa riga all'inizio è generato e non va modificato a mano. */
export function isGeneratedGoFile(relativePath: string, text: string): boolean {
  return relativePath.endsWith('.go') && GENERATED_HEADER.test(text.slice(0, GENERATED_SCAN_CHARS))
}
