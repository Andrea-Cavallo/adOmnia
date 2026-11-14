package codestudio

import (
	"strings"
	"testing"
)

// DiagramWorkspace is the contract Diagram Studio relies on: one call, trusted sessions only, and
// both adapters in one normalized answer (Go sources and Java/OSGi flows).
func TestDiagramWorkspaceService(t *testing.T) {
	root := t.TempDir()
	writeFlowSource(t, root, "go.mod", "module example.com/payments\n\ngo 1.22\n")
	writeFlowSource(t, root, "service/service.go", `package service

func CreatePayment() {
	ReserveFunds()
}

func ReserveFunds() {
}
`)
	writeFlowSource(t, root, "src/com/acme/PaymentFlow.java", `package com.acme;

public class PaymentFlow {
	@Flow
	public void execute() {
	}
}
`)

	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	id := string(session.ID)

	if _, err := service.DiagramWorkspace(id, false); err == nil {
		t.Fatal("an untrusted project must not be analysed")
	}
	if _, err := service.SetToolAuthorization(id, true); err != nil {
		t.Fatal(err)
	}

	analysis, err := service.DiagramWorkspace(id, false)
	if err != nil {
		t.Fatal(err)
	}
	if analysis.Root == "" {
		t.Fatal("analysis has no root")
	}
	foundPayment := false
	for _, entity := range analysis.Entities {
		if entity.Kind == "function" && strings.Contains(entity.Label, "CreatePayment") {
			foundPayment = true
			if entity.File == "" || entity.Line == 0 {
				t.Fatalf("function without a source ref: %+v", entity)
			}
			if entity.Service == "" {
				t.Fatalf("function without a service: %+v", entity)
			}
		}
	}
	if !foundPayment {
		t.Fatal("the Go function CreatePayment is missing from the workspace analysis")
	}
	foundFlow := false
	for _, entity := range analysis.Entities {
		if entity.Kind == "flow" || entity.Kind == "subflow" {
			foundFlow = true
		}
	}
	if !foundFlow {
		t.Fatal("the Java flow is missing from the workspace analysis")
	}
	if len(analysis.Languages) < 2 {
		t.Fatalf("expected Go and flow sources, got %v (problems: %v)", analysis.Languages, analysis.Problems)
	}
}
