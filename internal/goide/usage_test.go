package goide

import (
	"strings"
	"testing"
)

func TestClassifyUsagesFromSyntax(t *testing.T) {
	text := "package p\n\nimport \"strings\"\n\ntype box struct{ size int }\n\nfunc grow(b *box) int {\n\tb.size = strings.Count(\"x\", \"x\")\n\tb.size += 2\n\tfor i := range 3 {\n\t\t_ = i\n\t}\n\treturn b.size\n}\n"
	at := func(needle string, offset int) EditorRange {
		line, column := positionOf(t, text, needle, offset)
		return EditorRange{StartLine: line, StartColumn: column, EndLine: line, EndColumn: column + 1}
	}
	locations := []EditorLocation{
		{URI: "file:///p.go", Range: at(`"strings"`, 0)},
		{URI: "file:///p.go", Range: at("size int", 0)},
		{URI: "file:///p.go", Range: at("size = ", 0)},
		{URI: "file:///p.go", Range: at("size += ", 0)},
		{URI: "file:///p.go", Range: at("b.size\n}", 2)},
		{URI: "file:///p.go", Range: at("i := range", 0)},
		{URI: "file:///p.go", Range: at("strings.Count", 0)},
	}
	classifyUsages(newLanguageRegistry(), locations, func(EditorLocation) string { return text })
	got := make([]string, 0, len(locations))
	for _, location := range locations {
		got = append(got, location.Usage)
	}
	want := "import,declaration,write,write,read,declaration,read"
	if strings.Join(got, ",") != want {
		t.Fatalf("usage = %v, atteso %s", got, want)
	}
}

func TestClassifyUsagesToleratesBrokenBuffers(t *testing.T) {
	locations := []EditorLocation{{URI: "file:///x.go", Range: EditorRange{StartLine: 99, StartColumn: 1, EndLine: 99, EndColumn: 2}}}
	classifyUsages(newLanguageRegistry(), locations, func(EditorLocation) string { return "package p\nfunc (" })
	if locations[0].Usage != "" {
		t.Fatalf("posizione inesistente classificata: %q", locations[0].Usage)
	}
}

func TestDeclarationSourceIncludesDocAndStopsAtDecl(t *testing.T) {
	text := "package p\n\n// Hello saluta.\nfunc Hello(name string) string {\n\treturn \"hi \" + name\n}\n\nvar other = 1\n"
	line, column := positionOf(t, text, "Hello(name", 0)
	code, start, truncated := declarationSource(newLanguageRegistry(), "/p/hello.go", text, EditorRange{StartLine: line, StartColumn: column, EndLine: line, EndColumn: column})
	if start != 3 || truncated || code != "// Hello saluta.\nfunc Hello(name string) string {\n\treturn \"hi \" + name\n}" {
		t.Fatalf("sorgente inatteso (riga %d): %q", start, code)
	}
}
