package codestudio

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const (
	capabilityMatrixStart = "<!-- capability-matrix:start -->"
	capabilityMatrixEnd   = "<!-- capability-matrix:end -->"
)

// TestCapabilityMatrixDocumentMatchesRegistry keeps docs/LANGUAGE-CAPABILITY-MATRIX.md
// honest: the table between the markers is regenerated from the registry the
// application uses, so a language added without updating the page fails here.
//
// Regenerate with: ADOMNIA_UPDATE_MATRIX=1 go test ./internal/codestudio -run TestCapabilityMatrixDocumentMatchesRegistry
func TestCapabilityMatrixDocumentMatchesRegistry(t *testing.T) {
	path := filepath.Join("..", "..", "docs", "LANGUAGE-CAPABILITY-MATRIX.md")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	document := string(raw)
	start := strings.Index(document, capabilityMatrixStart)
	end := strings.Index(document, capabilityMatrixEnd)
	if start < 0 || end < 0 || end < start {
		t.Fatalf("%s is missing the %s / %s markers", path, capabilityMatrixStart, capabilityMatrixEnd)
	}
	generated := CapabilityMatrixMarkdown()
	head := document[:start+len(capabilityMatrixStart)]
	tail := document[end:]
	updated := head + "\n" + generated + tail
	if os.Getenv("ADOMNIA_UPDATE_MATRIX") == "1" {
		if err := os.WriteFile(path, []byte(updated), 0o644); err != nil {
			t.Fatalf("write %s: %v", path, err)
		}
		return
	}
	if updated != document {
		t.Fatalf("docs/LANGUAGE-CAPABILITY-MATRIX.md is out of date with the language registry; " +
			"regenerate it with ADOMNIA_UPDATE_MATRIX=1 go test ./internal/codestudio -run TestCapabilityMatrixDocumentMatchesRegistry")
	}
}

// TestCapabilityMatrixCoversEveryRegisteredLanguage guards against an empty or
// partial table passing the comparison above.
func TestCapabilityMatrixCoversEveryRegisteredLanguage(t *testing.T) {
	table := CapabilityMatrixMarkdown()
	for _, adapter := range newLanguageRegistry().All() {
		if !strings.Contains(table, "`"+adapter.ID()+"`") {
			t.Fatalf("capability matrix is missing language %q", adapter.ID())
		}
	}
	if rows := strings.Count(table, "\n|"); rows < 3 {
		t.Fatalf("capability matrix has %d rows, want a header plus at least one language", rows)
	}
}
