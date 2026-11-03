package codestudio

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/eclipsepde"
)

func TestJavaOsgiNeedsTrustThenPersistsTheTarget(t *testing.T) {
	root := t.TempDir()
	target := t.TempDir()
	service := NewService(&memoryStore{}, nil)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	id := string(session.ID)

	if _, err := service.JavaOsgiWorkspace(id); err == nil {
		t.Fatal("an untrusted project must not read the target platform")
	}
	if _, err := service.SetJavaOsgiTarget(id, target); err == nil {
		t.Fatal("an untrusted project must not write the target settings")
	}
	if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(eclipsepde.TargetSettingsFile))); !os.IsNotExist(err) {
		t.Fatalf("settings written for an untrusted project: %v", err)
	}

	if _, err := service.SetToolAuthorization(id, true); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetJavaOsgiTarget(id, target); err != nil {
		t.Fatal(err)
	}
	report, err := service.JavaOsgiWorkspace(id)
	if err != nil {
		t.Fatal(err)
	}
	if !report.HasTarget || report.TargetPath != target {
		t.Fatalf("report = %+v", report)
	}
}
