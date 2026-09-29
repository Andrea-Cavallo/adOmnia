package goide

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// isolateGitConfig esclude la configurazione Git globale della macchina (hook,
// template, credential helper) che potrebbe aggiungere file ai repository di test.
func isolateGitConfig(t *testing.T) {
	t.Helper()
	empty := filepath.Join(t.TempDir(), "gitconfig")
	if err := os.WriteFile(empty, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GIT_CONFIG_GLOBAL", empty)
	t.Setenv("GIT_CONFIG_SYSTEM", empty)
}

// newGitProject crea un repository con un modulo Go minimale e un commit iniziale.
func newGitProject(t *testing.T, branch, marker string) string {
	t.Helper()
	repo := t.TempDir()
	gitCommand(t, repo, "init", "-q", "-b", branch)
	gitCommand(t, repo, "config", "user.name", "Ada")
	gitCommand(t, repo, "config", "user.email", "ada@example.com")
	writeFixtureFile(t, repo, "go.mod", "module example.com/"+marker+"\n\ngo 1.22\n")
	writeFixtureFile(t, repo, "main.go", "package main\n\n// "+marker+" v0\nfunc main() {}\n")
	gitCommand(t, repo, "add", ".")
	gitCommand(t, repo, "commit", "-q", "-m", "initial "+marker)
	return repo
}

// TestVCSGoToolsAndLocalHistoryStayIsolatedBetweenSessions apre due progetti con
// lo stesso percorso relativo main.go e verifica che stato Git, cronologia file,
// local history e comandi Go Tools di una sessione non compaiano mai nell'altra.
func TestVCSGoToolsAndLocalHistoryStayIsolatedBetweenSessions(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git non disponibile")
	}
	isolateGitConfig(t)
	alphaRepo := newGitProject(t, "main", "alpha")
	betaRepo := newGitProject(t, "trunk", "beta")
	recorder := &eventRecorder{}
	ide := NewService(&memoryStore{}, recorder.record)
	t.Cleanup(ide.Shutdown)
	alpha, err := ide.OpenProject(alphaRepo)
	if err != nil {
		t.Fatal(err)
	}
	beta, err := ide.OpenProject(betaRepo)
	if err != nil {
		t.Fatal(err)
	}
	alphaID, betaID := string(alpha.ID), string(beta.ID)

	// Git: branch, modifiche e cronologia restano del proprio repository.
	writeFixtureFile(t, alphaRepo, "only_alpha.go", "package main\n")
	alphaStatus, err := ide.VCSStatus(alphaID)
	if err != nil || alphaStatus.Branch != "main" {
		t.Fatalf("stato Git di alpha inatteso: %+v %v", alphaStatus, err)
	}
	betaStatus, err := ide.VCSStatus(betaID)
	if err != nil || betaStatus.Branch != "trunk" || len(betaStatus.Changes) != 0 {
		t.Fatalf("le modifiche di alpha non devono comparire in beta: %+v %v", betaStatus, err)
	}
	betaHistory, err := ide.VCSFileHistory(betaID, "main.go")
	if err != nil || len(betaHistory) != 1 || !strings.Contains(betaHistory[0].Message, "beta") {
		t.Fatalf("cronologia di main.go in beta inattesa: %+v %v", betaHistory, err)
	}

	// Local history: stesso percorso relativo, versioni separate per sessione.
	saveOnce := func(sessionID, marker string) {
		t.Helper()
		document, err := ide.OpenDocument(sessionID, "main.go")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := ide.SaveDocument(sessionID, string(document.Document.ID), "package main\n\n// "+marker+" v1\nfunc main() {}\n", document.DiskToken, false); err != nil {
			t.Fatal(err)
		}
	}
	saveOnce(alphaID, "alpha")
	saveOnce(betaID, "beta")
	alphaRevisions, err := ide.ListLocalHistory(alphaID, "main.go")
	if err != nil || len(alphaRevisions) == 0 {
		t.Fatalf("local history di alpha vuota: %v", err)
	}
	for _, revision := range alphaRevisions {
		content, err := ide.LocalHistoryContent(alphaID, "main.go", revision.ID)
		if err != nil || strings.Contains(content, "beta") {
			t.Fatalf("una versione di beta è finita nella local history di alpha: %q %v", content, err)
		}
		if leaked, err := ide.LocalHistoryContent(betaID, "main.go", revision.ID); err == nil && strings.Contains(leaked, "alpha") {
			t.Fatal("una revisione di alpha è leggibile dalla sessione beta")
		}
	}

	// Go Tools: l'autorizzazione e le esecuzioni appartengono alla sola sessione.
	if _, err := ide.SetToolAuthorization(alphaID, true); err != nil {
		t.Fatal(err)
	}
	if _, err := ide.StartGoTool(GoToolRequest{SessionID: beta.ID, Tool: "vet"}); err == nil {
		t.Fatal("autorizzare alpha non deve autorizzare beta")
	}
	if _, err := exec.LookPath("go"); err == nil {
		if _, err := ide.DetectToolchain(alphaID); err != nil {
			t.Fatal(err)
		}
		execution, err := ide.StartGoTool(GoToolRequest{SessionID: alpha.ID, Tool: "vet"})
		if err != nil {
			t.Fatal(err)
		}
		recorder.waitFor(t, 60*time.Second, func(event EventEnvelope) bool {
			done, ok := event.Payload.(Execution)
			return ok && event.Type == "run.finished" && done.ID == execution.ID
		})
		for _, event := range recorder.all() {
			if event.ResourceID == string(execution.ID) && event.SessionID != alpha.ID {
				t.Fatalf("evento del Go Tool di alpha instradato alla sessione %q", event.SessionID)
			}
		}
		betaRuns, err := ide.ListRuns(betaID)
		if err != nil {
			t.Fatal(err)
		}
		for _, run := range betaRuns {
			if run.ID == execution.ID {
				t.Fatal("l'esecuzione Go Tools di alpha compare fra quelle di beta")
			}
		}
	}

	// Chiudere alpha elimina la sua local history senza toccare quella di beta.
	if err := ide.CloseSession(alphaID); err != nil {
		t.Fatal(err)
	}
	if revisions, err := ide.ListLocalHistory(betaID, "main.go"); err != nil || len(revisions) == 0 {
		t.Fatalf("la local history di beta non deve sparire chiudendo alpha: %+v %v", revisions, err)
	}
}
