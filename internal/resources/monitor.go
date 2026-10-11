package resources

import (
	"context"
	"os"
	"runtime"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/process"
)

type Target struct {
	PID       int    `json:"pid"`
	Name      string `json:"name"`
	Workspace string `json:"workspace"`
}
type Usage struct {
	Target
	RAM   uint64   `json:"ram"`
	CPU   *float64 `json:"cpu"`
	Error string   `json:"error,omitempty"`
}
type Snapshot struct {
	At        time.Time `json:"at"`
	Processes []Usage   `json:"processes"`
	RAM       uint64    `json:"ram"`
	CPU       float64   `json:"cpu"`
	Instances int       `json:"instances"`
}
type previous struct {
	at      time.Time
	cpu     float64
	created int64
}

var sampler = struct {
	sync.Mutex
	last   map[int32]previous
	cached Snapshot
}{last: make(map[int32]previous)}

// Sample reads only this application and its descendants; nothing is transmitted or persisted.
// CPU is normalized to all logical CPUs, from the delta between samples.
func Sample(targets []Target) Snapshot {
	sampler.Lock()
	defer sampler.Unlock()
	now := time.Now()
	if !sampler.cached.At.IsZero() && now.Sub(sampler.cached.At) < time.Second {
		return sampler.cached
	}
	ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()
	root, err := process.NewProcessWithContext(ctx, int32(os.Getpid()))
	result := Snapshot{At: now, Processes: []Usage{}}
	if err != nil {
		return result
	}
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
		if visited[p.Pid] || depth > 16 || len(visited) >= 256 {
			return
		}
		visited[p.Pid] = true
		target, ok := known[p.Pid]
		if !ok {
			target = inherited
			target.PID = int(p.Pid)
			if name, e := p.NameWithContext(ctx); e == nil {
				target.Name = name
			}
		}
		usage := Usage{Target: target}
		memory, e := p.MemoryInfoWithContext(ctx)
		if e == nil {
			usage.RAM = memory.RSS
			result.RAM += memory.RSS
		} else {
			usage.Error = "Memory unavailable"
		}
		times, e := p.TimesWithContext(ctx)
		created, createErr := p.CreateTimeWithContext(ctx)
		if e == nil && createErr == nil {
			total := times.User + times.System
			if old, found := sampler.last[p.Pid]; found && old.created == created && total >= old.cpu && now.After(old.at) {
				cpu := (total - old.cpu) / now.Sub(old.at).Seconds() * 100 / float64(runtime.NumCPU())
				usage.CPU = &cpu
				result.CPU += cpu
			}
			next[p.Pid] = previous{now, total, created}
		}
		if _, explicit := known[p.Pid]; explicit {
			result.Instances++
		}
		result.Processes = append(result.Processes, usage)
		children, _ := p.ChildrenWithContext(ctx)
		for _, child := range children {
			walk(child, target, depth+1)
		}
	}
	walk(root, Target{Name: "adOmnia"}, 0)
	sampler.last = next
	sampler.cached = result
	return result
}
