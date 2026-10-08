package main

import "adomnia/internal/update"

// Version is declared in main.go and injected at build time via
// -ldflags "-X main.Version=v0.4.2". It defaults to "dev", where update
// checks are skipped.

// GetAppVersion returns the embedded build version (or "dev").
func (a *App) GetAppVersion() string {
	return Version
}

// CheckForUpdate queries the latest GitHub release after an explicit user action.
func (a *App) CheckForUpdate() (update.UpdateInfo, error) {
	return update.Check(Version)
}
