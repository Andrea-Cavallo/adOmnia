package codestudio

import (
	"context"
	"encoding/json/v2"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/git"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/agenttask"
	"github.com/Andrea-Cavallo/adOmnia/internal/storage"
)

func initRepoWithCommit(t *testing.T) string {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
	root := filepath.Join(t.TempDir(), "repo")
	if err := git.Init(git.Config{RepoPath: root, Branch: "main", AuthorName: "T", AuthorEmail: "t@e.com"}); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "main.go"), []byte("package main\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := git.CommitAll(root, "init"); err != nil {
		t.Fatal(err)
	}
	return root
}

func TestGitWorkspaceProviderCreatesAnIsolatedWorktreeThatSurvivesReconcile(t *testing.T) {
	root := initRepoWithCommit(t)
	// Una policy locale non committata deve raggiungere il worktree: senza, l'agente
	// girerebbe con la policy predefinita invece di quella scelta dall'utente.
	if err := os.MkdirAll(filepath.Join(root, ".adomnia"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".adomnia", "ai-policy.json"), []byte(`{"format":"adomnia-ai-policy","ai":"off"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	provider := NewGitWorkspaceProvider(filepath.Join(t.TempDir(), "worktrees"))
	workspace, err := provider.Create(agenttask.WorkspaceRequest{TaskID: "task-abc123", RepoRoot: root, BaseRef: "HEAD"})
	if err != nil {
		t.Fatal(err)
	}
	policy, err := os.ReadFile(filepath.Join(workspace.Path, ".adomnia", "ai-policy.json"))
	if err != nil || !strings.Contains(string(policy), `"off"`) {
		t.Fatalf("the project AI policy was not mirrored into the workspace: %q, %v", policy, err)
	}
	if workspace.Path == filepath.Clean(root) || workspace.Branch == "" || workspace.BaseSHA == "" {
		t.Fatalf("workspace was not isolated: %+v", workspace)
	}
	if _, err := os.Stat(filepath.Join(workspace.Path, "main.go")); err != nil {
		t.Fatalf("worktree content missing: %v", err)
	}
	if state, notice := provider.Inspect(workspace); state != agenttask.WorkspaceReady || notice != "" {
		t.Fatalf("inspect = %s %q", state, notice)
	}
	// Il worktree è estraneo alla root del progetto e non altera il working tree.
	if status, err := git.GetStatus(root); err != nil || status.Branch != "main" {
		t.Fatalf("main working tree changed: %+v %v", status, err)
	}
	if _, changed, err := provider.Fingerprint(workspace.Path, workspace.BaseSHA); err != nil || changed != 0 {
		t.Fatalf("the mirrored policy must not count as a change: %d, %v", changed, err)
	}
	if err := provider.Remove(workspace); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if state, _ := provider.Inspect(workspace); state != agenttask.WorkspaceMissing {
		t.Fatalf("removed workspace state = %s", state)
	}
}

func TestTaskVerifierRunsTheLanguageTestsAndKeepsTheFailure(t *testing.T) {
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("go is not installed")
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module example.test/agent\n\ngo 1.23\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "sum_test.go"), []byte("package agent\n\nimport \"testing\"\n\nfunc TestFails(t *testing.T) { t.Fatal(\"measured failure\") }\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	verifier := NewTaskVerifier(newLanguageRegistry())
	evidence := verifier.Run(context.Background(), agenttask.VerifyRequest{
		TaskID: "task-1", Workdir: root,
		Verification: agenttask.Verification{Kind: agenttask.VerificationTest, Label: "tests", Language: "go", Packages: []string{"./..."}, TimeoutSeconds: 120},
	})
	if evidence.Outcome != agenttask.EvidenceFailed {
		t.Fatalf("a failing test must be reported as failed: %+v", evidence)
	}
	if !strings.Contains(evidence.Log, "measured failure") || evidence.ExitCode == nil || *evidence.ExitCode == 0 {
		t.Fatalf("the failure evidence is incomplete: %+v", evidence)
	}
}

func TestTaskVerifierRunsALoopbackRequestAndRefusesRemoteHosts(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	verifier := NewTaskVerifier(nil)
	request := agenttask.Verification{
		Kind: agenttask.VerificationRequest, Label: "health", Method: "POST", URL: server.URL,
		ExpectedStatus: http.StatusNoContent, TimeoutSeconds: 10,
	}
	evidence := verifier.Run(context.Background(), agenttask.VerifyRequest{TaskID: "task-1", Workdir: t.TempDir(), Verification: request})
	if evidence.Outcome != agenttask.EvidencePassed {
		t.Fatalf("expected a passed verification: %+v", evidence)
	}
	if evidence.Command != "POST "+server.URL || evidence.ExitCode == nil {
		t.Fatalf("evidence is incomplete: %+v", evidence)
	}

	// Un host esterno non viene contattato per scelta dell'utente: non è "passed".
	remote := request
	remote.URL = "http://example.invalid/health"
	evidence = verifier.Run(context.Background(), agenttask.VerifyRequest{TaskID: "task-1", Workdir: t.TempDir(), Verification: remote})
	if evidence.Outcome != agenttask.EvidenceNotRun {
		t.Fatalf("remote host was not blocked: %+v", evidence)
	}
}

func TestGitWorkspaceProviderIncludesLocalChangesOnlyWhenAsked(t *testing.T) {
	root := initRepoWithCommit(t)
	if err := os.WriteFile(filepath.Join(root, "main.go"), []byte("package main\n\nfunc main() {}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	provider := NewGitWorkspaceProvider(filepath.Join(t.TempDir(), "worktrees"))
	plain, err := provider.Create(agenttask.WorkspaceRequest{TaskID: "task-plain", RepoRoot: root, BaseRef: "HEAD"})
	if err != nil {
		t.Fatal(err)
	}
	if content, _ := os.ReadFile(filepath.Join(plain.Path, "main.go")); strings.Contains(string(content), "func main") || plain.IncludedLocalChanges != 0 {
		t.Fatalf("local changes leaked into a plain workspace: %q", content)
	}
	with, err := provider.Create(agenttask.WorkspaceRequest{TaskID: "task-local", RepoRoot: root, BaseRef: "HEAD", IncludeLocalChanges: true})
	if err != nil {
		t.Fatal(err)
	}
	if content, _ := os.ReadFile(filepath.Join(with.Path, "main.go")); !strings.Contains(string(content), "func main") || with.IncludedLocalChanges != 1 {
		t.Fatalf("local changes were not included: %q (%d files)", content, with.IncludedLocalChanges)
	}
	// Il progetto resta com'era.
	if content, _ := os.ReadFile(filepath.Join(root, "main.go")); !strings.Contains(string(content), "func main") {
		t.Fatal("the project working tree was changed")
	}
}

func TestTaskVerifierStartsTheRunConfigurationInTheWorkspaceAndStopsIt(t *testing.T) {
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("go is not installed")
	}
	workspace := t.TempDir()
	writeFixtureFile(t, workspace, "go.mod", "module example.test/svc\n\ngo 1.23\n")
	writeFixtureFile(t, workspace, "main.go", `package main

import (
	"fmt"
	"net/http"
	"os"
)

func main() {
	if os.Getenv("MODE") == "crash" {
		fmt.Println("boom: configuration missing")
		os.Exit(3)
	}
	http.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	fmt.Println("listening on", os.Getenv("PORT"))
	_ = http.ListenAndServe("127.0.0.1:"+os.Getenv("PORT"), nil)
}
`)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := fmt.Sprint(listener.Addr().(*net.TCPAddr).Port)
	_ = listener.Close() // free the port for the service

	service := NewService(&memoryStore{}, func(EventEnvelope) {})
	t.Cleanup(service.Shutdown)
	verifier := service.AgentTaskVerifier(t.TempDir())
	launch := func(mode string) agenttask.ServiceLaunch {
		config, err := json.Marshal(RunConfiguration{Name: "api", Kind: RunKindPackage, Target: ".", Language: "go",
			Environment: []EnvironmentEntry{{Key: "PORT", Value: port}, {Key: "MODE", Value: mode}}})
		if err != nil {
			t.Fatal(err)
		}
		return agenttask.ServiceLaunch{Name: "api", Configuration: string(config), ReadyTimeoutSeconds: 120}
	}
	verification := agenttask.Verification{
		Kind: agenttask.VerificationRequest, Label: "health", Method: "GET", URL: "http://127.0.0.1:" + port + "/health",
		ExpectedStatus: http.StatusNoContent, TimeoutSeconds: 10, Service: launch("serve"),
	}
	evidence := verifier.Run(context.Background(), agenttask.VerifyRequest{TaskID: "task-svc", Workdir: workspace, Verification: verification})
	if evidence.Outcome != agenttask.EvidencePassed || !strings.Contains(evidence.Log, "listening on "+port) {
		t.Fatalf("the started service was not verified: %+v", evidence)
	}
	if service.HasAnyActiveRuns() || len(service.workspace.ListSessions()) != 0 {
		t.Fatalf("the service or its temporary session survived the verification")
	}

	verification.Service = launch("crash")
	evidence = verifier.Run(context.Background(), agenttask.VerifyRequest{TaskID: "task-svc", Workdir: workspace, Verification: verification})
	if evidence.Outcome != agenttask.EvidenceFailed || !strings.Contains(evidence.Log, "boom: configuration missing") {
		t.Fatalf("a service that exits must be a failure with its output: %+v", evidence)
	}
	if service.HasAnyActiveRuns() || len(service.workspace.ListSessions()) != 0 {
		t.Fatalf("the crashed service left a session behind")
	}
}

func TestGitWorkspaceProviderComparesAndIntegratesIntoTheProject(t *testing.T) {
	root := initRepoWithCommit(t)
	provider := NewGitWorkspaceProvider(filepath.Join(t.TempDir(), "worktrees"))
	workspace, err := provider.Create(agenttask.WorkspaceRequest{TaskID: "task-int", RepoRoot: root, BaseRef: "HEAD"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = git.RemoveWorktree(root, workspace.Path, true) })
	if err := os.WriteFile(filepath.Join(workspace.Path, "handler.go"), []byte("package main\n\nfunc handler() {}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	comparison, err := provider.Compare(workspace)
	if err != nil || len(comparison.ChangedFiles) != 1 || comparison.TargetBranch != "main" || comparison.TargetCommits != 0 {
		t.Fatalf("comparison = %+v, %v", comparison, err)
	}
	integration, err := provider.Integrate(workspace, false)
	if err != nil || !integration.Applied || len(integration.Conflicts) != 0 {
		t.Fatalf("integration = %+v, %v", integration, err)
	}
	if _, err := os.Stat(filepath.Join(root, "handler.go")); err != nil {
		t.Fatalf("the agent file did not reach the project: %v", err)
	}
	if integration.Fingerprint != comparison.Fingerprint {
		t.Fatal("the integrated content is not the compared one")
	}
}

func TestTaskWorktreeOpenedInCodeStudioInheritsTheProjectTrust(t *testing.T) {
	root := initRepoWithCommit(t)
	worktrees := filepath.Join(t.TempDir(), "worktrees")
	provider := NewGitWorkspaceProvider(worktrees)
	workspace, err := provider.Create(agenttask.WorkspaceRequest{TaskID: "task-trust", RepoRoot: root, BaseRef: "HEAD"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = git.RemoveWorktree(root, workspace.Path, true) })
	service := NewService(&memoryStore{}, func(EventEnvelope) {})
	t.Cleanup(service.Shutdown)
	service.SetAgentWorktreeRoot(worktrees)

	// Progetto non fidato: il worktree non riceve nulla.
	untrusted, err := service.OpenProject(workspace.Path)
	if err != nil {
		t.Fatal(err)
	}
	if untrusted.Project.Authorization == AuthorizationPermitted {
		t.Fatal("a worktree of an untrusted project must not be trusted")
	}
	if err := service.CloseSession(string(untrusted.ID)); err != nil {
		t.Fatal(err)
	}
	project, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetToolAuthorization(string(project.ID), true); err != nil {
		t.Fatal(err)
	}
	opened, err := service.OpenProject(workspace.Path)
	if err != nil {
		t.Fatal(err)
	}
	if opened.Project.Authorization != AuthorizationPermitted {
		t.Fatal("the task worktree did not inherit the project trust")
	}
	if service.isTrusted(opened.Project.RealPath) {
		t.Fatal("inherited trust must not be saved for the worktree")
	}
}

func TestStackTraceIsExtractedFromServiceOutput(t *testing.T) {
	output := "listening on 8080\npanic: runtime error: invalid memory address\n\ngoroutine 1 [running]:\nmain.handler()\n\t/app/main.go:12\n"
	trace := extractStackTrace(output)
	if !strings.HasPrefix(trace, "panic: runtime error") || !strings.Contains(trace, "main.go:12") {
		t.Fatalf("trace = %q", trace)
	}
	if extractStackTrace("all good\n") != "" {
		t.Fatal("no trace expected")
	}
	evidence := withStackTrace(agenttask.Evidence{}, output)
	if !strings.Contains(evidence.Log, "stack trace") || evidence.Observations[0].Value != "found" {
		t.Fatalf("evidence = %+v", evidence)
	}
}

func TestStoppedMockServerIsDeclaredNotCollected(t *testing.T) {
	evidence := mockObservation{running: false}.annotate(agenttask.Evidence{})
	if len(evidence.Observations) != 1 || !strings.HasPrefix(evidence.Observations[0].Value, "not collected") {
		t.Fatalf("a stopped mock server must not read as zero calls: %+v", evidence.Observations)
	}
}

func TestRevokingProjectTrustNotifiesAgentTasks(t *testing.T) {
	project := t.TempDir()
	service := NewService(&memoryStore{}, func(EventEnvelope) {})
	t.Cleanup(service.Shutdown)
	var revoked []string
	service.OnTrustRevoked(func(root string) { revoked = append(revoked, root) })
	session, err := service.OpenProject(project)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetToolAuthorization(string(session.ID), true); err != nil {
		t.Fatal(err)
	}
	if len(revoked) != 0 {
		t.Fatal("granting trust must not stop anything")
	}
	if _, err := service.SetToolAuthorization(string(session.ID), false); err != nil {
		t.Fatal(err)
	}
	if len(revoked) != 1 || !samePath(revoked[0], session.Project.RealPath) {
		t.Fatalf("revoked = %v", revoked)
	}
}

func TestStepCommitStaysOnTheTaskBranch(t *testing.T) {
	root := initRepoWithCommit(t)
	provider := NewGitWorkspaceProvider(filepath.Join(t.TempDir(), "worktrees"))
	workspace, err := provider.Create(agenttask.WorkspaceRequest{TaskID: "task-commit", RepoRoot: root, BaseRef: "HEAD"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = git.RemoveWorktree(root, workspace.Path, true) })
	projectHead, _ := git.GetCommitMeta(root, "HEAD")
	if err := os.WriteFile(filepath.Join(workspace.Path, "step.go"), []byte("package main\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	pending, err := provider.PendingFiles(workspace)
	if err != nil || len(pending) != 1 || pending[0] != "step.go" {
		t.Fatalf("pending = %v, %v (the mirrored policy must not appear)", pending, err)
	}
	sha, files, err := provider.Commit(workspace, "Add step")
	if err != nil || sha == "" || len(files) != 1 {
		t.Fatalf("commit = %s %v %v", sha, files, err)
	}
	if now, _ := git.GetCommitMeta(root, "HEAD"); now.FullHash != projectHead.FullHash {
		t.Fatal("a step commit must never move the project branch")
	}
}

func TestUnreachableBrokerIsDeclaredNotCollected(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	_ = listener.Close() // a port nobody listens on
	observation := observeBroker(agenttask.VerificationWatch{Brokers: []string{address}, Topics: []string{"orders"}})
	evidence := observation.annotate(context.Background(), agenttask.Evidence{})
	if len(evidence.Observations) != 1 || evidence.Observations[0].Name != "brokerMessages" || !strings.HasPrefix(evidence.Observations[0].Value, "not collected") {
		t.Fatalf("an unreachable broker must not read as zero messages: %+v", evidence.Observations)
	}
	if untouched := (brokerObservation{}).annotate(context.Background(), agenttask.Evidence{}); len(untouched.Observations) != 0 {
		t.Fatal("a verification without watched topics must not report broker data")
	}
}

func TestUnavailableDatabaseIsDeclaredNotCollected(t *testing.T) {
	if err := storage.Open(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(storage.Close)
	observation := observeDatabase(context.Background(), "no-such-connection")
	evidence := observation.annotate(context.Background(), agenttask.Evidence{})
	if len(evidence.Observations) != 1 || evidence.Observations[0].Name != "databaseQueries" || !strings.HasPrefix(evidence.Observations[0].Value, "not collected") {
		t.Fatalf("a connection that cannot report must not read as zero queries: %+v", evidence.Observations)
	}
}
