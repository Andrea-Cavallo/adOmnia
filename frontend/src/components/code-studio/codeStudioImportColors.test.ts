import { describe, expect, it } from 'vitest'
import { importColorRanges } from './codeStudioImportColors'
import { CLIENT_TOKEN_TYPES, remapSemanticTokens } from './codeStudioSemanticTokens'

function payloads(source: string, language: string) {
  return importColorRanges(source, language).map(r => source.split('\n')[r.line].slice(r.start, r.start + r.length))
}

describe('uniform import colors', () => {
  it('covers complete Go paths and ignores comments and ordinary strings', () => {
    const source = 'package main\nimport (\n "net/http" // "ignored"\n alias "path/filepath"\n /* "ignored" */\n)\nvar s = "ordinary"'
    expect(payloads(source, 'go')).toEqual(['"net/http"', '"path/filepath"'])
  })
  it('covers Java classes, static members and wildcard imports, including line breaks', () => {
    expect(payloads('import java.util.List;\nimport static java.util.Collections.emptyList;\nimport java.util.\n List;\nimport java.io.*;\nclass Example {}', 'java'))
      .toEqual(['java.util.List', 'java.util.Collections.emptyList', 'java.util.', 'List', 'java.io.*'])
  })
  it('covers Python aliases and parenthesized/backslash continuations without leaking into code', () => {
    const source = 'from pathlib import (\n Path,\n PurePath as P, # comment\n)\nimport os.path as path\nfrom os import path, \\\n sep\nvalue = Path()'
    expect(payloads(source, 'python')).toEqual(['pathlib', 'Path', 'PurePath', 'P', 'os.path', 'path', 'os', 'path', 'sep'])
  })
  it('ignores import-looking text inside multiline comments and strings', () => {
    expect(payloads('/*\nimport java.util.List;\n*/', 'java')).toEqual([])
    expect(payloads('"""\nfrom pathlib import Path\n"""', 'python')).toEqual([])
  })
  it('replaces the partial server token while preserving subsequent positions and colors', () => {
    const source = 'import "net/http"\nhttp.Get()'
    const output = remapSemanticTokens([0, 12, 4, 0, 0, 1, 0, 4, 0, 0], ['namespace'], [], { importRanges: importColorRanges(source, 'go') })
    expect([...output]).toEqual([0, 7, 10, CLIENT_TOKEN_TYPES.indexOf('string'), 0, 1, 0, 4, CLIENT_TOKEN_TYPES.indexOf('namespace'), 0])
  })
})
