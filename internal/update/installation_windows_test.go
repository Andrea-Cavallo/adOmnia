package update

import (
	"path/filepath"
	"testing"

	"golang.org/x/sys/windows/registry"
)

func TestInstalledVersionBelongsToRegisteredExecutable(t *testing.T) {
	dir := t.TempDir()
	path := `Software\adOmniaInstallerTests\` + filepath.Base(filepath.Dir(dir))
	key, _, err := registry.CreateKey(registry.CURRENT_USER, path, registry.ALL_ACCESS|registry.WOW64_32KEY)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { key.Close(); _ = registry.DeleteKey(registry.CURRENT_USER, path) }()
	if err := key.SetStringValue("InstallLocation", dir); err != nil {
		t.Fatal(err)
	}
	if err := key.SetStringValue("DisplayVersion", "1.0.0"); err != nil {
		t.Fatal(err)
	}
	for _, current := range []string{"dev", "123abcd"} {
		if err := syncInstallationMetadata(filepath.Join(dir, "adomnia.exe"), current, path); err != nil {
			t.Fatal(err)
		}
	}
	if err := syncInstallationMetadata(filepath.Join(dir, "portable", "adomnia.exe"), "v2.0.0", path); err != nil {
		t.Fatal(err)
	}
	got, _, _ := key.GetStringValue("DisplayVersion")
	if got != "1.0.0" {
		t.Fatalf("portable/dev build changed installed version: %s", got)
	}
	if err := syncInstallationMetadata(filepath.Join(dir, "adomnia.exe"), "v1.2.3", path); err != nil {
		t.Fatal(err)
	}
	got, _, _ = key.GetStringValue("DisplayVersion")
	if got != "1.2.3" {
		t.Fatalf("installed version not synchronized: %s", got)
	}
}
