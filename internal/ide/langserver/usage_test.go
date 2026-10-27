package langserver

import (
	"strings"
	"testing"
)

// The Go syntax rules are tested in internal/languages/golang; here only the dispatch to the file's language.

func TestClassifyUsagesAsksTheLanguageOfEachFileOnce(t *testing.T) {
	locations := []EditorLocation{
		{URI: "file:///p/a.go", Range: EditorRange{StartLine: 1, StartColumn: 1}},
		{URI: "file:///p/notes.txt", Range: EditorRange{StartLine: 1, StartColumn: 1}},
		{URI: "file:///p/a.go", Range: EditorRange{StartLine: 3, StartColumn: 5}},
	}
	reads := 0
	classifyUsages(newLanguageRegistry(), locations, func(EditorLocation) string { reads++; return "text" })
	if reads != 1 {
		t.Fatalf("the file was read %d times, want 1", reads)
	}
	got := []string{locations[0].Usage, locations[1].Usage, locations[2].Usage}
	if strings.Join(got, ",") != "read@0:0,,read@2:4" {
		t.Fatalf("usages = %v", got)
	}
}

func TestDeclarationSourceClipsLongDeclarations(t *testing.T) {
	code, start, truncated := declarationSource(newLanguageRegistry(), "/p/a.go", strings.Repeat("x\n", maxQuickDefinitionLines+10), EditorRange{StartLine: 1, StartColumn: 1})
	if start != 1 || !truncated || strings.Count(code, "\n") != maxQuickDefinitionLines-1 {
		t.Fatalf("start %d truncated %v lines %d", start, truncated, strings.Count(code, "\n")+1)
	}
	if code, _, _ := declarationSource(newLanguageRegistry(), "/p/notes.txt", "x", EditorRange{StartLine: 1, StartColumn: 1}); code != "" {
		t.Fatalf("a file without a language returned %q", code)
	}
}
