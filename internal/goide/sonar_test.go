package goide

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"adomnia/internal/netpolicy"
)

func TestSonarIssueFromMapsComponentAndImpacts(t *testing.T) {
	root := t.TempDir()
	item := sonarIssueItem{
		Key: "AY", Rule: "go:S1234", Component: "myproj:internal/api/handler.go", Line: 42,
		Message: "Remove this unused variable", Status: "OPEN", Tags: []string{"unused"},
		Impacts: []sonarImpact{{SoftwareQuality: "MAINTAINABILITY", Severity: "MAJOR"}},
	}
	issue := sonarIssueFrom(root, item)
	if issue.File != "internal/api/handler.go" || issue.Line != 42 || issue.Rule != "go:S1234" {
		t.Fatalf("unexpected issue mapping: %#v", issue)
	}
	if issue.Severity != "MAJOR" || issue.Type != "MAINTAINABILITY" {
		t.Fatalf("impacts fallback failed: %#v", issue)
	}
}

func TestSonarBaselineHidesKnownIssues(t *testing.T) {
	root := t.TempDir()
	issues := []SonarIssue{
		{Rule: "go:S1", File: "a.go", Message: "first"},
		{Rule: "go:S2", File: "b.go", Message: "second"},
	}
	written, err := writeSonarBaseline(root, issues)
	if err != nil || written != 2 {
		t.Fatalf("write baseline: %d %v", written, err)
	}
	kept, hidden := applySonarBaseline(root, []SonarIssue{
		{Rule: "go:S1", File: "a.go", Message: "first"},
		{Rule: "go:S2", File: "b.go", Message: "second"},
		{Rule: "go:S3", File: "c.go", Message: "new"},
	})
	if hidden != 2 || len(kept) != 1 || kept[0].Rule != "go:S3" {
		t.Fatalf("baseline filter wrong: hidden=%d kept=%#v", hidden, kept)
	}
}

func TestNormalizeSonarServerURL(t *testing.T) {
	if got, err := normalizeSonarServerURL("https://sonar.example.com/"); err != nil || got != "https://sonar.example.com" {
		t.Fatalf("normalize failed: %q %v", got, err)
	}
	for _, bad := range []string{"", "ftp://x", "sonar.local", "http://"} {
		if _, err := normalizeSonarServerURL(bad); err == nil {
			t.Fatalf("expected error for %q", bad)
		}
	}
}

func TestSaveSonarConfigValidatesServerAndKey(t *testing.T) {
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	id := string(session.ID)
	for _, config := range []SonarConfig{
		{Enabled: true, ServerURL: "not-a-url", ProjectKey: "p"},
		{Enabled: true, ServerURL: "https://sonar.example.com", ProjectKey: ""},
	} {
		if _, err := service.SaveSonarConfig(id, config); err == nil {
			t.Fatalf("expected validation error for %#v", config)
		}
	}
	saved, err := service.SaveSonarConfig(id, SonarConfig{Enabled: true, ServerURL: "https://sonar.example.com/", ProjectKey: "p"})
	if err != nil {
		t.Fatalf("valid config rejected: %v", err)
	}
	if saved.ServerURL != "https://sonar.example.com" || saved.Sources != "." || saved.HasToken {
		t.Fatalf("config not normalized: %#v", saved)
	}
}

func TestRunSonarScanRequiresTrustAndOnline(t *testing.T) {
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	id := string(session.ID)
	if _, err := service.SaveSonarConfig(id, SonarConfig{Enabled: true, ServerURL: "https://sonar.example.com", ProjectKey: "p"}); err != nil {
		t.Fatal(err)
	}
	// Progetto non autorizzato: nessuna scansione, nessun processo.
	if _, err := service.RunSonarScan(context.Background(), id, "token"); err == nil || !strings.Contains(err.Error(), "autorizza") {
		t.Fatalf("expected trust error, got %v", err)
	}
	if _, err := service.SetToolAuthorization(id, true); err != nil {
		t.Fatal(err)
	}
	// Offline mode: la scansione che contatta il server viene rifiutata prima di avviare altro.
	previous := netpolicy.Current()
	if _, err := netpolicy.Save(netpolicy.Settings{Offline: true}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = netpolicy.Save(previous) })
	if _, err := service.RunSonarScan(context.Background(), id, "token"); err == nil {
		t.Fatal("expected offline error")
	}
}

func TestDetectSonarScannerWindowsBatchOnPath(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows sonar-scanner launcher")
	}
	bin := t.TempDir()
	if err := os.WriteFile(filepath.Join(bin, "sonar-scanner.bat"), []byte("@echo off\r\necho SonarScanner CLI 8.1.0.6389\r\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	info, err := service.DetectSonarScanner(string(session.ID))
	if err != nil || !info.Available || info.Version != "8.1.0.6389" || info.Source != "PATH" {
		t.Fatalf("scanner batch not detected: %#v, %v", info, err)
	}
}

func TestFetchSonarIssuesParsesWebAPI(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/issues/search" {
			http.NotFound(w, r)
			return
		}
		if user, _, ok := r.BasicAuth(); !ok || user != "secret-token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"paging":{"pageIndex":1,"pageSize":500,"total":1},"issues":[{"key":"k1","rule":"go:S1","severity":"CRITICAL","type":"VULNERABILITY","component":"pkg:main.go","line":7,"message":"msg","status":"OPEN"}]}`))
	}))
	defer server.Close()

	root := t.TempDir()
	service := NewService(nil, nil)
	session := testSession(root)
	config := SonarConfig{Enabled: true, ServerURL: server.URL, ProjectKey: "pkg", Sources: "."}
	issues, err := service.fetchSonarIssues(context.Background(), session, config, "secret-token")
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if len(issues) != 1 || issues[0].Key != "k1" || issues[0].File != "main.go" || issues[0].Severity != "CRITICAL" {
		t.Fatalf("unexpected issues: %#v", issues)
	}
}

func TestWaitSonarTaskPollsUntilSuccess(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/ce/task" || r.URL.Query().Get("id") != "AX1" {
			http.NotFound(w, r)
			return
		}
		calls++
		status := "IN_PROGRESS"
		if calls > 1 {
			status = "SUCCESS"
		}
		_, _ = w.Write([]byte(`{"task":{"status":"` + status + `"}}`))
	}))
	defer server.Close()

	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, ".scannerwork"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".scannerwork", "report-task.txt"), []byte("projectKey=p\nceTaskId=AX1\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	service := NewService(nil, nil)
	if err := service.waitSonarTask(context.Background(), root, server.URL, "tok"); err != nil {
		t.Fatalf("wait: %v", err)
	}
	if calls != 2 {
		t.Fatalf("expected 2 polls, got %d", calls)
	}
}
