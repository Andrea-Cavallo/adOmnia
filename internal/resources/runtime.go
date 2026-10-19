package resources

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"sync"
)

type GoRuntime struct {
	MemoryLimit   int64   `json:"memoryLimit"`
	HeapAlloc     uint64  `json:"heapAlloc"`
	HeapSys       uint64  `json:"heapSys"`
	NumGC         uint32  `json:"numGC"`
	GCCPUFraction float64 `json:"gcCpuFraction"`
	Goroutines    int     `json:"goroutines"`
}

var runtimeConfig = struct {
	sync.Mutex
	path    string
	initial int64
}{initial: initialMemoryLimit()}

// An explicit GOMEMLIMIT keeps precedence. Otherwise the backend starts with a
// 512 MiB soft GC budget; WebView and language servers have independent memory.
func initialMemoryLimit() int64 {
	if os.Getenv("GOMEMLIMIT") != "" {
		return debug.SetMemoryLimit(-1)
	}
	return 512 << 20
}

// ConfigureRuntime restores only this backend's GC limit. Child environments are untouched.
func ConfigureRuntime(path string) error {
	runtimeConfig.Lock()
	defer runtimeConfig.Unlock()
	runtimeConfig.path = path
	applyMemoryLimit(0)
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	var saved struct {
		MiB int `json:"goMemoryLimitMiB"`
	}
	if err := json.Unmarshal(data, &saved); err != nil {
		return err
	}
	if err := validateMemoryLimit(saved.MiB); err != nil {
		return err
	}
	applyMemoryLimit(saved.MiB)
	return nil
}

func validateMemoryLimit(mib int) error {
	if mib != 0 && (mib < 64 || mib > 65536) {
		return fmt.Errorf("Go memory limit must be 0 (startup default) or 64–65536 MiB")
	}
	return nil
}

func applyMemoryLimit(mib int) {
	limit := runtimeConfig.initial
	if mib != 0 {
		limit = int64(mib) << 20
	}
	debug.SetMemoryLimit(limit)
}

// SetRuntimeMemoryLimit persists before applying; failures leave the active limit unchanged.
// The runtime supports live updates: no application restart or loss of open buffers.
func SetRuntimeMemoryLimit(mib int) (GoRuntime, error) {
	if err := validateMemoryLimit(mib); err != nil {
		return GoRuntime{}, err
	}
	runtimeConfig.Lock()
	defer runtimeConfig.Unlock()
	if runtimeConfig.path == "" {
		return GoRuntime{}, fmt.Errorf("resource settings storage is not configured")
	}
	data, _ := json.Marshal(struct {
		MiB int `json:"goMemoryLimitMiB"`
	}{mib})
	if err := os.MkdirAll(filepath.Dir(runtimeConfig.path), 0700); err != nil {
		return GoRuntime{}, err
	}
	temp := runtimeConfig.path + ".tmp"
	if err := os.WriteFile(temp, data, 0600); err != nil {
		return GoRuntime{}, err
	}
	if err := os.Rename(temp, runtimeConfig.path); err != nil {
		_ = os.Remove(temp)
		return GoRuntime{}, err
	}
	applyMemoryLimit(mib)
	return RuntimeSnapshot(), nil
}

func RuntimeSnapshot() GoRuntime {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	return GoRuntime{MemoryLimit: debug.SetMemoryLimit(-1), HeapAlloc: m.HeapAlloc, HeapSys: m.HeapSys, NumGC: m.NumGC, GCCPUFraction: m.GCCPUFraction, Goroutines: runtime.NumGoroutine()}
}
