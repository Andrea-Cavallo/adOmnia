import type { languages } from 'monaco-editor'

export const TOML_LANGUAGE: languages.IMonarchLanguage = {
  tokenizer: {
    root: [
      [/#.*$/, 'comment'],
      [/^\s*\[\[?/, 'delimiter.square', '@table'],
      [/"""/, 'string', '@basicMultiline'],
      [/'''/, 'string', '@literalMultiline'],
      [/"/, 'string', '@basic'],
      [/'/, 'string', '@literal'],
      [/\b(true|false)\b/, 'keyword'],
      [/\b\d{4}-\d{2}-\d{2}([Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})?)?\b/, 'number.date'],
      [/[+-]?(0[xob][\da-fA-F_]+|\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d[\d_]*)?|inf|nan)\b/, 'number'],
      [/[\w-]+(?=\s*=)/, 'key'],
      [/[=,.]/, 'delimiter'],
      [/[\[\]{}]/, '@brackets'],
    ],
    table: [[/\]\]?/, 'delimiter.square', '@pop'], [/"([^"\\]|\\.)*"|'[^']*'/, 'type'], [/[^\]\r\n]+/, 'type'], [/$/, '', '@pop']],
    basic: [[/\\([btnfr"\\]|u[\da-fA-F]{4}|U[\da-fA-F]{8})/, 'string.escape'], [/[^"\\]+/, 'string'], [/"/, 'string', '@pop'], [/\\./, 'invalid']],
    literal: [[/[^']+/, 'string'], [/'/, 'string', '@pop']],
    basicMultiline: [[/"""/, 'string', '@pop'], [/\\./, 'string.escape'], [/[^"\\]+/, 'string'], [/"/, 'string']],
    literalMultiline: [[/'''/, 'string', '@pop'], [/[^']+/, 'string'], [/'/, 'string']],
  },
}
