package goide

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func gitCommand(t *testing.T, dir string, args ...string) string {
	t.Helper()
	command := exec.Command("git", args...)
	command.Dir = dir
	command.Env = append(os.Environ(), "GIT_AUTHOR_NAME=Ada", "GIT_AUTHOR_EMAIL=ada@example.com", "GIT_COMMITTER_NAME=Ada", "GIT_COMMITTER_EMAIL=ada@example.com")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, output)
	}
	return string(output)
}

func TestVCSStatusHistoryBlameCommitAndCheckoutGuard(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git non disponibile")
	}
	repo := t.TempDir()
	gitCommand(t, repo, "init", "-q", "-b", "main")
	gitCommand(t, repo, "config", "user.name", "Ada")
	gitCommand(t, repo, "config", "user.email", "ada@example.com")
	writeFixtureFile(t, repo, "README.md", "repo\n")
	writeFixtureFile(t, repo, "svc/go.mod", "module example.com/svc\n\ngo 1.22\n")
	writeFixtureFile(t, repo, "svc/main.go", "package main\n\nfunc main() {}\n")
	gitCommand(t, repo, "add", ".")
	gitCommand(t, repo, "commit", "-q", "-m", "initial")
	gitCommand(t, repo, "branch", "feature")

	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	// Il progetto è una sottocartella del repository: i percorsi vanno convertiti in entrambe le direzioni.
	session, err := service.OpenProject(filepath.Join(repo, "svc"))
	if err != nil {
		t.Fatal(err)
	}
	sessionID := string(session.ID)
	writeFixtureFile(t, repo, "svc/main.go", "package main\n\nfunc main() { println(1) }\n")
	writeFixtureFile(t, repo, "svc/new.go", "package main\n")
	writeFixtureFile(t, repo, "README.md", "changed outside the project\n")

	status, err := service.VCSStatus(sessionID)
	if err != nil || !status.Available || status.Branch != "main" {
		t.Fatalf("stato Git inatteso: %+v %v", status, err)
	}
	paths := map[string]VCSFileChange{}
	for _, change := range status.Changes {
		paths[change.RelativePath] = change
	}
	if _, ok := paths["main.go"]; !ok || !paths["new.go"].Untracked || len(paths) != 2 {
		t.Fatalf("modifiche del progetto inattese (README fuori dal progetto va escluso): %+v", status.Changes)
	}
	if head, err := service.VCSFileAtRevision(sessionID, "main.go", "HEAD"); err != nil || !strings.Contains(head, "func main() {}") {
		t.Fatalf("contenuto HEAD inatteso: %q %v", head, err)
	}
	if blame, err := service.VCSBlame(sessionID, "go.mod"); err != nil || len(blame) != 3 || blame[0].Author != "Ada" {
		t.Fatalf("blame inatteso: %+v %v", blame, err)
	}
	if _, err := service.VCSCommitFiles(sessionID, "update main", []string{"main.go"}); err != nil {
		t.Fatal(err)
	}
	history, err := service.VCSFileHistory(sessionID, "main.go")
	if err != nil || len(history) != 2 || history[0].Message != "update main" {
		t.Fatalf("cronologia inattesa: %+v %v", history, err)
	}
	after, _ := service.VCSStatus(sessionID)
	for _, change := range after.Changes {
		if change.RelativePath == "main.go" {
			t.Fatal("il file committato deve sparire dalle modifiche")
		}
	}
	if err := service.VCSCheckout(sessionID, "main.go"); err == nil {
		t.Fatal("un nome di file non deve mai essere passato a git checkout")
	}
	if err := service.VCSCheckout(sessionID, "feature"); err != nil {
		t.Fatal(err)
	}
	if status, _ := service.VCSStatus(sessionID); status.Branch != "feature" {
		t.Fatalf("checkout non riuscito: %+v", status)
	}
	if _, err := service.VCSFileAtRevision(sessionID, "../README.md", "HEAD"); err == nil {
		t.Fatal("percorso fuori dal progetto accettato")
	}
}

func TestVCSStatusOutsideRepository(t *testing.T) {
	project := t.TempDir()
	writeFixtureFile(t, project, "go.mod", "module example.com/plain\n\ngo 1.22\n")
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(project)
	if err != nil {
		t.Fatal(err)
	}
	status, err := service.VCSStatus(string(session.ID))
	if err != nil || status.Available {
		t.Fatalf("fuori da un repository Git non ci sono dati VCS: %+v %v", status, err)
	}
}
