//go:build !windows

package update

func syncInstalledVersion(string) error { return nil }
