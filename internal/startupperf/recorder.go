// Package startupperf records local startup timing samples independently from
// the rotating Dev Log. Samples contain durations only: no workspace content,
// identifiers, network calls, or telemetry.
package startupperf

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const Filename = "startup-performance.jsonl"

var recordMu sync.Mutex

type Sample struct {
	RecordedAt string             `json:"recordedAt"`
	Frontend   map[string]float64 `json:"frontend"`
	Backend    map[string]any     `json:"backend"`
}

func Record(dataDir, frontendJSON string, backend map[string]any) error {
	var frontend map[string]float64
	if err := json.Unmarshal([]byte(frontendJSON), &frontend); err != nil {
		return fmt.Errorf("invalid frontend startup sample: %w", err)
	}
	if frontend == nil {
		frontend = map[string]float64{}
	}

	recordMu.Lock()
	defer recordMu.Unlock()

	if err := os.MkdirAll(dataDir, 0700); err != nil {
		return fmt.Errorf("create startup performance directory: %w", err)
	}
	file, err := os.OpenFile(filepath.Join(dataDir, Filename), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		return fmt.Errorf("open startup performance samples: %w", err)
	}
	defer file.Close()

	sample := Sample{
		RecordedAt: time.Now().UTC().Format(time.RFC3339Nano),
		Frontend:   frontend,
		Backend:    backend,
	}
	if err := json.NewEncoder(file).Encode(sample); err != nil {
		return fmt.Errorf("write startup performance sample: %w", err)
	}
	return nil
}
