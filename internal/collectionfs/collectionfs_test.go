package collectionfs

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"adomnia/internal/requestcontract"
)

func TestExportCollectionFromFreezeFixtureIsDeterministic(t *testing.T) {
	collection := loadFixtureCollection(t)
	now := time.Date(2026, 6, 26, 5, 50, 0, 0, time.UTC)

	first := filepath.Join(t.TempDir(), "first")
	second := filepath.Join(t.TempDir(), "second")
	if err := ExportCollection(first, collection, ExportOptions{Now: now}); err != nil {
		t.Fatalf("first export failed: %v", err)
	}
	if err := ExportCollection(second, collection, ExportOptions{Now: now}); err != nil {
		t.Fatalf("second export failed: %v", err)
	}

	firstSnapshot, err := Snapshot(first)
	if err != nil {
		t.Fatalf("snapshot first: %v", err)
	}
	secondSnapshot, err := Snapshot(second)
	if err != nil {
		t.Fatalf("snapshot second: %v", err)
	}
	if !EqualSnapshots(firstSnapshot, secondSnapshot) {
		t.Fatal("exports differ; want deterministic folder projection")
	}

	required := []string{
		"adomnia.collection.json",
		"collection.json",
		".gitignore",
		".adomnia-sync.json",
		"folders/001-auth/folder.json",
		"folders/001-auth/001-issue-oauth-token.request.json",
		"folders/002-users/001-profile/001-get-user-profile.request.json",
		"folders/003-admin/001-create-admin-event.request.json",
		"folders/003-admin/002-patch-graphql-preferences.request.json",
		"folders/003-admin/003-digest-protected-audit-probe.request.json",
	}
	for _, rel := range required {
		if _, ok := firstSnapshot[rel]; !ok {
			t.Fatalf("missing exported file %s", rel)
		}
	}

	var request map[string]any
	if err := json.Unmarshal(firstSnapshot["folders/002-users/001-profile/001-get-user-profile.request.json"], &request); err != nil {
		t.Fatalf("decode exported request: %v", err)
	}
	if request["schemaVersion"] != FormatVersion {
		t.Fatalf("schemaVersion = %v, want %s", request["schemaVersion"], FormatVersion)
	}
	if request["id"] != "req-users-get" {
		t.Fatalf("request id = %v", request["id"])
	}
	if request["seq"].(float64) != 1 {
		t.Fatalf("request seq = %v", request["seq"])
	}
}

func TestImportCollectionRoundTripsExportedFolder(t *testing.T) {
	collection := loadFixtureCollection(t)
	now := time.Date(2026, 6, 26, 5, 50, 0, 0, time.UTC)

	first := filepath.Join(t.TempDir(), "first")
	if err := ExportCollection(first, collection, ExportOptions{Now: now}); err != nil {
		t.Fatalf("export failed: %v", err)
	}
	imported, err := ImportCollection(first)
	if err != nil {
		t.Fatalf("import failed: %v", err)
	}
	if imported.ID != collection.ID || imported.Name != collection.Name || imported.OpenAPISpec == "" {
		t.Fatalf("imported collection metadata mismatch: %#v", imported)
	}
	if got := countRequests(imported.Children); got != 5 {
		t.Fatalf("imported request count = %d, want 5", got)
	}

	second := filepath.Join(t.TempDir(), "second")
	if err := ExportCollection(second, imported, ExportOptions{Now: now}); err != nil {
		t.Fatalf("re-export failed: %v", err)
	}
	firstSnapshot, err := Snapshot(first)
	if err != nil {
		t.Fatalf("snapshot first: %v", err)
	}
	secondSnapshot, err := Snapshot(second)
	if err != nil {
		t.Fatalf("snapshot second: %v", err)
	}
	if !EqualSnapshots(firstSnapshot, secondSnapshot) {
		t.Fatal("imported collection re-export differs from original folder projection")
	}
}

