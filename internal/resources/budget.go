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
const BudgetGrace = 30 * time.Second

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

func automaticMemoryBudget(total uint64) uint64 {
	return min(3*1024*MiB, max(1024*MiB, total/8))
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
	var selected *BudgetCandidate
	for _, candidate := range candidates {
		if !candidate.Eligible || candidate.Bytes == 0 || candidate.InactiveSince.IsZero() || candidate.StartedAt.IsZero() || now.Sub(candidate.InactiveSince) < BudgetGrace || now.Sub(candidate.StartedAt) < BudgetGrace {
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
		b.status.Pressure = true
	} else if used <= b.status.RecoveryTarget {
		b.status.Pressure = false
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
