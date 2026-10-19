package strix

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestMain fa da finto `strix`: il binario di test, rilanciato con STRIX_FAKE=1, scrive gli artefatti e esce con 2.
func TestMain(m *testing.M) {
	if os.Getenv("STRIX_FAKE") == "1" {
		dir := filepath.Join("strix_runs", "fake-run")
		_ = os.MkdirAll(filepath.Join(dir, "vulnerabilities"), 0o755)
		_ = os.WriteFile(filepath.Join(dir, "penetration_test_report.md"), []byte("# Report\nSQL injection in login"), 0o644)
		_ = os.WriteFile(filepath.Join(dir, "vulnerabilities", "vuln-1.md"), []byte("# SQL injection\nPoC: ' OR 1=1"), 0o644)
		_ = os.WriteFile(filepath.Join(dir, "run.json"), []byte(`{"status":"completed","llm_usage":{"cost":0.42}}`), 0o644)
		_ = os.WriteFile(filepath.Join(dir, "findings.sarif"), []byte(`{"runs":[{"tool":{"driver":{"rules":[{"id":"V1","shortDescription":{"text":"SQL injection"},"properties":{"security-severity":"9.1"}}]}},"results":[{"ruleId":"V1","level":"error","message":{"text":"login query"},"locations":[{"physicalLocation":{"artifactLocation":{"uri":"auth/login.go"},"region":{"startLine":12}}}]}]}]}`), 0o644)
		println("key=" + os.Getenv("LLM_API_KEY") + " model=" + os.Getenv("STRIX_LLM") + " args=" + strings.Join(os.Args[1:], " "))
		os.Exit(2)
	}
	os.Exit(m.Run())
}

func TestValidate(t *testing.T) {
	root := t.TempDir()
	if _, err := (Options{}).Validate(); err == nil {
		t.Fatal("empty root must be rejected")
	}
	if _, err := (Options{Root: filepath.Join(root, "missing")}).Validate(); err == nil {
		t.Fatal("missing folder must be rejected")
	}
	if _, err := (Options{Root: root, Mode: "insane"}).Validate(); err == nil {
		t.Fatal("unknown mode must be rejected")
	}
	if _, err := (Options{Root: root, MaxBudget: -1}).Validate(); err == nil {
		t.Fatal("negative budget must be rejected")
	}
	options, err := Options{Root: root, MaxBudget: 5, Instruction: " focus on auth "}.Validate()
	if err != nil || options.Mode != ModeQuick || options.Instruction != "focus on auth" {
		t.Fatalf("options: %+v %v", options, err)
	}
	args := strings.Join(options.Arguments("/copy"), " ")
	if args != "-n --target /copy --scan-mode quick --max-budget 5 --instruction focus on auth" {
		t.Fatalf("arguments: %s", args)
	}
}

func TestLLMFromProvider(t *testing.T) {
	llm, err := LLMFromProvider("anthropic", "claude-sonnet", "k", "")
	if err != nil || llm.Model != "anthropic/claude-sonnet" {
		t.Fatalf("anthropic: %+v %v", llm, err)
	}
	if llm, _ := LLMFromProvider("openrouter-like", "x", "", ""); llm.Model != "" {
		t.Fatal("unknown provider must fail")
	}
	llm, _ = LLMFromProvider("openai-compatible", "openai/gpt-x", "", "http://localhost:1234/v1")
	if llm.Model != "openai/gpt-x" || !strings.Contains(strings.Join(llm.Environment(), " "), "LLM_API_BASE=http://localhost:1234/v1") {
		t.Fatalf("compatible: %+v", llm)
	}
	if _, err := LLMFromProvider("openai", " ", "", ""); err == nil {
		t.Fatal("missing model must fail")
	}
}

func TestCopyProjectSkipsSecretsAndDependencies(t *testing.T) {
	root, dst := t.TempDir(), filepath.Join(t.TempDir(), "copy")
	write := func(name, body string) {
		path := filepath.Join(root, filepath.FromSlash(name))
		_ = os.MkdirAll(filepath.Dir(path), 0o755)
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("main.go", "package main")
	write("pkg/util.go", "package pkg")
	write(".env", "TOKEN=secret")
	write(".env.example", "TOKEN=")
	write("certs/server.key", "PRIVATE")
	write("node_modules/lib/index.js", "x")
	snapshot, err := CopyProject(context.Background(), root, dst)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Files != 3 {
		t.Fatalf("copied %d files: %+v", snapshot.Files, snapshot)
	}
	for _, kept := range []string{"main.go", "pkg/util.go", ".env.example"} {
		if _, err := os.Stat(filepath.Join(dst, filepath.FromSlash(kept))); err != nil {
			t.Errorf("%s should be copied: %v", kept, err)
		}
	}
	for _, left := range []string{".env", "certs/server.key", "node_modules/lib/index.js"} {
		if _, err := os.Stat(filepath.Join(dst, filepath.FromSlash(left))); err == nil {
			t.Errorf("%s must not be copied", left)
		}
	}
}

func TestRunEndToEndWithFakeStrix(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "main.go"), []byte("package main"), 0o644); err != nil {
		t.Fatal(err)
	}
	self, _ := os.Executable()
	t.Setenv("STRIX_FAKE", "1")
	manager := NewManager(t.TempDir())
	manager.binary = func() (string, error) { return self, nil }
	started, err := manager.Start(Options{Root: root, Mode: ModeStandard}, LLM{Model: "anthropic/x", APIKey: "sk-secret-123"})
	if err != nil {
		t.Fatal(err)
	}
	var status Run
	for deadline := time.Now().Add(30 * time.Second); time.Now().Before(deadline); time.Sleep(50 * time.Millisecond) {
		if status, err = manager.Status(started.ID, 0); err != nil {
			t.Fatal(err)
		}
		if status.State != StatePreparing && status.State != StateRunning {
			break
		}
	}
	if status.State != StateFound || status.ExitCode != 2 {
		t.Fatalf("state %s exit %d error %q output %v", status.State, status.ExitCode, status.Error, status.Output)
	}
	output := strings.Join(status.Output, "\n")
	if strings.Contains(output, "sk-secret-123") || !strings.Contains(output, "model=anthropic/x") || !strings.Contains(output, "--scan-mode standard") {
		t.Fatalf("output must hide the key and show the call: %s", output)
	}
	if _, err := os.Stat(filepath.Join(root, "strix_runs")); err == nil {
		t.Fatal("the project must not receive scan artifacts")
	}
	report, err := manager.Report(started.ID)
	if err != nil || len(report.Findings) != 1 || report.Findings[0].Severity != "critical" || report.Findings[0].Line != 12 || report.CostUSD != 0.42 || len(report.Details) != 1 {
		t.Fatalf("report: %+v %v", report, err)
	}
	markdown, err := manager.Export(started.ID)
	if err != nil || !strings.Contains(markdown, "| critical | SQL injection | auth/login.go:12 |") || !strings.Contains(markdown, "PoC: ' OR 1=1") {
		t.Fatalf("export: %v\n%s", err, markdown)
	}
	// Output incrementale: chi ha già visto tutto non riceve righe.
	if again, _ := manager.Status(started.ID, status.Offset); len(again.Output) != 0 {
		t.Fatalf("incremental output: %v", again.Output)
	}
}