func TestInspectDriftDetectsManualFolderChange(t *testing.T) {
	collection := loadFixtureCollection(t)
	root := filepath.Join(t.TempDir(), "collection")
	if err := ExportCollection(root, collection, ExportOptions{Now: time.Date(2026, 6, 26, 5, 50, 0, 0, time.UTC)}); err != nil {
		t.Fatalf("export failed: %v", err)
	}

	report, err := InspectDrift(root, collection)
	if err != nil {
		t.Fatalf("inspect clean folder failed: %v", err)
	}
	if !report.InSync {
		t.Fatalf("clean folder reported drift: %#v", report)
	}

	requestPath := filepath.Join(root, "folders", "003-admin", "001-create-admin-event.request.json")
	var request map[string]any
	data, err := os.ReadFile(requestPath)
	if err != nil {
		t.Fatalf("read request: %v", err)
	}
	if err := json.Unmarshal(data, &request); err != nil {
		t.Fatalf("decode request: %v", err)
	}
	request["name"] = "Create Admin Event Changed On Disk"
	changed, err := json.MarshalIndent(request, "", "  ")
	if err != nil {
		t.Fatalf("encode changed request: %v", err)
	}
	changed = append(changed, '\n')
	if err := os.WriteFile(requestPath, changed, 0644); err != nil {
		t.Fatalf("write changed request: %v", err)
	}

	report, err = InspectDrift(root, collection)
	if err != nil {
		t.Fatalf("inspect drift folder failed: %v", err)
	}
	if report.InSync {
		t.Fatalf("changed folder reported in sync: %#v", report)
	}
	if report.RequestCount != 5 || report.FolderRequestCount != 5 {
		t.Fatalf("request counts = %d/%d, want 5/5", report.RequestCount, report.FolderRequestCount)
	}
}

func TestExportImportPreservesInheritanceMetadataAndMasksSecrets(t *testing.T) {
	collection := Collection{
		ID:   "col-inherit",
		Name: "Inherited",
		Auth: requestcontract.Auth{Type: "bearer", Token: "{{token}}"},
		Variables: []requestcontract.Variable{
			{Key: "token", Value: "secret-token", Enabled: true, Secret: true},
			{Key: "tenant", Value: "acme", Enabled: true},
		},
		Children: []Node{{
			ID:   "folder",
			Name: "Shared",
			Type: "folder",
			Headers: []requestcontract.KVRow{{
				Key: "X-Tenant", Value: "{{tenant}}", Enabled: true,
			}},
		}},
	}
	root := filepath.Join(t.TempDir(), "collection")
	if err := ExportCollection(root, collection, ExportOptions{}); err != nil {
		t.Fatalf("export failed: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(root, "collection.json"))
	if err != nil {
		t.Fatalf("read collection metadata: %v", err)
	}
	var meta struct {
		Variables []requestcontract.Variable `json:"variables"`
	}
	if err := json.Unmarshal(data, &meta); err != nil {
		t.Fatalf("decode metadata: %v", err)
	}
	if len(meta.Variables) != 2 || meta.Variables[0].Value != "" || !meta.Variables[0].Secret {
		t.Fatalf("secret variable was not masked: %#v", meta.Variables)
	}
	imported, err := ImportCollection(root)
	if err != nil {
		t.Fatalf("import failed: %v", err)
	}
	if imported.Auth.Type != "bearer" || imported.Auth.Token != "{{token}}" {
		t.Fatalf("auth = %#v", imported.Auth)
	}
	if len(imported.Children) != 1 || len(imported.Children[0].Headers) != 1 || imported.Children[0].Headers[0].Key != "X-Tenant" {
		t.Fatalf("folder headers = %#v", imported.Children)
	}
}

func loadFixtureCollection(t *testing.T) Collection {
	t.Helper()
	path := filepath.Join("..", "..", "docs", "fixtures", "collection-contract-freeze.v1.adomnia.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var fixture struct {
		Storage map[string]json.RawMessage `json:"storage"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
	var collectionsEnvelope struct {
		Workspaces []struct {
			Collections []Collection `json:"collections"`
		} `json:"workspaces"`
	}
	if err := json.Unmarshal(fixture.Storage["collections/all"], &collectionsEnvelope); err != nil {
		t.Fatalf("decode collections envelope: %v", err)
	}
	if len(collectionsEnvelope.Workspaces) == 0 || len(collectionsEnvelope.Workspaces[0].Collections) == 0 {
		t.Fatal("fixture has no collection")
	}
	return collectionsEnvelope.Workspaces[0].Collections[0]
}

func countRequests(nodes []Node) int {
	total := 0
	for _, node := range nodes {
		if node.Type == "request" {
			total++
			continue
		}
		total += countRequests(node.Children)
	}
	return total
}
