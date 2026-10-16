package lsp

import (
	"unicode/utf16"
	"unicode/utf8"
)

// ContentChange uses UTF-16 positions in the previous document. A nil range
// represents full synchronization for servers which do not support increments.
type ContentChange struct {
	Range *Range `json:"range,omitempty"`
	Text  string `json:"text"`
}

// IncrementalChange returns one contiguous replacement, without splitting UTF-8
// runes or CRLF pairs. It scans shared edges without allocating line arrays.
func IncrementalChange(before, after string) ContentChange {
	start := 0
	for start < len(before) && start < len(after) && before[start] == after[start] {
		start++
	}
	for start > 0 && ((start < len(before) && !utf8.RuneStart(before[start])) || (start < len(after) && !utf8.RuneStart(after[start]))) {
		start--
	}
	if start > 0 && ((start < len(before) && before[start-1] == '\r' && before[start] == '\n') || (start < len(after) && after[start-1] == '\r' && after[start] == '\n')) {
		start--
	}
	oldEnd, newEnd := len(before), len(after)
	for oldEnd > start && newEnd > start && before[oldEnd-1] == after[newEnd-1] {
		oldEnd--
		newEnd--
	}
	for oldEnd < len(before) && !utf8.RuneStart(before[oldEnd]) {
		oldEnd++
		newEnd++
	}
	if oldEnd > 0 && oldEnd < len(before) && before[oldEnd-1] == '\r' && before[oldEnd] == '\n' {
		oldEnd++
		newEnd++
	}
	if newEnd > 0 && newEnd < len(after) && after[newEnd-1] == '\r' && after[newEnd] == '\n' {
		oldEnd++
		newEnd++
	}
	return ContentChange{Range: &Range{Start: positionAt(before, start), End: positionAt(before, oldEnd)}, Text: after[start:newEnd]}
}

func positionAt(text string, end int) Position {
	position := Position{}
	for offset := 0; offset < end; {
		r, size := utf8.DecodeRuneInString(text[offset:])
		offset += size
		if r == '\r' || r == '\n' {
			if r == '\r' && offset < end && text[offset] == '\n' {
				offset++
			}
			position.Line++
			position.Character = 0
		} else {
			position.Character += utf16.RuneLen(r)
		}
	}
	return position
}
