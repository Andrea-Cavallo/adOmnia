package goide

import (
	"os"
	"os/exec"
	"path/filepath"
	"slices"
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
	if err := service.VCSStage(sessionID, []string{"new.go"}, true); err != nil {
		t.Fatal(err)
	}
	if staged, _ := service.VCSStatus(sessionID); !slices.ContainsFunc(staged.Changes, func(change VCSFileChange) bool { return change.RelativePath == "new.go" && change.Staged }) {
		t.Fatalf("new.go non staged: %+v", staged.Changes)
	}
	if err := service.VCSStage(sessionID, []string{"new.go"}, false); err != nil {
		t.Fatal(err)
	}
	writeFixtureFile(t, repo, "svc/main.go", "package main\n\nfunc main() { panic(\"discard\") }\n")
	if err := service.VCSRevert(sessionID, []string{"main.go", "new.go"}); err != nil {
		t.Fatal(err)
	}
	if content, _ := os.ReadFile(filepath.Join(repo, "svc/main.go")); strings.Contains(string(content), "discard") {
		t.Fatalf("main.go non ripristinato: %s", content)
	}
	if _, err := os.Stat(filepath.Join(repo, "svc/new.go")); !os.IsNotExist(err) {
		t.Fatalf("new.go non rimosso: %v", err)
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

func TestVCSStatusFindsNestedRepositories(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git unavailable")
	}
	root := t.TempDir()
	for _, name := range []string{"api", "worker"} {
		dir := filepath.Join(root, name)
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
		gitCommand(t, dir, "init", "-q", "-b", name)
		writeFixtureFile(t, dir, "README.md", name+"\n")
		gitCommand(t, dir, "add", ".")
		gitCommand(t, dir, "commit", "-q", "-m", "initial")
	}
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	status, err := service.VCSStatus(string(session.ID))
	if err != nil || !status.Available {
		t.Fatalf("workspace with two Git projects was not detected: %+v %v", status, err)
	}
	if len(status.Repositories) != 2 {
		t.Fatalf("expected two repositories: %+v", status.Repositories)
	}
	selected, err := service.VCSSelectRepository(string(session.ID), filepath.Join(root, "worker"))
	if err != nil || selected.Branch != "worker" {
		t.Fatalf("wrong selected repository: %+v %v", selected, err)
	}
	if text, err := service.VCSFileAtRevision(string(session.ID), "api/README.md", "HEAD"); err != nil || text != "api\n" {
		t.Fatalf("file history must use its owning repository: %q %v", text, err)
	}
	writeFixtureFile(t, root, "worker/README.md", "changed worker\n")
	if err := service.VCSStage(string(session.ID), []string{"worker/README.md"}, true); err != nil {
		t.Fatal(err)
	}
	if err := service.VCSStage(string(session.ID), []string{"api/README.md"}, true); err == nil {
		t.Fatal("accepted a file from the other repository")
	}
	if _, err := service.VCSSelectRepository(string(session.ID), t.TempDir()); err == nil {
		t.Fatal("accepted an unrelated repository")
	}
}
