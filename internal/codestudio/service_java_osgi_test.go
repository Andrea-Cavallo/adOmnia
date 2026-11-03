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

func TestJavaOsgiP2NeedsTrustAndConfirmation(t *testing.T) {
	root := t.TempDir()
	service := NewService(&memoryStore{}, nil)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	id := string(session.ID)
	if _, err := service.PreviewJavaOsgiP2(id); err == nil {
		t.Fatal("an untrusted project must not read its .target")
	}
	if _, err := service.ReindexJavaOsgiTarget(id); err == nil {
		t.Fatal("an untrusted project must not index its target")
	}
	if _, err := service.SetToolAuthorization(id, true); err != nil {
		t.Fatal(err)
	}
	if _, err := service.DownloadJavaOsgiP2(id, false); err == nil {
		t.Fatal("a download without confirmation must be refused")
	}
	// A folder target has no p2 location to download.
	if _, err := service.SetJavaOsgiTarget(id, t.TempDir()); err != nil {
		t.Fatal(err)
	}
	if _, err := service.DownloadJavaOsgiP2(id, true); err == nil {
		t.Fatal("a folder target has nothing to download from p2")
	}
	if _, err := service.ReindexJavaOsgiTarget(id); err != nil {
		t.Fatal(err)
	}
	service.CancelJavaOsgiP2(id) // no download running: a no-op
}
