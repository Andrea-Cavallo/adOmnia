//go:build !windows

package update

// Only Windows has a setup.exe; other platforms install a bundle, a tarball or a package.
func registeredInstall(string) bool { return false }

func syncInstallRecord(string, string) error { return nil }
