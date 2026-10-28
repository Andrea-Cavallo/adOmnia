package golang

import (
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/idetest"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/lsp"
)

func positionAt(t *testing.T, text, needle string, offset int) lsp.Position {
	line, column := idetest.PositionOf(t, text, needle, offset)
	return lsp.Position{Line: line - 1, Character: column - 1}
}

func TestClassifyUsagesFromSyntax(t *testing.T) {
	text := "package p\n\nimport \"strings\"\n\ntype box struct{ size int }\n\nfunc grow(b *box) int {\n\tb.size = strings.Count(\"x\", \"x\")\n\tb.size += 2\n\tfor i := range 3 {\n\t\t_ = i\n\t}\n\treturn b.size\n}\n"
	positions := []lsp.Position{
		positionAt(t, text, `"strings"`, 0),
		positionAt(t, text, "size int", 0),
		positionAt(t, text, "size = ", 0),
		positionAt(t, text, "size += ", 0),
		positionAt(t, text, "b.size\n}", 2),
		positionAt(t, text, "i := range", 0),
		positionAt(t, text, "strings.Count", 0),
	}
	got := New().ClassifyUsages(text, positions)
	want := "import,declaration,write,write,read,declaration,read"
	if strings.Join(got, ",") != want {
		t.Fatalf("usage = %v, want %s", got, want)
	}
}

func TestClassifyUsagesToleratesBrokenBuffers(t *testing.T) {
	got := New().ClassifyUsages("package p\nfunc (", []lsp.Position{{Line: 98, Character: 0}})
	if len(got) > 0 && got[0] != "" {
		t.Fatalf("a missing position was classified: %q", got[0])
	}
}

func TestDeclarationSourceIncludesDocAndStopsAtDecl(t *testing.T) {
	text := "package p\n\n// Hello saluta.\nfunc Hello(name string) string {\n\treturn \"hi \" + name\n}\n\nvar other = 1\n"
	code, start, found := New().DeclarationSource(text, positionAt(t, text, "Hello(name", 0))
	if !found || start != 3 || code != "// Hello saluta.\nfunc Hello(name string) string {\n\treturn \"hi \" + name\n}" {
		t.Fatalf("unexpected source (line %d): %q", start, code)
	}
}
