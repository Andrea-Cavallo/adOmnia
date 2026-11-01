package codestudio

import (
	"context"
	"encoding/json/v2"
	"fmt"
	"net/http"
	"net/url"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/httpexec"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/agenttask"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/language"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
	idetesting "github.com/Andrea-Cavallo/adOmnia/internal/ide/testing"
)

// TaskVerifier runs an agent task's verifications with the same services the IDE uses.
// It never decides "passed" on its own: an adapter or the HTTP executor reports the result.
type TaskVerifier struct {
	languages *language.Registry
	// service avvia le configurazioni di Run delle verifiche; nil = non disponibile.
	service *Service
	// evidenceDir conserva i file delle evidenze (screenshot); vuoto = non salvati.
	evidenceDir string
}

func NewTaskVerifier(languages *language.Registry) *TaskVerifier {
	return &TaskVerifier{languages: languages}
}

// AgentTaskVerifier gives the agent-task service a verifier bound to this IDE's
// language registry, so a verification runs the registered adapter and not a copy.
func (s *Service) AgentTaskVerifier(evidenceDir string) agenttask.Verifier {
	verifier := NewTaskVerifier(s.workspace.languages)
	verifier.service, verifier.evidenceDir = s, evidenceDir
	return verifier
}

// Trusted reports whether the user already authorized tooling in this project.
// It restores the persisted trust list first, so a restart does not silently
// demote a project the user already approved.
func (s *Service) Trusted(realPath string) bool {
	if err := s.restore(); err != nil {
		return false
	}
	return s.isTrusted(realPath)
}

func (verifier *TaskVerifier) Run(ctx context.Context, request agenttask.VerifyRequest) agenttask.Evidence {
	switch request.Verification.Kind {
	case agenttask.VerificationTest:
		return verifier.runTest(ctx, request)
	case agenttask.VerificationRequest:
		return verifier.runRequest(ctx, request)
	case agenttask.VerificationPage:
		return verifier.runPage(ctx, request)
	default:
		return agenttask.Evidence{Outcome: agenttask.EvidenceError, Log: "unknown verification kind"}
	}
}

func (verifier *TaskVerifier) runTest(ctx context.Context, request agenttask.VerifyRequest) agenttask.Evidence {
	verification := request.Verification
	evidence := agenttask.Evidence{
		Outcome:     agenttask.EvidenceError,
		Environment: fmt.Sprintf("%s/%s", runtime.GOOS, runtime.GOARCH),
	}
	languageID := verification.Language
	if languageID == "" {
		languageID = "go"
	}
	adapter, ok := verifier.languages.Get(languageID)
	if !ok {
		evidence.Log = fmt.Sprintf("no language adapter is registered for %q", languageID)
		return evidence
	}
	testRunner, ok := adapter.(language.TestRunner)
	if !ok {
		evidence.Log = fmt.Sprintf("the %s adapter cannot run tests", adapter.Name())
		return evidence
	}
	executable, err := testExecutable(languageID)
	if err != nil {
		evidence.Log = err.Error()
		return evidence
	}
	options, err := json.Marshal(map[string]any{
		"packages": verification.Packages, "run": verification.Run, "coverage": verification.Coverage,
	})
	if err != nil {
		evidence.Log = "could not encode the test options"
		return evidence
	}
	workingDirectory := request.Workdir
	if verification.WorkingDirectory != "" {
		workingDirectory = filepath.Join(request.Workdir, filepath.FromSlash(verification.WorkingDirectory))
	}
	spec, parser, err := testRunner.TestCommand(idetesting.Request{
		Root: request.Workdir, Executable: executable, WorkingDirectory: workingDirectory,
		LanguageOptions: options,
	})
	if err != nil {
		evidence.Log = err.Error()
		return evidence
	}
	spec.SessionID = run.SessionID("agent-verify-" + request.TaskID)
	spec.Kind = "test"
	processes := run.NewProcessManager()
	defer processes.Shutdown()
	manager := idetesting.NewManager()
	snapshot, err := manager.Start(processes, spec, parser, options, idetesting.Hooks{})
	if err != nil {
		evidence.Log = err.Error()
		return evidence
	}
	evidence.Command = snapshot.Command
	if snapshot.Command == "" {
		evidence.Command = executable + " " + strings.Join(spec.Arguments, " ")
	}
	timeout := time.Duration(normalizedTimeout(verification.TimeoutSeconds)) * time.Second
	finished := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			_ = processes.Stop(snapshot.RunID)
		case <-finished:
		}
	}()
	stopped := processes.WaitStopped(snapshot.RunID, timeout)
	close(finished)
	if !stopped {
		// Il timeout chiude davvero il processo: nessun figlio resta attivo dopo la verifica.
		_ = processes.Stop(snapshot.RunID)
		_ = processes.WaitStopped(snapshot.RunID, 5*time.Second)
	}
	final, err := manager.Snapshot(snapshot.RunID)
	if err != nil {
		evidence.Log = "the test run produced no result: " + err.Error()
		return evidence
	}
	evidence.Command = valueOr(final.Command, evidence.Command)
	evidence.ExitCode = final.ExitCode
	evidence.DurationMs = elapsedMillis(final.StartedAt, final.FinishedAt)
	evidence.Log = testLog(final)
	evidence.Observations = []agenttask.Observation{
		{Name: "passed", Value: fmt.Sprintf("%d", final.Summary.Passed)},
		{Name: "failed", Value: fmt.Sprintf("%d", final.Summary.Failed)},
		{Name: "skipped", Value: fmt.Sprintf("%d", final.Summary.Skipped)},
	}
	switch {
	case ctx.Err() != nil:
		evidence.Outcome = agenttask.EvidenceError
		evidence.Log = "verification interrupted: " + ctx.Err().Error() + "\n" + evidence.Log
	case !stopped || final.Status == "running":
		evidence.Outcome = agenttask.EvidenceError
		evidence.Log = fmt.Sprintf("the tests did not finish within %s\n", timeout) + evidence.Log
	case final.Summary.Failed > 0 || final.Summary.Passed == 0 && final.ExitCode != nil && *final.ExitCode != 0:
		// Nessun test raccolto con exit code non zero è una build fallita, non un superamento.
		evidence.Outcome = agenttask.EvidenceFailed
	case final.ExitCode != nil && *final.ExitCode != 0:
		evidence.Outcome = agenttask.EvidenceFailed
	default:
		evidence.Outcome = agenttask.EvidencePassed
	}
	return evidence
}

