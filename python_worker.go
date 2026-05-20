package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	pb "adomnia/proto/worker"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

type WorkerLimits struct {
	TimeoutMs  int64 `json:"timeout_ms"`
	MemoryMB   int   `json:"memory_mb"`
	MaxWorkers int   `json:"max_workers"`
}

type WorkerState string

const (
	WorkerStateStarting WorkerState = "starting"
	WorkerStateReady    WorkerState = "ready"
	WorkerStateRunning  WorkerState = "running"
	WorkerStateStopping WorkerState = "stopping"
	WorkerStateDead     WorkerState = "dead"
)

type PythonWorker struct {
	PluginID  string      `json:"plugin_id"`
	State     WorkerState `json:"state"`
	Port      int         `json:"port"`
	PID       int         `json:"pid"`
	StartedAt time.Time   `json:"started_at"`
	LastUsed  time.Time   `json:"last_used"`

	cmd    *exec.Cmd
	conn   *grpc.ClientConn
	client pb.WorkerServiceClient
	cancel context.CancelFunc
}

type PythonWorkerManager struct {
	mu      sync.RWMutex
	workers map[string]*PythonWorker
	limits  WorkerLimits
	sdkPort int
}

func NewPythonWorkerManager() *PythonWorkerManager {
	return &PythonWorkerManager{
		workers: make(map[string]*PythonWorker),
		limits: WorkerLimits{
			TimeoutMs:  30000,
			MemoryMB:   256,
			MaxWorkers: 4,
		},
	}
}

func (m *PythonWorkerManager) SetSDKPort(port int) {
	m.sdkPort = port
}

func (m *PythonWorkerManager) GetWorkerStatus() []map[string]interface{} {
	m.mu.RLock()
	defer m.mu.RUnlock()

	result := make([]map[string]interface{}, 0, len(m.workers))
	for _, w := range m.workers {
		result = append(result, map[string]interface{}{
			"plugin_id":  w.PluginID,
			"state":      w.State,
			"port":       w.Port,
			"pid":        w.PID,
			"started_at": w.StartedAt.Format(time.RFC3339),
			"last_used":  w.LastUsed.Format(time.RFC3339),
		})
	}
	return result
}

func (m *PythonWorkerManager) GetLimits() WorkerLimits {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.limits
}

func (m *PythonWorkerManager) SetLimits(limits WorkerLimits) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if limits.TimeoutMs > 0 {
		m.limits.TimeoutMs = limits.TimeoutMs
	}
	if limits.MemoryMB > 0 {
		m.limits.MemoryMB = limits.MemoryMB
	}
	if limits.MaxWorkers > 0 {
		m.limits.MaxWorkers = limits.MaxWorkers
	}
}

func (m *PythonWorkerManager) SpawnWorker(pluginID string, config map[string]string) error {
	m.mu.Lock()

	if _, exists := m.workers[pluginID]; exists {
		m.mu.Unlock()
		return fmt.Errorf("worker already exists for plugin: %s", pluginID)
	}

	activeCount := 0
	for _, w := range m.workers {
		if w.State != WorkerStateDead {
			activeCount++
		}
	}
	if activeCount >= m.limits.MaxWorkers {
		m.mu.Unlock()
		return fmt.Errorf("max workers reached (%d), cannot spawn new worker", m.limits.MaxWorkers)
	}

	worker := &PythonWorker{
		PluginID:  pluginID,
		State:     WorkerStateStarting,
		StartedAt: time.Now(),
		LastUsed:  time.Now(),
	}
	m.workers[pluginID] = worker
	m.mu.Unlock()

	if err := m.startWorkerProcess(worker, pluginID, config); err != nil {
		m.mu.Lock()
		worker.State = WorkerStateDead
		m.mu.Unlock()
		return fmt.Errorf("failed to spawn worker for %s: %w", pluginID, err)
	}

	return nil
}

