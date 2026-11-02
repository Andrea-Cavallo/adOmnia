//go:build windows

package update

import (
	"errors"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows/registry"
)

// uninstallKey is written by build/windows/installer/adomnia.nsi (per-user, HKCU).
const uninstallKey = `Software\Microsoft\Windows\CurrentVersion\Uninstall\adOmnia`

// registeredInstall reports whether exe is the copy the setup installed.
func registeredInstall(exe string) bool {
	k, err := registry.OpenKey(registry.CURRENT_USER, uninstallKey, registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	defer k.Close()
	location, _, err := k.GetStringValue("InstallLocation")
	return err == nil && location != "" && samePath(location, filepath.Dir(exe))
}

// syncInstallRecord keeps "Installed apps" on the version the in-app updater installed.
func syncInstallRecord(exe, version string) error {
	if !registeredInstall(exe) {
		return nil
	}
	k, err := registry.OpenKey(registry.CURRENT_USER, uninstallKey, registry.QUERY_VALUE|registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	want := strings.TrimPrefix(version, "v")
	current, _, err := k.GetStringValue("DisplayVersion")
	if err != nil && !errors.Is(err, registry.ErrNotExist) {
		return err
	}
	if current == want {
		return nil
	}
	return k.SetStringValue("DisplayVersion", want)
}
