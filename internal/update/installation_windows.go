package update

import (
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/mod/semver"
	"golang.org/x/sys/windows/registry"
)

const uninstallRegistryKey = `Software\Microsoft\Windows\CurrentVersion\Uninstall\adOmnia`

func syncInstalledVersion(current string) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	return syncInstallationMetadata(exe, current, uninstallRegistryKey)
}

func syncInstallationMetadata(exe, current, keyPath string) error {
	if !semver.IsValid(normalizeVersion(current)) {
		return nil
	}
	key, err := registry.OpenKey(registry.CURRENT_USER, keyPath, registry.QUERY_VALUE|registry.SET_VALUE|registry.WOW64_32KEY)
	if err == registry.ErrNotExist {
		return nil // Portable copies have no installed-app registration.
	}
	if err != nil {
		return err
	}
	defer key.Close()
	location, _, err := key.GetStringValue("InstallLocation")
	if err != nil || !samePath(exe, filepath.Join(location, "adomnia.exe")) {
		return nil // A portable copy must not change another installation's metadata.
	}
	return key.SetStringValue("DisplayVersion", strings.TrimPrefix(normalizeVersion(current), "v"))
}
