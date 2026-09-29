package devcontext

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// copyFixture copies testdata/project into a temp dir so tests can edit files.
func copyFixture(t *testing.T) string {
	t.Helper()
	dst := t.TempDir()
	src := filepath.Join("testdata", "project")
	err := filepath.WalkDir(src, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, p)
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		data, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		return os.WriteFile(target, data, 0o644)
	})
	if err != nil {
		t.Fatal(err)
	}
	return dst
}

func newTestManager(root string) (*Manager, *[]int64) {
	var versions []int64
	m := NewManager(func(id string) (string, error) { return root, nil }, func(_ string, v int64) { versions = append(versions, v) })
	return m, &versions
}

func TestManagerScansFixture(t *testing.T) {
	root := copyFixture(t)
	m, versions := newTestManager(root)
	snap, err := m.Get("s1")
	if err != nil {
		t.Fatal(err)
	}
	ids := byID(snap.Entities)
	for _, id := range []string{
		"module:example.com/payments", "service:go:cmd/api", "service:compose:db",
		"route:POST /payments", "route:GET /payments/{id}", "table:payments",
		"envvar:DATABASE_URL", "envvar:API_TOKEN", "contract:api/openapi.yaml", "contract:proto/payments.proto",
		"datasource:postgres@localhost:5432/payments",
	} {
		if _, ok := ids[id]; !ok {
			t.Errorf("missing %s", id)
		}
	}
	if len(ids["route:GET /payments/{id}"].Sources) != 2 {
		t.Errorf("code and OAS route must merge: %+v", ids["route:GET /payments/{id}"])
	}
	if _, ok := ids["route:GET /vendored"]; ok {
		t.Error("vendor must be skipped")
	}
	if len(ids["envvar:DATABASE_URL"].Sources) != 2 || strings.Contains(ids["envvar:DATABASE_URL"].Attrs["value"], "s3cret") {
		t.Errorf("env usage + definition merge, value redacted: %+v", ids["envvar:DATABASE_URL"])
	}
	if snap.Version != 1 || len(*versions) != 1 {
		t.Errorf("first scan must notify version 1, got %d %v", snap.Version, *versions)
	}
}

func TestManagerInvalidateAndBrokenSave(t *testing.T) {
	root := copyFixture(t)
	m, _ := newTestManager(root)
	if _, err := m.Get("s1"); err != nil {
		t.Fatal(err)
	}
	main := filepath.Join(root, "cmd", "api", "main.go")
	if err := os.WriteFile(main, []byte("package main\nfunc main() {\n\tmux.HandleFunc(\"GET /health\", h)\n\tmux.HandleFunc(\"GET /half\", \n"), 0o644); err != nil {
		t.Fatal(err)
	}
	m.Invalidate("s1", "cmd/api/main.go")
	snap, _ := m.Get("s1")
	ids := byID(snap.Entities)
	if _, ok := ids["route:GET /health"]; !ok {
		t.Error("invalidate must rescan the saved file")
	}
	if _, ok := ids["route:POST /payments"]; ok {
		t.Error("routes removed from the file must disappear")
	}
	if _, ok := ids["table:payments"]; !ok {
		t.Error("other files must be untouched")
	}
	if len(snap.Warnings) != 0 {
		t.Errorf("a half-typed Go file must not warn: %v", snap.Warnings)
	}
}

func TestManagerDotenvChangeRefreshesCompose(t *testing.T) {
	root := copyFixture(t)
	m, _ := newTestManager(root)
	_, _ = m.Get("s1")
	if err := os.WriteFile(filepath.Join(root, ".env"), []byte("POSTGRES_DB=ledger\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	m.Invalidate("s1", ".env")
	snap, _ := m.Get("s1")
	if _, ok := byID(snap.Entities)["datasource:postgres@localhost:5432/ledger"]; !ok {
		t.Fatalf("compose must be re-interpolated after .env changes: %v", keys(byID(snap.Entities)))
	}
}

func TestManagerCheckStaleFindsNewAndDeletedFiles(t *testing.T) {
	root := copyFixture(t)
	m, _ := newTestManager(root)
	_, _ = m.Get("s1")
	if changed, _ := m.CheckStale("s1"); changed {
		t.Fatal("nothing changed yet")
	}
	_ = os.Remove(filepath.Join(root, "proto", "payments.proto"))
	_ = os.WriteFile(filepath.Join(root, "ledger.wsdl"), []byte("<definitions/>"), 0o644)
	future := time.Now().Add(2 * time.Second)
	_ = os.Chtimes(filepath.Join(root, "ledger.wsdl"), future, future)
	changed, err := m.CheckStale("s1")
	if err != nil || !changed {
		t.Fatalf("expected change, got %v %v", changed, err)
	}
	ids := byID(mustGet(t, m).Entities)
	if _, ok := ids["contract:proto/payments.proto"]; ok {
		t.Error("deleted file must disappear")
	}
	if _, ok := ids["contract:ledger.wsdl"]; !ok {
		t.Error("new file must appear")
	}
}

func mustGet(t *testing.T, m *Manager) Snapshot {
	t.Helper()
	s, err := m.Get("s1")
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestManagerReadFileGuards(t *testing.T) {
	root := copyFixture(t)
	m, _ := newTestManager(root)
	if text, err := m.ReadFile("s1", "api/openapi.yaml"); err != nil || !strings.Contains(text, "openapi") {
		t.Fatalf("contract read failed: %v", err)
	}
	for _, rel := range []string{"../outside.yaml", ".env", "cmd/api/main.go", filepath.Join(root, "api", "openapi.yaml")} {
		if _, err := m.ReadFile("s1", rel); err == nil {
			t.Errorf("ReadFile(%q) must be refused", rel)
		}
	}
}

func TestManagerDropAndUnknownInvalidate(t *testing.T) {
	root := copyFixture(t)
	m, versions := newTestManager(root)
	m.Invalidate("never-scanned", "go.mod") // must be a no-op
	if len(*versions) != 0 {
		t.Fatal("invalidate before the first scan must not notify")
	}
	_, _ = m.Get("s1")
	m.Drop("s1")
	snap, _ := m.Get("s1")
	if snap.Version != 1 {
		t.Fatalf("drop must forget the session so the next Get rescans from scratch, got version %d", snap.Version)
	}
}
