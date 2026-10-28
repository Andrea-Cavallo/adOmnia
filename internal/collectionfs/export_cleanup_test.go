package collectionfs

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
	"github.com/Andrea-Cavallo/adOmnia/internal/requestcontract"
)

func TestExportCollectionRemovesStaleNodes(t *testing.T) {
	raw, err := jsonutil.Marshal(map[string]any{
		"id": "req-old", "name": "Old", "type": "request", "method": "GET", "url": "/old",
	})
	if err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(t.TempDir(), "collection")
	collection := Collection{
		ID: "col-cleanup", Name: "Cleanup",
		Children: []Node{{ID: "req-old", Name: "Old", Type: "request", Raw: raw}},
	}
	if err := ExportCollection(root, collection, ExportOptions{}); err != nil {
		t.Fatal(err)
	}
	collection.Children = nil
	if err := ExportCollection(root, collection, ExportOptions{}); err != nil {
		t.Fatal(err)
	}
	imported, err := ImportCollection(root)
	if err != nil {
		t.Fatal(err)
	}
	if got := CountRequests(imported.Children); got != 0 {
		t.Fatalf("stale requests after full export = %d, want 0", got)
	}
}

func TestExportCollectionCanPreserveSecretsForLocalEditing(t *testing.T) {
	root := filepath.Join(t.TempDir(), "collection")
	collection := Collection{ID: "col-local", Name: "Local", Children: []Node{}}
	environment := Environment{
		ID: "env-dev", Name: "dev",
		Variables: []requestcontract.Variable{{Key: "token", Value: "local-secret", Enabled: true, Secret: true}},
	}
	if err := ExportCollection(root, collection, ExportOptions{Environments: []Environment{environment}, PreserveSecretValues: true}); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(root, "environments", "dev.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "local-secret") {
		t.Fatalf("local editing stripped secret value: %s", data)
	}
}
