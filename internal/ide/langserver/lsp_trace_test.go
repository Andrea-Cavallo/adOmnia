package langserver

import (
	"strings"
	"testing"
	"time"
)

func TestTraceEnvironmentRedactsProxyCredentials(t *testing.T) {
	environment := []string{"GOPROXY=https://user:secret@proxy.example.com,direct", "GOFLAGS=-mod=mod", "HOME=/home/dev"}
	got := traceEnvironment(environment, []string{"GOPROXY", "GOFLAGS", "GOWORK"})
	if strings.Contains(got, "secret") || strings.Contains(got, "user:") {
		t.Fatalf("credentials leaked: %s", got)
	}
	for _, want := range []string{"GOPROXY=https://%2A%2A%2A@proxy.example.com,direct", "GOFLAGS=-mod=mod", "GOWORK=(default)"} {
		if !strings.Contains(got, want) {
			t.Fatalf("missing %q in %s", want, got)
		}
	}
	if strings.Contains(got, "HOME") {
		t.Fatalf("unrequested variable logged: %s", got)
	}
}

func TestTraceProgressMeasuresPhasesAndFlagsSlowOnes(t *testing.T) {
	manager := NewLSPManager(newLanguageRegistry())
	state := &lspSession{id: "trace", startedAt: time.Now().Add(-2 * time.Minute)}
	manager.traceProgress(state, "1", progressValue{Kind: "begin", Title: "Setting up workspace", Message: "Loading packages..."})
	manager.traceProgress(state, "1", progressValue{Kind: "report", Message: "Loading packages..."})
	manager.traceProgress(state, "1", progressValue{Kind: "report", Message: "Type-checking"})
	// La fase è iniziata 90 secondi fa: va segnalata come lenta.
	state.mu.Lock()
	phase := state.progress["1"]
	phase.started = phase.started.Add(-90 * time.Second)
	state.progress["1"] = phase
	state.mu.Unlock()
	manager.traceProgress(state, "1", progressValue{Kind: "end", Message: "Finished loading packages."})

	log := strings.Join(state.log, "\n")
	for _, want := range []string{"▶ Setting up workspace: Loading packages...", "… Setting up workspace: Type-checking", "✔ Setting up workspace done in 1m30", `slow "Setting up workspace"`} {
		if !strings.Contains(log, want) {
			t.Fatalf("missing %q in log:\n%s", want, log)
		}
	}
	if strings.Count(log, "Loading packages...") != 1 {
		t.Fatalf("repeated progress message logged twice:\n%s", log)
	}
	if len(state.progress) != 0 {
		t.Fatalf("finished phase still tracked: %+v", state.progress)
	}
}
