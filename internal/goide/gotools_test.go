package goide

import (
	"os/exec"
	"strings"
	"testing"
	"time"
)

func TestGoToolsPreviewValidatesTargetsAndRunsForReal(t *testing.T) {
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("toolchain Go non disponibile")
	}
	root := copyFixture(t, "shapes")
	recorder := &eventRecorder{}
	ide := NewService(&memoryStore{}, recorder.record)
	t.Cleanup(ide.Shutdown)
	session, err := ide.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	preview := func(tool, target string) (GoToolPreview, error) {
		return ide.PreviewGoTool(GoToolRequest{SessionID: session.ID, Tool: tool, Target: target})
	}
	if got, err := preview("vet", "./geom"); err != nil || got.Command != "go vet ./geom" || got.ModifiesFiles {
		t.Fatalf("anteprima vet inattesa: %+v %v", got, err)
	}
	if got, err := preview("fix", ""); err != nil || got.Command != "go fix ./..." || !got.ModifiesFiles {
		t.Fatalf("go fix deve avvisare che riscrive i file: %+v %v", got, err)
	}
	if got, err := preview("doc", "example.com/shapes/geom.Shape"); err != nil || got.Command != "go doc -all example.com/shapes/geom.Shape" {
		t.Fatalf("anteprima doc inattesa: %+v %v", got, err)
	}
	for tool, target := range map[string]string{"modWhy": "-exec=rm", "doc": "--help", "vet": "../outside", "rm": "."} {
		if _, err := preview(tool, target); err == nil {
			t.Fatalf("%s %q doveva essere rifiutato", tool, target)
		}
	}
	if _, err := ide.StartGoTool(GoToolRequest{SessionID: session.ID, Tool: "vet"}); err == nil || !strings.Contains(err.Error(), "autorizza") {
		t.Fatalf("senza autorizzazione nessun comando: %v", err)
	}
	if _, err := ide.SetToolAuthorization(string(session.ID), true); err != nil {
		t.Fatal(err)
	}
	if _, err := ide.DetectToolchain(string(session.ID)); err != nil {
		t.Fatal(err)
	}
	execution, err := ide.StartGoTool(GoToolRequest{SessionID: session.ID, Tool: "doc", Target: "example.com/shapes/geom.Shape"})
	if err != nil {
		t.Fatal(err)
	}
	recorder.waitFor(t, 60*time.Second, func(event EventEnvelope) bool {
		done, ok := event.Payload.(Execution)
		return ok && event.Type == "run.finished" && done.ID == execution.ID
	})
	var text strings.Builder
	for _, event := range recorder.all() {
		if chunk, ok := event.Payload.(ProcessOutput); ok && chunk.RunID == execution.ID {
			text.WriteString(chunk.Text)
		}
	}
	output := text.String()
	if !strings.Contains(output, "type Shape interface") {
		t.Fatalf("go doc non ha prodotto la documentazione: %q", output)
	}
}
