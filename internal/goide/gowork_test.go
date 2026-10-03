package goide

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestUpdateGoWorkWithRealGo(t *testing.T) {
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("go non installato")
	}
	root := t.TempDir()
	for _, module := range []string{"api", "worker"} {
		if err := os.MkdirAll(filepath.Join(root, module), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, module, "go.mod"), []byte("module example.com/"+module+"\n\ngo 1.22\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	sessionID := string(session.ID)
	if _, err := service.UpdateGoWork(sessionID, []string{"api"}); err == nil {
		t.Fatal("go.work changed without trusting the project")
	}
	if _, err := service.SetToolAuthorization(sessionID, true); err != nil {
		t.Fatal(err)
	}
	if info, err := service.DetectToolchain(sessionID); err != nil || !info.Available {
		t.Fatalf("toolchain: %v %+v", err, info)
	}

	state, err := service.UpdateGoWork(sessionID, []string{"api", "worker"})
	if err != nil {
		t.Fatal(err)
	}
	if !state.Exists || !state.Modules[0].InWorkspace || !state.Modules[1].InWorkspace {
		t.Fatalf("go.work init: %+v", state)
	}
	if current, _ := service.session(sessionID); goLayoutOf(current.Project).GoWorkPath == "" {
		t.Fatal("session not refreshed after go work init")
	}

	state, err = service.UpdateGoWork(sessionID, []string{"api"})
	if err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(filepath.Join(root, "go.work"))
	if strings.Contains(string(data), "worker") || !state.Modules[0].InWorkspace || state.Modules[1].InWorkspace {
		t.Fatalf("drop worker:\n%s\n%+v", data, state)
	}
	if _, err := service.UpdateGoWork(sessionID, []string{"../outside"}); err == nil {
		t.Fatal("directory outside the detected modules accepted")
	}
}

func TestCloneDestination(t *testing.T) {
	parent := t.TempDir()
	for url, want := range map[string]string{
		"https://github.com/golang/example.git": "example",
		"git@gitlab.alm.poste.it:SDP/pdld-core.git": "pdld-core",
		"ssh://git@host:22/team/api/":               "api",
	} {
		got, err := CloneDestination(parent, url)
		if err != nil || got != filepath.Join(parent, want) {
			t.Errorf("CloneDestination(%q) = %q, %v; want %q", url, got, err, want)
		}
	}
	if err := os.Mkdir(filepath.Join(parent, "example"), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := CloneDestination(parent, "https://github.com/golang/example.git"); err == nil {
		t.Fatal("existing destination accepted")
	}
	if _, err := CloneDestination("relative/dir", "https://h/x.git"); err == nil {
		t.Fatal("relative parent accepted")
	}
	if _, err := CloneDestination(parent, "https://h/.."); err == nil {
		t.Fatal("dot-dot repository name accepted")
	}
}
