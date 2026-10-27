package main

import (
	"context"
	"fmt"
	"strconv"

	"github.com/Andrea-Cavallo/adOmnia/internal/activity"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func activityWindow(ctx context.Context) (string, error) {
	window, ok := ctx.Value(application.WindowKey).(application.Window)
	if !ok {
		return "", fmt.Errorf("activity requires a desktop window")
	}
	return strconv.FormatUint(uint64(window.ID()), 10), nil
}
func (a *App) ReportActivity(ctx context.Context, state activity.State, scopes []string) (activity.Snapshot, error) {
	window, err := activityWindow(ctx)
	if err != nil {
		return activity.Snapshot{}, err
	}
	return activity.Default.Report(window, state, scopes)
}
func (a *App) RemoveActivity(ctx context.Context) error {
	window, err := activityWindow(ctx)
	if err != nil {
		return err
	}
	activity.Default.RemoveWindow(window)
	return nil
}
func (a *App) ActivitySnapshot() activity.Snapshot { return activity.Default.Snapshot() }