func (m *PythonWorkerManager) startWorkerProcess(worker *PythonWorker, pluginID string, config map[string]string) error {
	port, err := getFreePort()
	if err != nil {
		return fmt.Errorf("failed to get free port: %w", err)
	}

	pythonPath := m.getPythonPath()
	if pythonPath == "" {
		return fmt.Errorf("python runtime not found")
	}

	pluginDir := filepath.Join(dataDir(), "plugins", pluginID)
	entrypoint := filepath.Join(pluginDir, "main.py")

	if _, err := os.Stat(entrypoint); os.IsNotExist(err) {
		return fmt.Errorf("plugin entrypoint not found: %s", entrypoint)
	}

	dataPath := filepath.Join(pluginDir, "data")
	os.MkdirAll(dataPath, 0755)

	ctx, cancel := context.WithCancel(context.Background())
	worker.cancel = cancel

	cmd := exec.CommandContext(ctx, pythonPath, entrypoint)
	cmd.Env = append(os.Environ(),
		fmt.Sprintf("ADOMNIA_GRPC_PORT=%d", port),
		fmt.Sprintf("ADOMNIA_SDK_PORT=%d", m.sdkPort),
		fmt.Sprintf("ADOMNIA_PLUGIN_ID=%s", pluginID),
		fmt.Sprintf("ADOMNIA_DATA_DIR=%s", dataPath),
	)
	cmd.Dir = pluginDir

	cmd.Stdout = log.Writer()
	cmd.Stderr = log.Writer()

	if err := cmd.Start(); err != nil {
		cancel()
		return fmt.Errorf("failed to start python process: %w", err)
	}

	worker.cmd = cmd
	worker.Port = port
	worker.PID = cmd.Process.Pid

	// Enforce OS-level memory limits on the spawned process
	enforceWorkerMemoryLimit(cmd, m.limits.MemoryMB)

	go func() {
		cmd.Wait()
		m.mu.Lock()
		worker.State = WorkerStateDead
		m.mu.Unlock()
		log.Printf("[python-worker] worker %s (pid=%d) exited", pluginID, worker.PID)
	}()

	if err := m.waitForWorkerReady(worker, 10*time.Second); err != nil {
		m.killWorker(worker)
		return fmt.Errorf("worker failed to become ready: %w", err)
	}

	configJSON, _ := json.Marshal(config)
	initReq := &pb.InitRequest{
		PluginId:      pluginID,
		PluginVersion: "1.0.0",
		Config:        config,
		DataDir:       dataPath,
	}
	_ = configJSON

	initCtx, initCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer initCancel()

	resp, err := worker.client.Init(initCtx, initReq)
	if err != nil {
		m.killWorker(worker)
		return fmt.Errorf("worker Init failed: %w", err)
	}
	if !resp.Ready {
		m.killWorker(worker)
		return fmt.Errorf("worker Init returned not ready: %s", resp.Error)
	}

	m.mu.Lock()
	worker.State = WorkerStateReady
	m.mu.Unlock()

	log.Printf("[python-worker] worker %s ready (pid=%d, port=%d)", pluginID, worker.PID, worker.Port)
	return nil
}

func (m *PythonWorkerManager) waitForWorkerReady(worker *PythonWorker, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	addr := fmt.Sprintf("localhost:%d", worker.Port)

	for time.Now().Before(deadline) {
		conn, err := grpc.Dial(addr, grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithBlock(), grpc.WithTimeout(500*time.Millisecond))
		if err == nil {
			worker.conn = conn
			worker.client = pb.NewWorkerServiceClient(conn)

			pingCtx, pingCancel := context.WithTimeout(context.Background(), 2*time.Second)
			_, pingErr := worker.client.Ping(pingCtx, &pb.PingRequest{})
			pingCancel()

			if pingErr == nil {
				return nil
			}
			conn.Close()
		}
		time.Sleep(200 * time.Millisecond)
	}

	return fmt.Errorf("worker did not respond on %s within %s", addr, timeout)
}

func (m *PythonWorkerManager) Execute(pluginID string, action string, payload []byte) ([]byte, error) {
	m.mu.RLock()
	worker, exists := m.workers[pluginID]
	m.mu.RUnlock()

	if !exists {
		return nil, fmt.Errorf("no worker for plugin: %s", pluginID)
	}
	if worker.State != WorkerStateReady {
		return nil, fmt.Errorf("worker %s not ready (state=%s)", pluginID, worker.State)
	}

	m.mu.Lock()
	worker.State = WorkerStateRunning
	worker.LastUsed = time.Now()
	m.mu.Unlock()

	defer func() {
		m.mu.Lock()
		if worker.State == WorkerStateRunning {
			worker.State = WorkerStateReady
		}
		m.mu.Unlock()
	}()

	timeout := time.Duration(m.limits.TimeoutMs) * time.Millisecond
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	resp, err := worker.client.Execute(ctx, &pb.ExecuteRequest{
		Action:  action,
		Payload: payload,
	})
	if err != nil {
		return nil, fmt.Errorf("execute failed: %w", err)
	}
	if !resp.Success {
		return nil, fmt.Errorf("execute error: %s", resp.Error)
	}

	return resp.Result, nil
}

type StreamChunk struct {
	Data    []byte `json:"data"`
	IsFinal bool   `json:"is_final"`
	Error   string `json:"error,omitempty"`
}

