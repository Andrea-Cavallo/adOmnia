package goide

// Helper di testo e percorsi per Move symbol.

import (
	"errors"
	"go/ast"
	"go/token"
	"go/types"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode"
	"unicode/utf16"
)

func declStart(decl ast.Decl) token.Pos {
	switch value := decl.(type) {
	case *ast.FuncDecl:
		if value.Doc != nil {
			return value.Doc.Pos()
		}
	case *ast.GenDecl:
		if value.Doc != nil {
			return value.Doc.Pos()
		}
	}
	return decl.Pos()
}

func extendOverNewlines(text []byte, end int) int {
	for end < len(text) && (text[end] == '\n' || text[end] == '\r') {
		end++
	}
	return end
}

func applyByteEdits(text string, edits []byteEdit) (string, error) {
	sorted := append([]byteEdit(nil), edits...)
	sort.SliceStable(sorted, func(left, right int) bool { return sorted[left].start > sorted[right].start })
	for index, edit := range sorted {
		if edit.start < 0 || edit.end < edit.start || edit.end > len(text) {
			return "", errors.New("modifica fuori dal testo")
		}
		if index > 0 && edit.end > sorted[index-1].start {
			return "", errors.New("modifiche sovrapposte")
		}
		text = text[:edit.start] + edit.text + text[edit.end:]
	}
	return text, nil
}

func byteOffsetAt(text string, line, column int) (int, error) {
	if line < 1 {
		return 0, errors.New("posizione non valida")
	}
	offset := 0
	for current := 1; current < line; current++ {
		next := strings.IndexByte(text[offset:], '\n')
		if next < 0 {
			return 0, errors.New("posizione oltre la fine del file")
		}
		offset += next + 1
	}
	lineText := text[offset:]
	if end := strings.IndexByte(lineText, '\n'); end >= 0 {
		lineText = lineText[:end]
	}
	units := 0
	for index, char := range lineText {
		if units >= column-1 {
			return offset + index, nil
		}
		units += len(utf16.Encode([]rune{char}))
	}
	return offset + len(lineText), nil
}

func localImportName(name *types.PkgName) string {
	if name.Name() == name.Imported().Name() {
		return ""
	}
	return name.Name()
}

func packageNameForDir(directory string) string {
	base := strings.ToLower(filepath.Base(directory))
	var builder strings.Builder
	for _, char := range base {
		if unicode.IsLetter(char) || unicode.IsDigit(char) {
			builder.WriteRune(char)
		}
	}
	name := builder.String()
	if name == "" || unicode.IsDigit(rune(name[0])) {
		name = "pkg" + name
	}
	return name
}

func snakeCase(name string) string {
	var builder strings.Builder
	runes := []rune(name)
	for index, char := range runes {
		if unicode.IsUpper(char) {
			if index > 0 && (unicode.IsLower(runes[index-1]) || index+1 < len(runes) && unicode.IsLower(runes[index+1])) {
				builder.WriteByte('_')
			}
			builder.WriteRune(unicode.ToLower(char))
			continue
		}
		builder.WriteRune(char)
	}
	return builder.String()
}

func hasNestedModule(moduleDir, directory string) bool {
	for current := directory; ensureWithinRoot(moduleDir, current) == nil && filepath.Clean(current) != filepath.Clean(moduleDir); current = filepath.Dir(current) {
		if _, err := os.Stat(filepath.Join(current, "go.mod")); err == nil {
			return true
		}
	}
	return false
}

func withGoFirstInPath(environment []string, binary string) []string {
	result := append([]string(nil), environment...)
	directory := filepath.Dir(binary)
	for index, entry := range result {
		name, value, _ := strings.Cut(entry, "=")
		if strings.EqualFold(name, "PATH") {
			result[index] = name + "=" + directory + string(os.PathListSeparator) + value
			return result
		}
	}
	return append(result, "PATH="+directory)
}

func appendUnique(values []string, value string) []string {
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}

func firstN(values []string, count int) []string {
	if len(values) > count {
		return values[:count]
	}
	return values
}
