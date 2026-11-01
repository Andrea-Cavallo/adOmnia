package resources

import (
	"os"
	"runtime"

	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/mem"
)

// Environment describes the machine and the build a recording comes from. It is
// read once per export, not per sample: a report is unreadable for anyone else
// without the hardware it refers to and the build that produced it.
type Environment struct {
	AppVersion   string `json:"appVersion,omitempty"`
	BuildDate    string `json:"buildDate,omitempty"`
	GitCommit    string `json:"gitCommit,omitempty"`
	OS           string `json:"os"`
	OSVersion    string `json:"osVersion,omitempty"`
	Arch         string `json:"arch"`
	LogicalCores int    `json:"logicalCores"`
	TotalRAM     uint64 `json:"totalRamBytes,omitempty"`
	GoVersion    string `json:"goVersion"`
	MemoryBudget uint64 `json:"memoryBudgetTarget,omitempty"`
	BudgetSource string `json:"memoryBudgetSource,omitempty"`
	RootPID      int    `json:"rootPid"`
}

// HostEnvironment never fails: a missing value is omitted instead of being
// replaced by a zero that a reader would mistake for a measurement.
func HostEnvironment() Environment {
	environment := Environment{
		OS:           runtime.GOOS,
		Arch:         runtime.GOARCH,
		LogicalCores: runtime.NumCPU(),
		GoVersion:    runtime.Version(),
		RootPID:      os.Getpid(),
		BudgetSource: memoryBudgetSource(),
	}
	if info, err := host.Info(); err == nil && info.Platform != "" {
		environment.OSVersion = info.Platform
		if info.PlatformVersion != "" {
			environment.OSVersion += " " + info.PlatformVersion
		}
	}
	if memory, err := mem.VirtualMemory(); err == nil {
		environment.TotalRAM = memory.Total
	}
	if target, err := DefaultMemoryBudget(); err == nil {
		environment.MemoryBudget = target
	}
	return environment
}

// memoryBudgetSource separates the local override from the automatic rule; a
// report must not present a value chosen by hand as an automatic decision.
func memoryBudgetSource() string {
	if os.Getenv("ADOMNIA_MEMORY_BUDGET_MIB") != "" {
		return "environment"
	}
	return "automatic"
}
