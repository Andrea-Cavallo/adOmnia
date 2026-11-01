package codestudio

import (
	"strings"
	"testing"
)

func TestDebuggerInstallPlanCoversPHPAndNativeRows(t *testing.T) {
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	service.toolsRoot = t.TempDir()

	php, err := service.debuggerInstallPlan("php")
	if err != nil || !strings.Contains(php.Task, "php") || !strings.Contains(php.Command, "php-debug-1.40.2.vsix") {
		t.Fatalf("php plan = %+v, %v", php, err)
	}

	native, err := service.debuggerInstallPlan("cpp")
	if err != nil || native.Task != "install-rust-debugger" {
		t.Fatalf("cpp plan = %+v, %v", native, err)
	}

	if _, err := service.debuggerInstallPlan("ruby"); err == nil {
		t.Fatal("ruby has no installable debugger")
	}
}
