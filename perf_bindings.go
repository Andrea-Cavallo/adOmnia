package main

import (
	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
	"github.com/Andrea-Cavallo/adOmnia/internal/perf"
)

// PerfRecordingStatus reports the active scenario recording as local JSON:
// {"active":bool,"scenario":string,"path":string}. Used by the renderer to
// enable input-latency capture only while a baseline scenario is recorded.
func (a *App) PerfRecordingStatus() string {
	status := map[string]any{"active": false}
	if recorder := perf.Current(); recorder != nil && recorder.Active() {
		status = map[string]any{"active": true, "scenario": recorder.Scenario(), "path": recorder.Path()}
	}
	raw, _ := jsonutil.Marshal(status)
	return string(raw)
}

// PerfPushFrontendMetrics receives renderer-side metrics as a JSON object and
// merges them into the following scenario samples. No-op without an active
// recording; malformed payloads are ignored.
func (a *App) PerfPushFrontendMetrics(metricsJSON string) {
	perf.SetFrontendMetricsJSON(metricsJSON)
}
