package lsp

import (
	"fmt"
	"sort"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

// OffsetForPosition converte una posizione LSP (UTF-16) nell'offset in byte del testo.
// Riconosce \n, \r\n e \r come terminatori di riga; una colonna oltre la fine riga viene limitata alla riga.
func OffsetForPosition(text string, position Position) (int, error) {
	if position.Line < 0 || position.Character < 0 {
		return 0, fmt.Errorf("posizione negativa non valida")
	}
	offset := 0
	for line := 0; line < position.Line; line++ {
		next, ok := nextLineStart(text, offset)
		if !ok {
			return 0, fmt.Errorf("riga %d oltre la fine del documento", position.Line)
		}
		offset = next
	}
	units := 0
	for offset < len(text) && units < position.Character {
		character, size := utf8.DecodeRuneInString(text[offset:])
		if character == '\n' || character == '\r' {
			break
		}
		units += utf16.RuneLen(character)
		offset += size
	}
	return offset, nil
}

func nextLineStart(text string, offset int) (int, bool) {
	for index := offset; index < len(text); index++ {
		switch text[index] {
		case '\n':
			return index + 1, true
		case '\r':
			if index+1 < len(text) && text[index+1] == '\n' {
				return index + 2, true
			}
			return index + 1, true
		}
	}
	return 0, false
}

// LineText restituisce il testo della riga indicata (zero-based) senza terminatore.
func LineText(text string, line int) string {
	start, err := OffsetForPosition(text, Position{Line: line})
	if err != nil {
		return ""
	}
	end := start
	for end < len(text) && text[end] != '\n' && text[end] != '\r' {
		end++
	}
	return text[start:end]
}

// ApplyEdits applica edit non sovrapposti in modo atomico: in caso di errore il testo originale resta invariato.
func ApplyEdits(text string, edits []TextEdit) (string, error) {
	type span struct {
		start, end int
		newText    string
		order      int
	}
	spans := make([]span, 0, len(edits))
	for index, edit := range edits {
		start, err := OffsetForPosition(text, edit.Range.Start)
		if err != nil {
			return "", err
		}
		end, err := OffsetForPosition(text, edit.Range.End)
		if err != nil {
			return "", err
		}
		if end < start {
			return "", fmt.Errorf("intervallo di modifica invertito")
		}
		spans = append(spans, span{start: start, end: end, newText: edit.NewText, order: index})
	}
	sort.SliceStable(spans, func(left, right int) bool {
		if spans[left].start != spans[right].start {
			return spans[left].start < spans[right].start
		}
		return spans[left].order < spans[right].order
	})
	var builder strings.Builder
	builder.Grow(len(text))
	cursor := 0
	for _, current := range spans {
		if current.start < cursor {
			return "", fmt.Errorf("modifiche sovrapposte non applicabili")
		}
		builder.WriteString(text[cursor:current.start])
		builder.WriteString(current.newText)
		cursor = current.end
	}
	builder.WriteString(text[cursor:])
	return builder.String(), nil
}
