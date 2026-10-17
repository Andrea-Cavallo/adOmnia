package eclipsepde

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTargetSettingsRoundTrip(t *testing.T) {
	root := t.TempDir()
	tp := NewTargetPlatform()
	if err := tp.Add(TargetProfile{
		Name: "eclipse-kepler-custom", Kind: TargetLocalDirectory,
		Path: "C:/development/eclipse-target", ExecutionEnvironment: "JavaSE-1.6", Offline: true,
	}); err != nil {
		t.Fatal(err)
	}
	if err := tp.Add(TargetProfile{Name: "second", Kind: TargetEclipseInstall, Path: "/opt/eclipse/plugins"}); err != nil {
		t.Fatal(err)
	}
	if err := tp.SetActive("eclipse-kepler-custom"); err != nil {
		t.Fatal(err)
	}

	if err := SaveTargetSettings(root, tp.ToSettings()); err != nil {
		t.Fatal(err)
	}

	// The file lives in .adomnia/ and is self-describing.
	data, err := os.ReadFile(filepath.Join(root, ".adomnia", "eclipse-target.json"))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`"format": "adomnia-eclipse-target"`, `"version": 1`, `"active": "eclipse-kepler-custom"`, "JavaSE-1.6"} {
		if !strings.Contains(string(data), want) {
			t.Errorf("settings file missing %s:\n%s", want, data)
		}
	}

	// A fresh manager reads back the same state.
	restored := NewTargetPlatform()
	settings, err := LoadTargetSettings(root)
	if err != nil {
		t.Fatal(err)
	}
	restored.LoadFromSettings(settings)
	if len(restored.Profiles) != 2 || restored.Active != "eclipse-kepler-custom" {
		t.Errorf("restored = %+v", restored)
	}
	profile, ok := restored.ActiveProfile()
	if !ok || !profile.Offline || profile.ExecutionEnvironment != "JavaSE-1.6" {
		t.Errorf("active = %+v", profile)
	}

	// Idempotent: saving the restored state writes the same file.
	before := string(data)
	if err := SaveTargetSettings(root, restored.ToSettings()); err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile(filepath.Join(root, ".adomnia", "eclipse-target.json"))
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != before {
		t.Errorf("round trip is not stable:\n%s\n---\n%s", before, after)
	}
}

func TestLoadTargetSettingsMissingFile(t *testing.T) {
	settings, err := LoadTargetSettings(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if len(settings.Profiles) != 0 || settings.Active != "" {
		t.Errorf("settings = %+v", settings)
	}
}

func TestLoadTargetSettingsRejectsGarbage(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, ".adomnia"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".adomnia", "eclipse-target.json"), []byte("not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadTargetSettings(root); err == nil {
		t.Error("expected an error for malformed settings")
	}
}
