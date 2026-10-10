package collab

import (
	"os"
	"path/filepath"
	"testing"
)

func TestProjectTransferConfinementAndSecretExclusion(t *testing.T) {
	root := t.TempDir()
	for name, content := range map[string]string{"main.go": "package main", ".env": "password=secret", "key.pem": "private key", "secret.go": "var password = \"real-secret\"", "binary": "a\x00b"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	host, _ := startHost(t)
	info, err := host.ShareProject(root)
	if err != nil {
		t.Fatal(err)
	}
	guest, _ := join(t, host, RoleViewer, "Reader")
	if guest.Status().Project == nil || guest.Status().Project.ID != info.ID {
		t.Fatal("late join lost project")
	}
	tree, err := guest.ProjectTree()
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range tree {
		if e.Path == ".env" || e.Path == "key.pem" {
			t.Fatalf("secret filename: %s", e.Path)
		}
	}
	file, err := guest.ReadProjectFile("main.go")
	if err != nil || file.Content != "package main" {
		t.Fatalf("read: %+v %v", file, err)
	}
	for _, path := range []string{"../escape", ".env", "key.pem", "secret.go", "binary", root, `C:\Windows\win.ini`} {
		if _, err := guest.ReadProjectFile(path); err == nil {
			t.Fatalf("accepted %s", path)
		}
	}
}

func TestProjectSymlinkEscape(t *testing.T) {
	root, outside := t.TempDir(), t.TempDir()
	os.WriteFile(filepath.Join(outside, "outside.txt"), []byte("outside"), 0600)
	if err := os.Symlink(filepath.Join(outside, "outside.txt"), filepath.Join(root, "link.txt")); err != nil {
		t.Skip("symlink privilege unavailable")
	}
	if _, err := projectPath(root, "link.txt"); err == nil {
		t.Fatal("symlink escaped root")
	}
}

func TestStructuredProjectSecretsUseExistingRedaction(t *testing.T) {
	for _, test := range []struct {
		path, content string
		secret        bool
	}{
		{"config.yaml", "database:\n  password: unquoted-secret\n", true},
		{"config.json", `{"token":"secret"}`, true},
		{"config.yaml", "server:\n  port: 8080\n", false},
		{"config.json", `{"host":"localhost"}`, false},
	} {
		if got := hasProjectCredentials(test.path, []byte(test.content)); got != test.secret {
			t.Fatalf("%s detection=%v", test.path, got)
		}
	}
}
