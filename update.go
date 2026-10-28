package main

import (
	"github.com/Andrea-Cavallo/adOmnia/internal/devlog"
	"github.com/Andrea-Cavallo/adOmnia/internal/update"
	"path/filepath"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
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

// confirmUpdateWhenWindowReady conferma un aggiornamento appena il runtime della finestra principale è
// caricato: exe, WebView2 e frontend funzionano. Non dipende dal caricamento del workspace, che su progetti
// grandi o con dialog all'avvio poteva superare il tempo concesso dall'helper e causare il rollback.
func confirmUpdateWhenWindowReady(window *application.WebviewWindow) {
	window.OnWindowEvent(events.Common.WindowRuntimeReady, func(*application.WindowEvent) {
		if err := update.ConfirmStartup(Version); err != nil {
			devlog.Err("UpdateConfirm", "updated app could not confirm its startup", err, map[string]any{"version": Version})
		}
	})
}
func (a *App) OpenUpdateApplyLog() error {
	return update.OpenApplyLog(filepath.Join(dataDir(), "adomnia", "updates"))
}

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
