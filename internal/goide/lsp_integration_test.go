package goide

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type eventRecorder struct {
	mu     sync.Mutex
	events []EventEnvelope
}

func (r *eventRecorder) record(event EventEnvelope) {
	r.mu.Lock()
	r.events = append(r.events, event)
	r.mu.Unlock()
}

func (r *eventRecorder) waitFor(t *testing.T, timeout time.Duration, predicate func(EventEnvelope) bool) EventEnvelope {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		r.mu.Lock()
		for _, event := range r.events {
			if predicate(event) {
				r.mu.Unlock()
				return event
			}
		}
		r.mu.Unlock()
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("evento atteso non ricevuto entro %s", timeout)
	return EventEnvelope{}
}

func (r *eventRecorder) all() []EventEnvelope {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]EventEnvelope(nil), r.events...)
}

func findGoplsForTest(t *testing.T) string {
	t.Helper()
	if found, err := exec.LookPath("gopls"); err == nil {
		return found
	}
	if home, err := os.UserHomeDir(); err == nil {
		candidate := filepath.Join(home, "go", "bin", goplsExecutableName())
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	t.Skip("gopls non installato: test di integrazione LSP saltato")
	return ""
}

func copyFixture(t *testing.T, name string) string {
	t.Helper()
	source := filepath.Join("testdata", name)
	target := filepath.Join(t.TempDir(), name)
	err := filepath.WalkDir(source, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, _ := filepath.Rel(source, path)
		destination := filepath.Join(target, rel)
		if entry.IsDir() {
			return os.MkdirAll(destination, 0o755)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(destination, data, 0o644)
	})
	if err != nil {
		t.Fatal(err)
	}
	return target
}

func startLanguageServerForTest(t *testing.T, service *Service, recorder *eventRecorder, root, gopls string) Session {
	t.Helper()
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetToolAuthorization(string(session.ID), true); err != nil {
		t.Fatal(err)
	}
	if info, err := service.DetectToolchain(string(session.ID)); err != nil || !info.Available {
		t.Fatalf("toolchain non disponibile: %v %+v", err, info)
	}
	if err := service.ConfigureGopls(string(session.ID), gopls); err != nil {
		t.Fatal(err)
	}
	if _, err := service.StartLanguageServer(string(session.ID), LanguageServerSettings{Placeholders: true}); err != nil {
		t.Fatal(err)
	}
	recorder.waitFor(t, 30*time.Second, func(event EventEnvelope) bool {
		status, ok := event.Payload.(LanguageServerStatus)
		return ok && event.SessionID == session.ID && status.State == LanguageServerReady
	})
	return session
}

func positionOf(t *testing.T, text, needle string, offsetInNeedle int) (int, int) {
	t.Helper()
	index := strings.Index(text, needle)
	if index < 0 {
		t.Fatalf("%q non trovato", needle)
	}
	index += offsetInNeedle
	line := strings.Count(text[:index], "\n") + 1
	column := index - strings.LastIndex(text[:index], "\n")
	return line, column
}

func TestLanguageServerEndToEndWithRealGopls(t *testing.T) {
	gopls := findGoplsForTest(t)
	root := copyFixture(t, "multipkg")
	recorder := &eventRecorder{}
	service := NewService(&memoryStore{}, recorder.record)
	t.Cleanup(service.Shutdown)
	session := startLanguageServerForTest(t, service, recorder, root, gopls)
	sessionID := string(session.ID)
	ctx := context.Background()

	mainDocument, err := service.OpenDocument(sessionID, "main.go")
	if err != nil {
		t.Fatal(err)
	}
	mainID := string(mainDocument.Document.ID)
	original := mainDocument.Content

	// Il buffer non salvato genera diagnostica senza toccare il disco.
	broken := strings.Replace(original, "func main() {", "func main() {\n\tvar unused int = \"text\"", 1)
	if err := service.UpdateDocumentBuffer(sessionID, mainID, 2, broken); err != nil {
		t.Fatal(err)
	}
	report := recorder.waitFor(t, 30*time.Second, func(event EventEnvelope) bool {
		payload, ok := event.Payload.(DiagnosticsReport)
		return ok && payload.RelativePath == "main.go" && len(payload.Diagnostics) > 0
	}).Payload.(DiagnosticsReport)
	if report.DocumentID != mainDocument.Document.ID || report.Diagnostics[0].Range.StartLine != 10 {
		t.Fatalf("diagnostica inattesa: %+v", report)
	}
	if onDisk, _ := os.ReadFile(filepath.Join(root, "main.go")); string(onDisk) != original {
		t.Fatal("il buffer non salvato è finito su disco")
	}
	// Una versione non crescente è ignorata.
	if err := service.UpdateDocumentBuffer(sessionID, mainID, 2, original); err != nil {
		t.Fatal(err)
	}
	if err := service.UpdateDocumentBuffer(sessionID, mainID, 3, original); err != nil {
		t.Fatal(err)
	}

	line, column := positionOf(t, original, "greet.Hello(", len("greet."))
	completion, err := service.Completion(ctx, sessionID, mainID, line, column)
	if err != nil {
		t.Fatal(err)
	}
	if completion.Version != 3 || !hasCompletion(completion, "Hello") {
		t.Fatalf("completion inattesa: versione %d, %d elementi", completion.Version, len(completion.Items))
	}
	hover, err := service.Hover(ctx, sessionID, mainID, line, column+1)
	if err != nil || !strings.Contains(hover.Markdown, "Hello(name string) string") {
		t.Fatalf("hover inatteso: %v %q", err, hover.Markdown)
	}
	definitions, err := service.Locations(ctx, sessionID, mainID, "definition", line, column+1)
	if err != nil || len(definitions) != 1 || definitions[0].RelativePath != "greet/greet.go" || !strings.Contains(definitions[0].Preview, "func Hello") {
		t.Fatalf("definition inattesa: %v %+v", err, definitions)
	}
	references, err := service.Locations(ctx, sessionID, mainID, "references", line, column+1)
	if err != nil || len(references) < 3 {
		t.Fatalf("references inattese: %v %+v", err, references)
	}
	interfaceLine, interfaceColumn := positionOf(t, original, "greet.Greeter", len("greet.")+1)
	implementations, err := service.Locations(ctx, sessionID, mainID, "implementation", interfaceLine, interfaceColumn)
	if err != nil || len(implementations) == 0 || !strings.Contains(implementations[0].Preview, "English") {
		t.Fatalf("implementation inattesa: %v %+v", err, implementations)
	}
	symbols, err := service.DocumentSymbols(ctx, sessionID, mainID)
	if err != nil || len(symbols.Symbols) == 0 || symbols.Symbols[0].Name != "main" {
		t.Fatalf("simboli inattesi: %v %+v", err, symbols)
	}

	rename, err := service.Rename(ctx, sessionID, mainID, line, column+1, "Salute")
	if err != nil || len(rename.Files) != 2 {
		t.Fatalf("rename inatteso: %v %+v", err, rename)
	}
	for _, file := range rename.Files {
		if !strings.Contains(file.NewContent, "Salute(") || strings.Contains(file.NewContent, "Hello(") {
			t.Fatalf("contenuto rinominato inatteso in %s", file.RelativePath)
		}
	}
	if onDisk, _ := os.ReadFile(filepath.Join(root, "greet", "greet.go")); !strings.Contains(string(onDisk), "func Hello") {
		t.Fatal("il rename in anteprima ha modificato il disco")
	}

	unformatted := strings.Replace(original, "\tvar g", "var    g", 1)
	if err := service.UpdateDocumentBuffer(sessionID, mainID, 4, unformatted); err != nil {
		t.Fatal(err)
	}
	formatted, err := service.FormatDocument(ctx, sessionID, mainID)
	if err != nil || formatted.Version != 4 || len(formatted.Edits) == 0 {
		t.Fatalf("formatting inatteso: %v %+v", err, formatted)
	}

	// Crash controllato: gopls viene riavviato e i documenti riaperti senza riavviare l'app.
	status, _ := service.LanguageServerStatus(sessionID)
	process, err := os.FindProcess(status.PID)
	if err != nil {
		t.Fatal(err)
	}
	_ = process.Kill()
	recorder.waitFor(t, 30*time.Second, func(event EventEnvelope) bool {
		payload, ok := event.Payload.(LanguageServerStatus)
		return ok && payload.State == LanguageServerReady && payload.Restarts == 1
	})
	if _, err := service.Hover(ctx, sessionID, mainID, line, column+1); err != nil {
		t.Fatalf("gopls non operativo dopo il riavvio: %v", err)
	}

	if err := service.StopLanguageServer(sessionID); err != nil {
		t.Fatal(err)
	}
	if final, _ := service.LanguageServerStatus(sessionID); final.State != LanguageServerStopped || final.PID != 0 {
		history := []string{}
		for _, event := range recorder.all() {
			if status, ok := event.Payload.(LanguageServerStatus); ok {
				history = append(history, fmt.Sprintf("%s pid=%d restarts=%d %s", status.State, status.PID, status.Restarts, status.Error))
			}
		}
		t.Fatalf("gopls non arrestato: %+v\nstorico:\n%s", final, strings.Join(history, "\n"))
	}
	if processAlive(status.PID) {
		t.Fatal("processo gopls orfano dopo lo stop")
	}
}

func TestLanguageServerSessionsStayIsolated(t *testing.T) {
	gopls := findGoplsForTest(t)
	recorder := &eventRecorder{}
	service := NewService(&memoryStore{}, recorder.record)
	t.Cleanup(service.Shutdown)
	first := startLanguageServerForTest(t, service, recorder, copyFixture(t, "multipkg"), gopls)
	second := startLanguageServerForTest(t, service, recorder, copyFixture(t, "multipkg"), gopls)

	document, err := service.OpenDocument(string(first.ID), "main.go")
	if err != nil {
		t.Fatal(err)
	}
	broken := strings.Replace(document.Content, "func main() {", "func main() {\n\tundefinedCall()", 1)
	if err := service.UpdateDocumentBuffer(string(first.ID), string(document.Document.ID), 2, broken); err != nil {
		t.Fatal(err)
	}
	recorder.waitFor(t, 30*time.Second, func(event EventEnvelope) bool {
		payload, ok := event.Payload.(DiagnosticsReport)
		return ok && event.SessionID == first.ID && len(payload.Diagnostics) > 0
	})
	for _, event := range recorder.all() {
		payload, ok := event.Payload.(DiagnosticsReport)
		if !ok {
			continue
		}
		owner := first
		if event.SessionID == second.ID {
			owner = second
		}
		if ensureWithinRoot(owner.Project.RealPath, payload.Path) != nil {
			t.Fatalf("diagnostica di %s consegnata alla sessione %s", payload.Path, event.SessionID)
		}
		if event.SessionID == second.ID && len(payload.Diagnostics) > 0 {
			t.Fatalf("la sessione B ha ricevuto errori del buffer di A: %+v", payload)
		}
	}
}

func hasCompletion(result CompletionResult, label string) bool {
	for _, item := range result.Items {
		if item.Label == label {
			return true
		}
	}
	return false
}