func (m *PythonWorkerManager) ExecuteStream(pluginID string, action string, payload []byte, onChunk func(StreamChunk)) error {
	m.mu.RLock()
	worker, exists := m.workers[pluginID]
	m.mu.RUnlock()

	if !exists {
		return fmt.Errorf("no worker for plugin: %s", pluginID)
	}
	if worker.State != WorkerStateReady {
		return fmt.Errorf("worker %s not ready (state=%s)", pluginID, worker.State)
	}

	m.mu.Lock()
	worker.State = WorkerStateRunning
	worker.LastUsed = time.Now()
	m.mu.Unlock()

	defer func() {
		m.mu.Lock()
		if worker.State == WorkerStateRunning {
			worker.State = WorkerStateReady
		}
		m.mu.Unlock()
	}()

	timeout := time.Duration(m.limits.TimeoutMs) * time.Millisecond
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	stream, err := worker.client.ExecuteStream(ctx, &pb.ExecuteRequest{
		Action:  action,
		Payload: payload,
	})
	if err != nil {
		return fmt.Errorf("execute stream failed: %w", err)
	}

	for {
		chunk, err := stream.Recv()
		if err != nil {
			return fmt.Errorf("stream recv error: %w", err)
		}

		onChunk(StreamChunk{
			Data:    chunk.Data,
			IsFinal: chunk.IsFinal,
			Error:   chunk.Error,
		})

		if chunk.IsFinal {
			break
		}
	}

	return nil
}

func (m *PythonWorkerManager) StopWorker(pluginID string) error {
	m.mu.Lock()
	worker, exists := m.workers[pluginID]
	if !exists {
		m.mu.Unlock()
		return fmt.Errorf("no worker for plugin: %s", pluginID)
	}
	worker.State = WorkerStateStopping
	m.mu.Unlock()

	if worker.client != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		worker.client.Shutdown(ctx, &pb.ShutdownRequest{GracePeriodMs: 5000})
		cancel()
	}

	time.Sleep(500 * time.Millisecond)
	m.killWorker(worker)

	m.mu.Lock()
	delete(m.workers, pluginID)
	m.mu.Unlock()

	log.Printf("[python-worker] worker %s stopped", pluginID)
	return nil
}

func (m *PythonWorkerManager) StopAll() {
	m.mu.RLock()
	ids := make([]string, 0, len(m.workers))
	for id := range m.workers {
		ids = append(ids, id)
	}
	m.mu.RUnlock()

	for _, id := range ids {
		m.StopWorker(id)
	}
}

func (m *PythonWorkerManager) killWorker(worker *PythonWorker) {
	if worker.cancel != nil {
		worker.cancel()
	}
	if worker.conn != nil {
		worker.conn.Close()
	}
	if worker.cmd != nil && worker.cmd.Process != nil {
		worker.cmd.Process.Kill()
	}
	worker.State = WorkerStateDead
}

func (m *PythonWorkerManager) CleanIdleWorkers(maxIdle time.Duration) {
	m.mu.RLock()
	var toStop []string
	for id, w := range m.workers {
		if w.State == WorkerStateReady && time.Since(w.LastUsed) > maxIdle {
			toStop = append(toStop, id)
		}
	}
	m.mu.RUnlock()

	for _, id := range toStop {
		log.Printf("[python-worker] stopping idle worker: %s", id)
		m.StopWorker(id)
	}
}

func (m *PythonWorkerManager) StartIdleReaper(interval time.Duration, maxIdle time.Duration) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for range ticker.C {
			m.CleanIdleWorkers(maxIdle)
		}
	}()
}

func (m *PythonWorkerManager) getPythonPath() string {
	embedded := filepath.Join(dataDir(), "python-runtime", "python.exe")
	if _, err := os.Stat(embedded); err == nil {
		return embedded
	}

	embedded = filepath.Join(dataDir(), "python-runtime", "python3")
	if _, err := os.Stat(embedded); err == nil {
		return embedded
	}

	if path, err := exec.LookPath("python3"); err == nil {
		return path
	}
	if path, err := exec.LookPath("python"); err == nil {
		return path
	}

	return ""
}

func (m *PythonWorkerManager) GetPythonRuntimeStatus() map[string]interface{} {
	pythonPath := m.getPythonPath()
	status := map[string]interface{}{
		"available": pythonPath != "",
		"path":      pythonPath,
		"embedded":  false,
	}

	if pythonPath != "" {
		embeddedDir := filepath.Join(dataDir(), "python-runtime")
		if _, err := os.Stat(filepath.Join(embeddedDir, ".version")); err == nil {
			status["embedded"] = true
			if ver, err := os.ReadFile(filepath.Join(embeddedDir, ".version")); err == nil {
				status["version"] = string(ver)
			}
		} else {
			out, err := exec.Command(pythonPath, "--version").Output()
			if err == nil {
				status["version"] = string(out)
			}
		}
	}

	return status
}

func getFreePort() (int, error) {
	addr, err := net.ResolveTCPAddr("tcp", "localhost:0")
	if err != nil {
		return 0, err
	}
	l, err := net.ListenTCP("tcp", addr)
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}
