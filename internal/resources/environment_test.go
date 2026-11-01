package resources

import (
	"os"
	"testing"
)

// A report is comparable only if it says which machine and build produced it.
func TestHostEnvironmentDescribesTheMachine(t *testing.T) {
	environment := HostEnvironment()
	if environment.OS == "" || environment.Arch == "" || environment.GoVersion == "" {
		t.Fatalf("incomplete environment: %+v", environment)
	}
	if environment.LogicalCores < 1 || environment.RootPID != os.Getpid() {
		t.Fatalf("unusable environment: %+v", environment)
	}
	if environment.BudgetSource != "automatic" && environment.BudgetSource != "environment" {
		t.Fatalf("unexpected budget source %q", environment.BudgetSource)
	}
}

func TestMemoryBudgetSourceFollowsTheOverride(t *testing.T) {
	t.Setenv("ADOMNIA_MEMORY_BUDGET_MIB", "1024")
	if got := memoryBudgetSource(); got != "environment" {
		t.Fatalf("explicit override reported as %q", got)
	}
	t.Setenv("ADOMNIA_MEMORY_BUDGET_MIB", "")
	if got := memoryBudgetSource(); got != "automatic" {
		t.Fatalf("automatic budget reported as %q", got)
	}
}
