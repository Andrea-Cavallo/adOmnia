package resources

import (
	"fmt"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/mem"
)

const MiB = uint64(1 << 20)

// BudgetGrace is the minimum wait between two releases, and the minimum time a
// server has been running or unused before it may go.
const BudgetGrace = 30 * time.Second

// RecentlyUsedGrace protects the projects the user is going back and forth between:
// releasing one costs a full workspace reload (5-10 s for gopls) on the way back,
// and the next project switch would release another. Only a machine that is really
// short of memory (systemLow) goes below it.
const RecentlyUsedGrace = 10 * time.Minute

// Below lowMemoryPercent of the RAM available the machine is under real pressure,
// whatever adOmnia itself uses; it clears at recoveredMemoryPercent.
const (
	lowMemoryPercent       = 10.0
	recoveredMemoryPercent = 15.0
)

// AvailableMemoryPercent is the RAM the system can still give, 100 if it cannot be read:
// an unknown value must not start releasing servers.
func AvailableMemoryPercent() float64 {
	memory, err := mem.VirtualMemory()
	if err != nil || memory.Total == 0 {
		return 100
	}
	return float64(memory.Available) / float64(memory.Total) * 100
}

// DefaultMemoryBudget is a policy target for the application tree, not an OS
// allocation limit. An explicit local override never changes child GC settings.
func DefaultMemoryBudget() (uint64, error) {
	if value := os.Getenv("ADOMNIA_MEMORY_BUDGET_MIB"); value != "" {
		n, err := strconv.ParseUint(value, 10, 64)
		if err != nil || n < 256 || n > 65536 {
			return 0, fmt.Errorf("ADOMNIA_MEMORY_BUDGET_MIB must be an integer from 256 to 65536")
		}
		return n * MiB, nil
	}
	if memory, err := mem.VirtualMemory(); err == nil {
		return automaticMemoryBudget(memory.Total), nil
	}
	return 1536 * MiB, nil
}

// automaticMemoryBudget is a quarter of the RAM. One gopls costs about 530 MiB per
// project, so five Go projects plus the UI need about 3.5 GiB: at RAM/8 capped to 3 GiB
// they hibernated each other even with tens of GiB free.
func automaticMemoryBudget(total uint64) uint64 {
	return min(16*1024*MiB, max(1024*MiB, total/4))
}

type BudgetStatus struct {
	Target         uint64 `json:"target"`
	RecoveryTarget uint64 `json:"recoveryTarget"`
	Pressure       bool   `json:"pressure"`
	Released       int    `json:"released"`
}

type BudgetCandidate struct {
	ID            string
	Bytes         uint64
	Eligible      bool
	InactiveSince time.Time
	StartedAt     time.Time
}

// MemoryBudget selects one reconstructible resource per pass. Its owner checks
// eligibility again at release time and resamples actual usage before the next.
type MemoryBudget struct {
	mu          sync.Mutex
	status      BudgetStatus
	lastAttempt time.Time
	overTarget  bool
	systemLow   bool
}

func NewMemoryBudget(target uint64) *MemoryBudget {
	return &MemoryBudget{status: BudgetStatus{Target: target, RecoveryTarget: target - target/5}}
}

func (b *MemoryBudget) Choose(now time.Time, used uint64, candidates []BudgetCandidate) *BudgetCandidate {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.status.Target == 0 {
		return nil
	}
	b.observeLocked(used)
	if !b.status.Pressure || (!b.lastAttempt.IsZero() && now.Sub(b.lastAttempt) < BudgetGrace) {
		return nil
	}
	minimumInactivity := RecentlyUsedGrace
	if b.systemLow {
		minimumInactivity = BudgetGrace
	}
	var selected *BudgetCandidate
	for _, candidate := range candidates {
		if !candidate.Eligible || candidate.Bytes == 0 || candidate.InactiveSince.IsZero() || candidate.StartedAt.IsZero() || now.Sub(candidate.InactiveSince) < minimumInactivity || now.Sub(candidate.StartedAt) < BudgetGrace {
			continue
		}
		if selected == nil || candidate.InactiveSince.Before(selected.InactiveSince) || (candidate.InactiveSince.Equal(selected.InactiveSince) && (candidate.Bytes > selected.Bytes || (candidate.Bytes == selected.Bytes && candidate.ID < selected.ID))) {
			copy := candidate
			selected = &copy
		}
	}
	if selected != nil {
		b.lastAttempt = now
	}
	return selected
}

func (b *MemoryBudget) observeLocked(used uint64) {
	if b.status.Target == 0 {
		b.status.Pressure = false
		return
	}
	if used > b.status.Target {
		b.overTarget = true
	} else if used <= b.status.RecoveryTarget {
		b.overTarget = false
	}
	b.status.Pressure = b.overTarget || b.systemLow
}

// ObserveSystem records how much RAM the machine has left, with hysteresis.
func (b *MemoryBudget) ObserveSystem(availablePercent float64) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if availablePercent < lowMemoryPercent {
		b.systemLow = true
	} else if availablePercent >= recoveredMemoryPercent {
		b.systemLow = false
	}
}

// Observe refreshes the indicator without selecting or releasing a resource.
func (b *MemoryBudget) Observe(used uint64) { b.mu.Lock(); defer b.mu.Unlock(); b.observeLocked(used) }

func (b *MemoryBudget) Released(now time.Time) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.lastAttempt = now
	b.status.Released++
}
func (b *MemoryBudget) Status() BudgetStatus { b.mu.Lock(); defer b.mu.Unlock(); return b.status }