func (verifier *TaskVerifier) runRequest(ctx context.Context, request agenttask.VerifyRequest) agenttask.Evidence {
	verification := request.Verification
	evidence := agenttask.Evidence{Outcome: agenttask.EvidenceError, Environment: "http"}
	parsed, err := url.Parse(verification.URL)
	if err != nil || parsed.Host == "" {
		evidence.Log = "invalid URL"
		return evidence
	}
	evidence.Command = verification.Method + " " + verification.URL
	if !verification.AllowRemote && !agenttask.IsLoopbackHost(parsed.Hostname()) {
		evidence.Outcome = agenttask.EvidenceNotRun
		evidence.Log = fmt.Sprintf("%s is not a loopback host. A request with external effects is never sent automatically: approve remote hosts on the verification first.", parsed.Hostname())
		return evidence
	}
	return verifier.withServiceAndMock(ctx, request, parsed, evidence, func(base agenttask.Evidence) agenttask.Evidence {
		return verifier.sendRequest(request.TaskID, verification, base)
	})
}

// withServiceAndMock runs probe, first starting the verification's service when it has
// one, and records the mock server calls made meanwhile. Shared by requests and pages.
func (verifier *TaskVerifier) withServiceAndMock(ctx context.Context, request agenttask.VerifyRequest, target *url.URL, evidence agenttask.Evidence, probe func(agenttask.Evidence) agenttask.Evidence) agenttask.Evidence {
	// Le chiamate al mock server, i messaggi del broker e le query durante la verifica sono misure, non deduzioni.
	observation := observeMock()
	messages := observeBroker(request.Verification.Watch)
	queries := observeDatabase(ctx, request.Verification.Watch.Database)
	observed := func(result agenttask.Evidence) agenttask.Evidence {
		return queries.annotate(ctx, messages.annotate(ctx, observation.annotate(result)))
	}
	if !request.Verification.Service.Enabled() {
		return observed(probe(evidence))
	}
	launched, started := verifier.startService(ctx, request, target)
	if launched == nil {
		if started.Outcome == agenttask.EvidenceNotRun {
			return started
		}
		return observed(started)
	}
	result := probe(started)
	launched.stop()
	return observed(launched.annotate(result))
}

