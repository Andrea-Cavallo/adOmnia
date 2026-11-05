import { describe, expect, it } from 'vitest'
import { goSyntacticTokens } from './goSyntacticTokens'

const SOURCE = `package main

import (
	"fmt"
	alias "net/http"
)

// Ignored in a comment: func Nope() Fake
type Server struct {
	name string
	next *Server
	mux  *alias.ServeMux
	tags []Tag
}

type (
	Tag string
	ID  = int64
)

func (s *Server) Handle(w alias.ResponseWriter, r *alias.Request) error {
	text := "func Inside(x Y)"
	count := len(text) * 2
	value := *s
	list := []Tag{"a"}
	item := Tag("b")
	fmt.Println(text, count, value, list, item)
	return nil
}

func Generic[T any](input T) string { return "" }

func main() {
	s := Server{name: "x"}
	_ = s.next
	const raw = \`func Raw(a B)\`
}
`

function kindsOf(source: string): Record<string, string[]> {
  const lines = source.split('\n')
  const kinds: Record<string, string[]> = {}
  for (const token of goSyntacticTokens(source)) {
    const name = lines[token.line].slice(token.start, token.start + token.length)
    kinds[token.kind] = [...(kinds[token.kind] ?? []), name]
  }
  return kinds
}

describe('goSyntacticTokens', () => {
  const kinds = kindsOf(SOURCE)

  it('colours functions and calls, at their real positions', () => {
    expect(kinds.function).toEqual(expect.arrayContaining(['len', 'Generic', 'main']))
    const lines = SOURCE.split('\n')
    const generic = goSyntacticTokens(SOURCE).find((token) => lines[token.line].slice(token.start, token.start + token.length) === 'Generic')
    expect(generic).toMatchObject({ start: 5, length: 7, kind: 'function' })
  })

  it('colours methods, on declaration and on call', () => {
    expect(kinds.method).toEqual(expect.arrayContaining(['Handle', 'Println']))
  })

  it('colours types in every position gofmt writes them', () => {
    expect(kinds.type).toEqual(expect.arrayContaining(['Server', 'string', 'ServeMux', 'Tag', 'ID', 'ResponseWriter', 'Request', 'error', 'any', 'T']))
  })

  it('leaves comments, strings, dereferences and plain variables alone', () => {
    const all = Object.values(kinds).flat()
    for (const name of ['Nope', 'Fake', 'Inside', 'Y', 'Raw', 'B', 'text', 'count', 'value', 'nil', 'package', 'fmt']) {
      expect(all, name).not.toContain(name)
    }
    expect(kinds.type.filter((name) => name === 's')).toEqual([])
  })

  it('keeps the columns of UTF-16 text and handles CRLF', () => {
    const source = 'package p\r\n\r\nfunc Sì() { _ = "è"; Là() }\r\n'
    const tokens = goSyntacticTokens(source)
    expect(tokens.map((token) => [token.line, token.start, token.length, token.kind])).toEqual([[2, 5, 2, 'function'], [2, 21, 2, 'function']])
  })

  it('survives unterminated code while typing, and skips huge files', () => {
    expect(() => goSyntacticTokens('func broken( "unterminated\n/* open')).not.toThrow()
    expect(goSyntacticTokens(`func A() {}\n${' '.repeat(600 * 1024)}`)).toEqual([])
  })
})
