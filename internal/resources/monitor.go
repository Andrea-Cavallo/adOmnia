package resources

import (
	"context"
	"os"
	"reflect"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/process"
)

type Target struct {
	PID         int    `json:"pid"`
	Name        string `json:"name"`
	Workspace   string `json:"workspace"`
	SessionID   string `json:"sessionId,omitempty"`
	Role        string `json:"role,omitempty"`
	Owner       string `json:"owner,omitempty"`
	MemoryLimit string `json:"memoryLimit,omitempty"`
}
type Usage struct {
	Target
	RAM                uint64   `json:"ram"`
	CPU                *float64 `json:"cpu"`
	Error              string   `json:"error,omitempty"`
	ParentPID          int      `json:"parentPid"`
	ParentName         string   `json:"parentName,omitempty"`
	CreatedAt          int64    `json:"createdAt"`
	Executable         string   `json:"executable,omitempty"`
	Attribution        string   `json:"attribution"`
	CPUSeconds         float64  `json:"cpuSeconds"`
	CPUIntervalSeconds float64  `json:"cpuIntervalSeconds"`
}
type Snapshot struct {
	Budget       *BudgetStatus `json:"budget,omitempty"`
	At           time.Time     `json:"at"`
	Processes    []Usage       `json:"processes"`
	RAM          uint64        `json:"ram"`
	CPU          float64       `json:"cpu"`
	CPUComplete  bool          `json:"cpuComplete"`
	Instances    int           `json:"instances"`
	LogicalCores int           `json:"logicalCores"`
	RootPID      int           `json:"rootPid"`
	Runtime      GoRuntime     `json:"runtime"`
	Incomplete   bool          `json:"incomplete"`
	Warnings     []string      `json:"warnings,omitempty"`
}

// processInfo è una riga della tabella dei processi: padre e nome dell'eseguibile.
type processInfo struct {
	parent int32
	name   string
}

// sampleTimeout limita la lettura di un campione.
const sampleTimeout = 1500 * time.Millisecond

// childrenOf indicizza la tabella per padre, così l'albero si percorre senza altre enumerazioni.
func childrenOf(table map[int32]processInfo) map[int32][]int32 {
	children := map[int32][]int32{}
	for pid, info := range table {
		if pid != info.parent {
			children[info.parent] = append(children[info.parent], pid)
		}
	}
	return children
}

type previous struct {
	at         time.Time
	cpu        float64
	created    int64
	executable string
	role       string
}

var sampler = struct {
	sync.Mutex
	last    map[int32]previous
	cached  Snapshot
	targets []Target
}{last: make(map[int32]previous)}