func (verifier *TaskVerifier) sendRequest(taskID string, verification agenttask.Verification, evidence agenttask.Evidence) agenttask.Evidence {
	headers := make(map[string]string, len(verification.Headers))
	for _, header := range verification.Headers {
		headers[header.Name] = header.Value
	}
	payload, err := json.Marshal(httpexec.HTTPExecRequest{
		ID: "agent-verify-" + taskID, Method: verification.Method, URL: verification.URL,
		Headers: headers, Body: verification.Body, FollowRedirects: true,
		TimeoutMs: normalizedTimeout(verification.TimeoutSeconds) * 1000,
	})
	if err != nil {
		evidence.Log = "could not encode the request"
		return evidence
	}
	started := time.Now()
	raw := httpexec.Execute(string(payload))
	var response httpexec.HTTPExecResponse
	if err := json.Unmarshal([]byte(raw), &response); err != nil {
		evidence.Log = "the request produced no readable response"
		return evidence
	}
	evidence.DurationMs = time.Since(started).Milliseconds()
	if response.Error != nil {
		evidence.Log = fmt.Sprintf("%s: %s", response.Error.Code, response.Error.Message)
		return evidence
	}
	expected := verification.ExpectedStatus
	if expected == 0 {
		expected = http.StatusOK
	}
	evidence.Log = fmt.Sprintf("HTTP %d %s in %d ms\n%s\n%s", response.Status, response.StatusText, response.Ms, formatHeaders(response.Headers), truncateText(response.Body, 8*1024))
	evidence.Observations = []agenttask.Observation{
		{Name: "status", Value: fmt.Sprintf("%d", response.Status)},
		{Name: "expectedStatus", Value: fmt.Sprintf("%d", expected)},
		{Name: "durationMs", Value: fmt.Sprintf("%d", response.Ms)},
		{Name: "sizeBytes", Value: fmt.Sprintf("%d", response.Size)},
	}
	status := int(response.Status)
	evidence.ExitCode = &status
	if status == expected {
		evidence.Outcome = agenttask.EvidencePassed
	} else {
		evidence.Outcome = agenttask.EvidenceFailed
	}
	return evidence
}

func testLog(snapshot idetesting.Snapshot) string {
	var builder strings.Builder
	if snapshot.Diagnostics != "" {
		builder.WriteString(snapshot.Diagnostics)
		builder.WriteString("\n")
	}
	shown := 0
	for _, result := range snapshot.Results {
		if result.Status != "fail" && result.Status != "timeout" && result.Output == "" {
			continue
		}
		if result.Status != "fail" && result.Status != "timeout" {
			continue
		}
		shown++
		if shown > 20 {
			builder.WriteString("… more failing tests omitted\n")
			break
		}
		fmt.Fprintf(&builder, "--- %s %s\n%s\n", result.Package, result.Name, result.Output)
	}
	if shown == 0 && snapshot.Summary.Failed == 0 && snapshot.Diagnostics == "" {
		builder.WriteString(fmt.Sprintf("%d tests passed", snapshot.Summary.Passed))
	}
	return builder.String()
}

func testExecutable(languageID string) (string, error) {
	name := ""
	switch languageID {
	case "go":
		name = "go"
	case "python":
		name = "python3"
	case "rust":
		name = "cargo"
	default:
		return "", fmt.Errorf("test verification for %q is not available in this build", languageID)
	}
	path, err := exec.LookPath(name)
	if err != nil {
		return "", fmt.Errorf("%s is not on PATH; install it or configure the project toolchain", name)
	}
	return path, nil
}

func normalizedTimeout(seconds int) int {
	if seconds < 1 {
		return 120
	}
	if seconds > 600 {
		return 600
	}
	return seconds
}

func formatHeaders(headers map[string]string) string {
	if len(headers) == 0 {
		return ""
	}
	names := make([]string, 0, len(headers))
	for name := range headers {
		names = append(names, name)
	}
	sort.Strings(names)
	var builder strings.Builder
	for _, name := range names {
		fmt.Fprintf(&builder, "%s: %s\n", name, headers[name])
	}
	return builder.String()
}

func truncateText(text string, limit int) string {
	if len(text) <= limit {
		return text
	}
	return text[:limit] + "… [truncated]"
}

func elapsedMillis(started time.Time, finished *time.Time) int64 {
	if finished == nil {
		return 0
	}
	return finished.Sub(started).Milliseconds()
}

func valueOr(value, fallback string) string {
	if value != "" {
		return value
	}
	return fallback
}

var _ agenttask.Verifier = (*TaskVerifier)(nil)
