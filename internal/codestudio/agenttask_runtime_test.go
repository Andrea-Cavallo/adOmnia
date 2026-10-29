package codestudio

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/agenttask"
)

func TestFailedStopReasonsAreNotSuccess(t *testing.T) {
	for _, reason := range []string{"refusal", "max_tokens", "max_turn_requests", "error", " Refusal "} {
		if !failedStopReasons(reason) {
			t.Fatalf("%q must not count as a completed task", reason)
		}
	}
	for _, reason := range []string{"end_turn", "cancelled", ""} {
		if failedStopReasons(reason) {
			t.Fatalf("%q is a normal stop reason", reason)
		}
	}
}

func TestTaskTimeLimitFollowsTheTaskNotTheChatDefault(t *testing.T) {
	request := agenttask.RunRequest{Task: agenttask.Task{Limits: agenttask.Limits{TimeoutMinutes: 45}}}
	if got := taskTimeLimit(request); got != 45*time.Minute {
		t.Fatalf("task time limit = %s, want 45m", got)
	}
	request.Task.Limits.TimeoutMinutes = 0
	if got := taskTimeLimit(request); got != 0 {
		t.Fatalf("an unset task limit must keep the chat default, got %s", got)
	}
}

func TestRuntimeReportsAnUnregisteredAgent(t *testing.T) {
	runtime := NewAgentTaskRuntime(nil)
	err := runtime.Run(context.Background(), agenttask.RunRequest{Task: agenttask.Task{Agent: "missing"}}, func(agenttask.Event) {})
	if err == nil || !strings.Contains(err.Error(), "missing") {
		t.Fatalf("expected a clear unregistered-agent error, got %v", err)
	}
}