// Sample reads only this application and its descendants; nothing is transmitted or persisted.
// CPU is normalized to all logical CPUs, from the delta between samples.
func Sample(targets []Target) Snapshot {
	sampler.Lock()
	defer sampler.Unlock()
	now := time.Now()
	if !sampler.cached.At.IsZero() && now.Sub(sampler.cached.At) < time.Second && reflect.DeepEqual(targets, sampler.targets) {
		return sampler.cached
	}
	ctx, cancel := context.WithTimeout(context.Background(), sampleTimeout)
	defer cancel()
	root, err := process.NewProcessWithContext(ctx, int32(os.Getpid()))
	result := Snapshot{At: now, Processes: []Usage{}, RootPID: os.Getpid(), LogicalCores: runtime.NumCPU(), Runtime: RuntimeSnapshot()}
	if err != nil {
		result.Incomplete = true
		result.Warnings = append(result.Warnings, "Root process unavailable")
		return result
	}
	table, err := processTable()
	if err != nil {
		table = map[int32]processInfo{}
		result.Incomplete = true
		result.Warnings = append(result.Warnings, "Process table unavailable: descendants may be missing")
	}
	children := childrenOf(table)
	known := make(map[int32]Target)
	for _, target := range targets {
		if target.PID > 0 {
			known[int32(target.PID)] = target
		}
	}
	visited := make(map[int32]bool)
	next := make(map[int32]previous)
	var walk func(*process.Process, Target, int)
	walk = func(p *process.Process, inherited Target, depth int) {
		if visited[p.Pid] {
			return
		}
		if depth > 16 || len(visited) >= 256 || ctx.Err() != nil {
			result.Incomplete = true
			return
		}
		visited[p.Pid] = true
		target, ok := known[p.Pid]
		if !ok {
			target = inherited
			target.Role = ""
			target.MemoryLimit = ""
			target.PID = int(p.Pid)
			if info, found := table[p.Pid]; found && info.name != "" {
				target.Name = info.name
			}
		}
		usage := Usage{Target: target}
		info := table[p.Pid]
		usage.ParentPID = int(info.parent)
		usage.ParentName = table[info.parent].name
		usage.Attribution = "observed-parent"
		if ok {
			usage.Attribution = "managed-session"
		}
		if p.Pid == root.Pid {
			usage.Attribution = "application-root"
		}
		memory, e := p.MemoryInfoWithContext(ctx)
		if e == nil {
			usage.RAM = memory.RSS
			result.RAM += memory.RSS
		} else {
			usage.Error = "Memory unavailable"
			result.Incomplete = true
		}
		times, e := p.TimesWithContext(ctx)
		created, createErr := p.CreateTimeWithContext(ctx)
		usage.CreatedAt = created
		old, same := sampler.last[p.Pid]
		if same && old.created == created && createErr == nil {
			usage.Executable, usage.Role = old.executable, old.role
		} else {
			usage.Executable, _ = p.ExeWithContext(ctx)
			usage.Role = processRole(target.Name)
			// Only retain the allowlisted WebView role, never arbitrary arguments or environment.
			if strings.Contains(strings.ToLower(target.Name), "msedgewebview2") {
				command, _ := p.CmdlineWithContext(ctx)
				for _, role := range []string{"renderer", "gpu-process", "utility", "crashpad-handler"} {
					if strings.Contains(command, "--type="+role) {
						usage.Role = "WebView2 / " + role
						break
					}
				}
			}
		}
		if target.Role != "" {
			usage.Role = target.Role
		}
		if p.Pid == root.Pid {
			usage.Role = "backend"
		}
		if e == nil && createErr == nil {
			total := times.User + times.System
			usage.CPUSeconds = total
			if old, found := sampler.last[p.Pid]; found && old.created == created && total >= old.cpu && now.After(old.at) {
				usage.CPUIntervalSeconds = now.Sub(old.at).Seconds()
				cpu := (total - old.cpu) / usage.CPUIntervalSeconds * 100 / float64(runtime.NumCPU())
				usage.CPU = &cpu
				result.CPU += cpu
			}
			next[p.Pid] = previous{at: now, cpu: total, created: created, executable: usage.Executable, role: usage.Role}
		}
		if _, explicit := known[p.Pid]; explicit && target.Role == "language-server" {
			result.Instances++
		}
		result.Processes = append(result.Processes, usage)
		for _, pid := range children[p.Pid] {
			if child, err := process.NewProcessWithContext(ctx, pid); err == nil {
				walk(child, target, depth+1)
			} else {
				result.Incomplete = true
			}
		}
	}
	walk(root, Target{Name: "adOmnia", Owner: "adOmnia backend", Role: "backend"}, 0)
	result.CPUComplete = len(result.Processes) > 0
	for _, p := range result.Processes {
		if p.CPU == nil {
			result.CPUComplete = false
		}
	}
	if result.Incomplete && len(result.Warnings) == 0 {
		result.Warnings = append(result.Warnings, "Some processes exited, were unreadable, or exceeded collection limits (256 processes, depth 16, 1.5 s)")
	}
	sampler.last = next
	sampler.cached = result
	sampler.targets = append([]Target(nil), targets...)
	return result
}

func processRole(name string) string {
	name = strings.ToLower(name)
	switch {
	case strings.Contains(name, "msedgewebview2"):
		return "WebView2 / browser"
	case strings.Contains(name, "gopls"):
		return "language-server"
	case strings.Contains(name, "dlv"):
		return "debug-adapter"
	case strings.Contains(name, "copilot-language-server"):
		return "Copilot language server"
	case strings.Contains(name, "conhost"):
		return "Windows console host"
	default:
		return "child-process"
	}
}
