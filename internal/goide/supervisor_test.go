package goide

import (
	"testing"
	"time"
)

func TestSupervisorReportsOnlyRunsInterruptedByACrash(t *testing.T) {
	store := &memoryStore{}
	first := NewProcessSupervisor()
	if err := first.Configure(store); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	first.Track(ProcessDescriptor{RunID: "r1", SessionID: "s", ConfigID: "api", ConfigName: "api", StartedAt: now})
	first.Track(ProcessDescriptor{RunID: "r2", SessionID: "s", ConfigID: "seed", ConfigName: "seed", RestartPolicy: RestartPolicyNever, StartedAt: now.Add(time.Second)})
	first.Finish("r2") // terminata da sola: non è un'interruzione

	// Crash: niente Clear. Il prossimo avvio trova solo r1.
	second := NewProcessSupervisor()
	if err := second.Configure(store); err != nil {
		t.Fatal(err)
	}
	interrupted := second.Interrupted()
	if len(interrupted) != 1 || interrupted[0].RunID != "r1" || interrupted[0].ConfigID != "api" {
		t.Fatalf("interrotte: %+v", interrupted)
	}
	second.Dismiss("r1")
	if len(second.Interrupted()) != 0 {
		t.Fatal("Dismiss deve togliere la proposta")
	}

	// Chiusura pulita: il terzo avvio non vede nulla.
	second.Track(ProcessDescriptor{RunID: "r3", SessionID: "s", StartedAt: now})
	second.Clear()
	third := NewProcessSupervisor()
	_ = third.Configure(store)
	if len(third.Interrupted()) != 0 {
		t.Fatalf("dopo una chiusura pulita non ci sono interruzioni: %+v", third.Interrupted())
	}
}

func TestRestartPolicyValidation(t *testing.T) {
	for _, policy := range []string{"", RestartPolicyPrompt, RestartPolicyNever, RestartPolicyAlways} {
		if _, err := normalizeConfiguration(RunConfiguration{Name: "x", Kind: RunKindPackage, RestartPolicy: policy}); err != nil {
			t.Fatalf("%q: %v", policy, err)
		}
	}
	if _, err := normalizeConfiguration(RunConfiguration{Name: "x", Kind: RunKindPackage, RestartPolicy: "sometimes"}); err == nil {
		t.Fatal("policy sconosciuta accettata")
	}
}
