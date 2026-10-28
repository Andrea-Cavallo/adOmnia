package langserver

import (
	"strings"
	"unicode/utf16"
)

// EditorPositionAt returns the Monaco line and column (1-based, UTF-16) of a byte offset in text.
func EditorPositionAt(text string, offset int) (line, column int) {
	prefix := text[:offset]
	line = strings.Count(prefix, "\n") + 1
	lineStart := strings.LastIndexByte(prefix, '\n') + 1
	return line, len(utf16.Encode([]rune(prefix[lineStart:]))) + 1
}
