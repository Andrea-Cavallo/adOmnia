package codestudio

import (
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/lsp"
	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestHierarchyPreviewUsesBufferWithoutOpeningDocuments(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "order.go")
	disk := "package order\nfunc Save() { println(1) }\n"
	buffer := "package order\nfunc Save() { println(2) }\n"
	if err := os.WriteFile(path, []byte(disk), 0600); err != nil {
		t.Fatal(err)
	}
	uri := fileURI(path)
	manager := NewLSPManager(newLanguageRegistry())
	state := &lspSession{id: "s", language: "go", root: root, documents: map[DocumentID]*trackedDocument{"d": {id: "d", uri: uri, path: path, text: buffer}}, byURI: map[string]DocumentID{uri: "d"}}
	manager.sessions[lspKey{session: "s", language: "go"}] = state
	token, _ := jsonutil.Marshal(hierarchyItem{Name: "Save", URI: uri, SelectionRange: lsp.Range{Start: lsp.Position{Line: 1, Character: 5}, End: lsp.Position{Line: 1, Character: 9}}})
	result, err := manager.HierarchyPreview("s", string(token))
	if err != nil || !result.Found || !strings.Contains(result.Code, "println(2)") {
		t.Fatalf("preview = %+v, %v", result, err)
	}
	if len(state.documents) != 1 || state.process != nil {
		t.Fatal("preview changed document/server lifecycle")
	}
	delete(state.documents, "d")
	delete(state.byURI, uri)
	result, err = manager.HierarchyPreview("s", string(token))
	if err != nil || !strings.Contains(result.Code, "println(1)") || len(state.documents) != 0 {
		t.Fatalf("disk preview = %+v, %v", result, err)
	}
	if _, err = manager.HierarchyPreview("s", "{}"); err == nil {
		t.Fatal("accepted invalid token")
	}
}
