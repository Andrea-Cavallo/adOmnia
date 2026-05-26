package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// PythonBridge exposes the Python worker system to the frontend via Wails bindings.
// Initialization is lazy: the gRPC SDK server and idle reaper only start when
// the first actual Python operation is requested, avoiding early TCP listeners
// that trigger EDR/antivirus false positives (e.g. Trellix).
type PythonBridge struct {
	ctx       context.Context
	app       *App
	manager   *PythonWorkerManager
	sdkServer *SDKServer
	started   bool
	initMu    sync.Mutex
}

var globalPythonBridge *PythonBridge

func NewPythonBridge() *PythonBridge {
	pb := &PythonBridge{
		manager: NewPythonWorkerManager(),
	}
	globalPythonBridge = pb
	return pb
}

// Init stores the context and app reference for deferred initialization.
// No network listeners or subprocesses are started here.
func (pb *PythonBridge) Init(ctx context.Context, app *App) {
	pb.ctx = ctx
	pb.app = app
	log.Printf("[python-bridge] registered (lazy init, no listeners started)")
}

// ensureStarted performs the actual heavy initialization on first use.
func (pb *PythonBridge) ensureStarted() error {
	pb.initMu.Lock()
	defer pb.initMu.Unlock()

	if pb.started {
		return nil
	}

	if pb.ctx == nil || pb.app == nil {
		return fmt.Errorf("python bridge not registered (Init not called)")
	}

	pb.sdkServer = NewSDKServer(pb.app)
	port, err := pb.sdkServer.Start()
	if err != nil {
		return fmt.Errorf("failed to start SDK server: %w", err)
	}

	pb.manager.SetSDKPort(port)

	pb.sdkServer.SetEventCallback(func(name string, payload []byte) {
		wailsRuntime.EventsEmit(pb.ctx, "plugin:"+name, string(payload))
	})

	pb.manager.StartIdleReaper(30*time.Second, 60*time.Second)
	pb.started = true

	log.Printf("[python-bridge] initialized on-demand (SDK port=%d)", port)
	return nil
}

// Shutdown stops all workers and the SDK server.
func (pb *PythonBridge) Shutdown() {
	if !pb.started {
		return
	}
	pb.manager.StopAll()
	if pb.sdkServer != nil {
		pb.sdkServer.Stop()
	}
}

// --- Wails-exposed methods ---

func (pb *PythonBridge) GetRuntimeStatus() map[string]interface{} {
	return pb.manager.GetPythonRuntimeStatus()
}

func (pb *PythonBridge) GetWorkers() []map[string]interface{} {
	return pb.manager.GetWorkerStatus()
}

func (pb *PythonBridge) GetLimits() WorkerLimits {
	return pb.manager.GetLimits()
}

func (pb *PythonBridge) SetLimits(limitsJSON string) error {
	var limits WorkerLimits
	if err := json.Unmarshal([]byte(limitsJSON), &limits); err != nil {
		return err
	}
	pb.manager.SetLimits(limits)
	return nil
}

func (pb *PythonBridge) SpawnWorker(pluginID string, configJSON string) error {
	if err := pb.ensureStarted(); err != nil {
		return err
	}
	var config map[string]string
	if configJSON != "" {
		json.Unmarshal([]byte(configJSON), &config)
	}
	if config == nil {
		config = map[string]string{}
	}
	return pb.manager.SpawnWorker(pluginID, config)
}

func (pb *PythonBridge) StopWorker(pluginID string) error {
	return pb.manager.StopWorker(pluginID)
}

func (pb *PythonBridge) ensureWorkerReady(pluginID string) error {
	for _, worker := range pb.manager.GetWorkerStatus() {
		if worker["plugin_id"] != pluginID {
			continue
		}
		switch fmt.Sprint(worker["state"]) {
		case string(WorkerStateReady):
			return nil
		case string(WorkerStateDead):
			if err := pb.manager.StopWorker(pluginID); err != nil {
				return err
			}
		default:
			return fmt.Errorf("plugin %s is not ready yet", pluginID)
		}
	}
	return pb.manager.SpawnWorker(pluginID, map[string]string{})
}

func (pb *PythonBridge) Execute(pluginID string, action string, payloadJSON string) (string, error) {
	if err := pb.ensureStarted(); err != nil {
		return "", err
	}
	if err := pb.ensureWorkerReady(pluginID); err != nil {
		return "", err
	}
	result, err := pb.manager.Execute(pluginID, action, []byte(payloadJSON))
	if err != nil {
		return "", err
	}
	return string(result), nil
}

func (pb *PythonBridge) ExecuteStream(pluginID string, action string, payloadJSON string) error {
	if err := pb.ensureStarted(); err != nil {
		return err
	}
	if err := pb.ensureWorkerReady(pluginID); err != nil {
		return err
	}
	return pb.manager.ExecuteStream(pluginID, action, []byte(payloadJSON), func(chunk StreamChunk) {
		if pb.ctx != nil {
			wailsRuntime.EventsEmit(pb.ctx, "plugin:stream:"+pluginID, map[string]interface{}{
				"data":     string(chunk.Data),
				"is_final": chunk.IsFinal,
				"error":    chunk.Error,
			})
		}
	})
}

// RuntimeInfo holds detailed information about the Python runtime for the frontend.
type RuntimeInfo struct {
	Available bool   `json:"available"`
	Path      string `json:"path"`
	Version   string `json:"version"`
	Source    string `json:"source"` // "embedded" or "system"
}

// GetRuntimeInfo returns Python version, path, and whether it's embedded or system.
func (pb *PythonBridge) GetRuntimeInfo() RuntimeInfo {
	status := pb.manager.GetPythonRuntimeStatus()

	available, _ := status["available"].(bool)
	info := RuntimeInfo{
		Available: available,
	}

	if path, ok := status["path"].(string); ok {
		info.Path = path
	}
	if version, ok := status["version"].(string); ok {
		info.Version = strings.TrimSpace(version)
	}
	if embedded, ok := status["embedded"].(bool); ok && embedded {
		info.Source = "embedded"
	} else {
		info.Source = "system"
	}

	return info
}
