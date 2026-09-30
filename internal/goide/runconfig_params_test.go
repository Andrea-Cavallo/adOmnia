package goide

import (
	"net"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
)

func TestParseEnvFile(t *testing.T) {
	values, err := parseEnvFile([]byte("\xef\xbb\xbf# comment\nexport A=1\nB = \"two\\nlines\"\nC='lit $x'\nD=plain # trailing\n\n"))
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{"A": "1", "B": "two\nlines", "C": "lit $x", "D": "plain"}
	for key, value := range want {
		if values[key] != value {
			t.Errorf("%s = %q, want %q", key, values[key], value)
		}
	}
	if _, err := parseEnvFile([]byte("not a pair\n")); err == nil {
		t.Error("a line without = must be rejected")
	}
}

func TestApplyRunParameters(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, ".env"), []byte("FROM_FILE=yes\nOVERRIDE=file\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	config := RunConfiguration{Kind: RunKindPackage, EnvFile: ".env", GOOS: "linux", GOARCH: "arm64", Race: true, Coverage: true}
	request := RunRequest{Environment: map[string]string{"OVERRIDE": "explicit"}, GoArguments: []string{"-v"}}
	if err := applyRunParameters(root, root, config, &request); err != nil {
		t.Fatal(err)
	}
	env := request.Environment
	if env["FROM_FILE"] != "yes" || env["OVERRIDE"] != "explicit" || env["GOOS"] != "linux" || env["GOARCH"] != "arm64" || env["CGO_ENABLED"] != "1" {
		t.Fatalf("environment: %v", env)
	}
	if env["GOCOVERDIR"] != filepath.Join(root, coverageDirectory) || !slices.Equal(request.GoArguments, []string{"-cover", "-race", "-v"}) {
		t.Fatalf("coverage/race flags: %v %v", request.GoArguments, env["GOCOVERDIR"])
	}
	escape := RunConfiguration{Kind: RunKindPackage, EnvFile: "../outside.env"}
	if err := applyRunParameters(root, root, escape, &RunRequest{Environment: map[string]string{}}); err == nil {
		t.Error("an env file outside the project must be rejected")
	}
	listener, err := net.Listen("tcp", ":0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	busy := listener.Addr().(*net.TCPAddr).Port
	if err := applyRunParameters(root, root, RunConfiguration{Kind: RunKindPackage, Port: busy}, &RunRequest{Environment: map[string]string{}}); err == nil || !strings.Contains(err.Error(), strconv.Itoa(busy)) {
		t.Errorf("a busy port must fail fast, got %v", err)
	}
}

func TestNormalizeRunParameters(t *testing.T) {
	if _, err := normalizeRunParameters(RunConfiguration{Kind: RunKindPackage, Profile: "cpu"}); err == nil {
		t.Error("profiling outside tests must be rejected")
	}
	if _, err := normalizeRunParameters(RunConfiguration{ID: "a", Kind: RunKindTest, PreRun: []string{"a"}}); err == nil {
		t.Error("a configuration must not run itself")
	}
	if _, err := normalizeRunParameters(RunConfiguration{Kind: RunKindBuild, GOOS: "linux; rm"}); err == nil {
		t.Error("GOOS must be validated")
	}
}

func TestConfiguredRunChain(t *testing.T) {
	root := t.TempDir()
	files := map[string]string{
		"go.mod":       "module chain\n\ngo 1.22\n",
		"pre/main.go":  "package main\n\nimport \"fmt\"\n\nfunc main() { fmt.Println(\"pre done\") }\n",
		"fail/main.go": "package main\n\nimport \"os\"\n\nfunc main() { os.Exit(3) }\n",
		"app/main.go":  "package main\n\nimport (\"fmt\"; \"os\")\n\nfunc main() { fmt.Println(\"main\", os.Getenv(\"FROM_FILE\"), os.Getenv(\"PORT\")) }\n",
		"post/main.go": "package main\n\nimport \"fmt\"\n\nfunc main() { fmt.Println(\"post done\") }\n",
		".env":         "FROM_FILE=loaded\n",
	}
	for name, content := range files {
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	events := make(chan EventEnvelope, 1024)
	service := NewService(&memoryStore{}, func(event EventEnvelope) { events <- event })
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetToolAuthorization(string(session.ID), true); err != nil {
		t.Fatal(err)
	}
	save := func(config RunConfiguration) RunConfiguration {
		t.Helper()
		saved, err := service.SaveRunConfiguration(string(session.ID), config)
		if err != nil {
			t.Fatal(err)
		}
		return saved
	}
	pre := save(RunConfiguration{Name: "pre", Kind: RunKindPackage, Target: "./pre"})
	fail := save(RunConfiguration{Name: "fail", Kind: RunKindPackage, Target: "./fail"})
	post := save(RunConfiguration{Name: "post", Kind: RunKindPackage, Target: "./post"})
	app := save(RunConfiguration{Name: "app", Kind: RunKindPackage, Target: "./app", EnvFile: ".env", Port: freePort(t), PreRun: []string{pre.ID}, PostRun: []string{post.ID}})

	if _, err := service.StartConfiguredRun(string(session.ID), app.ID, nil); err != nil {
		t.Fatal(err)
	}
	var order []string
	for _, marker := range []string{"pre done", "main loaded", "post done"} {
		waitServiceEvent(t, events, func(event EventEnvelope) bool {
			output, ok := event.Payload.(ProcessOutput)
			return ok && strings.Contains(output.Text, marker)
		})
		order = append(order, marker)
	}
	if len(order) != 3 {
		t.Fatalf("chain order: %v", order)
	}

	blocked := save(RunConfiguration{Name: "blocked", Kind: RunKindPackage, Target: "./app", PreRun: []string{fail.ID}})
	if _, err := service.StartConfiguredRun(string(session.ID), blocked.ID, nil); err != nil {
		t.Fatal(err)
	}
	waitServiceEvent(t, events, func(event EventEnvelope) bool {
		output, ok := event.Payload.(ProcessOutput)
		return ok && strings.Contains(output.Text, "Task \"fail\" non riuscito")
	})
}

func freePort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp", ":0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port
}
