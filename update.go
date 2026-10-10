package main

import (
	"adomnia/internal/update"
	"path/filepath"
	"sync"
)

var updaterOnce sync.Once
var updaterInstance *update.Manager

func appUpdater() *update.Manager {
	updaterOnce.Do(func() { updaterInstance = update.NewManager(filepath.Join(dataDir(), "adomnia", "updates"), Version) })
	return updaterInstance
}
func (a *App) GetUpdateState() update.State { return appUpdater().Status() }
func (a *App) CheckUpdateChannel(channel string, force bool) (update.State, error) {
	return appUpdater().Check(channel, force)
}
func (a *App) DownloadUpdate() (update.State, error) { return appUpdater().Download() }
func (a *App) CancelUpdateDownload()                 { appUpdater().Cancel() }
func (a *App) ScheduleUpdateOnExit(enable bool) (update.State, error) {
	return appUpdater().Schedule(enable)
}
func (a *App) ConfirmUpdateStartup() error { return update.ConfirmStartup(Version) }

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
