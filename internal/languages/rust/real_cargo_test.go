package rust

import (
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"adomnia/internal/ide/run"
	idetesting "adomnia/internal/ide/testing"
)

// requireRealCargo salta il test se ADOMNIA_TEST_CARGO non è impostato: i test con gli strumenti
// reali (cargo/rust-analyzer) sono opt-in, non girano a ogni `go test` anche quando i tool ci sono
// (RS-4.8/RS-10.1).
func requireRealCargo(t *testing.T) {
	t.Helper()
	if os.Getenv("ADOMNIA_TEST_CARGO") == "" {
		t.Skip("ADOMNIA_TEST_CARGO is not set: opt in with ADOMNIA_TEST_CARGO=1 to run real-tool tests")
	}
}

// runReal esegue davvero cargo tramite il ProcessManager del core e restituisce l'esecuzione finita
// e l'output pubblicato in console.
func runReal(t *testing.T, root, kind, options string) (run.Execution, string) {
	t.Helper()
	spec, err := New().CommandSpec(run.Request{Kind: kind, Root: root, WorkingDirectory: root, LanguageOptions: []byte(options), Environment: os.Environ()})
	if err != nil {
		t.Fatal(err)
	}
	spec.SessionID, spec.Kind = "real", kind
	manager := run.NewProcessManager()
	var mu sync.Mutex
	var console strings.Builder
	finished := make(chan run.Execution, 1)
	manager.SetEventSink(func(eventType string, execution run.Execution, payload any) {
		mu.Lock()
		defer mu.Unlock()
		switch eventType {
		case "run.output":
			if output, ok := payload.(run.ProcessOutput); ok {
				console.WriteString(output.Text)
			}
		case "run.finished":
			finished <- execution
		}
	})
	if _, err := manager.Start(spec); err != nil {
		t.Fatal(err)
	}
	select {
	case execution := <-finished:
		mu.Lock()
		defer mu.Unlock()
		return execution, console.String()
	case <-time.After(3 * time.Minute):
		t.Fatal("cargo did not finish")
	}
	return run.Execution{}, ""
}

func writeCrate(t *testing.T, source string) string {
	t.Helper()
	root := t.TempDir()
	writeFile(t, root, "Cargo.toml", "[package]\nname = \"demo\"\nversion = \"0.1.0\"\nedition = \"2021\"\n")
	writeFile(t, root, "src/main.rs", source)
	return root
}

func TestRealCargoRunWaitsForConsoleInput(t *testing.T) {
	requireRealCargo(t)
	root := writeCrate(t, `use std::io;
fn main() {
    println!("enter the number:");
    let mut input = String::new();
    io::stdin().read_line(&mut input).unwrap();
    let number: u64 = input.trim().parse().unwrap();
    println!("NUMBER:{}", number);
}`)
	spec, err := New().CommandSpec(run.Request{Kind: "bin", Root: root, WorkingDirectory: root, LanguageOptions: []byte(`{}`), Environment: os.Environ()})
	if err != nil {
		t.Fatal(err)
	}
	spec.SessionID, spec.Kind = "interactive", "bin"
	manager := run.NewProcessManager()
	t.Cleanup(manager.Shutdown)
	ready := make(chan struct{}, 1)
	finished := make(chan run.Execution, 1)
	var output strings.Builder
	manager.SetEventSink(func(kind string, execution run.Execution, payload any) {
		if chunk, ok := payload.(run.ProcessOutput); ok {
			output.WriteString(chunk.Text)
			if strings.Contains(chunk.Text, "enter the number:") {
				select {
				case ready <- struct{}{}:
				default:
				}
			}
		}
		if kind == "run.finished" {
			finished <- execution
		}
	})
	execution, err := manager.Start(spec)
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-ready:
	case <-finished:
		t.Fatal("program exited before accepting input")
	case <-time.After(time.Minute):
		t.Fatal("program did not prompt for input")
	}
	select {
	case <-finished:
		t.Fatal("stdin reached EOF before user input")
	case <-time.After(150 * time.Millisecond):
	}
	if err := manager.WriteStdin(execution.ID, "12\n"); err != nil {
		t.Fatal(err)
	}
	select {
	case result := <-finished:
		if result.ExitCode == nil || *result.ExitCode != 0 || !strings.Contains(output.String(), "NUMBER:12") {
			t.Fatalf("input failed: %+v\n%s", result, output.String())
		}
	case <-time.After(10 * time.Second):
		t.Fatal("program did not consume input")
	}
}

// Con cargo vero: l'errore di tipo diventa un diagnostico strutturato, la console mostra il testo
// leggibile di rustc e nessun JSON di cargo; una build pulita pubblica una lista vuota (non nil).
func TestRealCargoBuildErrorsBecomeDiagnosticsAndReadableConsole(t *testing.T) {
	requireRealCargo(t)
	if _, err := exec.LookPath("cargo"); err != nil {
		t.Skip("cargo is not installed (set up Rust to run this check)")
	}
	broken := writeCrate(t, "fn main() {\n    let x: u32 = \"text\";\n    println!(\"{}\", x);\n}\n")
	execution, console := runReal(t, broken, "build", `{}`)
	if execution.Status != "failed" || len(execution.Diagnostics) == 0 {
		t.Fatalf("status = %q diagnostics = %+v\n%s", execution.Status, execution.Diagnostics, console)
	}
	first := execution.Diagnostics[0]
	if first.Severity != 1 || first.Code != "E0308" || !strings.HasSuffix(filepath.ToSlash(first.File), "src/main.rs") || first.Line != 2 {
		t.Fatalf("diagnostic = %+v", first)
	}
	if !strings.Contains(console, "mismatched types") || strings.Contains(console, `"reason"`) {
		t.Fatalf("console must show rustc text and no cargo JSON:\n%s", console)
	}

	clean := writeCrate(t, "fn main() { println!(\"hello from the program\"); }\n")
	execution, console = runReal(t, clean, "bin", `{"bin":"demo"}`)
	if execution.Status != "exited" || execution.Diagnostics == nil || len(execution.Diagnostics) != 0 {
		t.Fatalf("a clean run must publish an empty non-nil list: %+v %q", execution, execution.Status)
	}
	if !strings.Contains(console, "hello from the program") || strings.Contains(console, `"reason"`) {
		t.Fatalf("program output must reach the console untouched:\n%s", console)
	}
}

// RS-3.5: `cargo run` genera un figlio (il binario del crate). Fermare la Run deve chiudere l'albero:
// il binario apre una porta locale e, dopo lo stop, nessuno deve più rispondere.
func TestRealCargoRunStopEndsTheWholeProcessTree(t *testing.T) {
	requireRealCargo(t)
	if _, err := exec.LookPath("cargo"); err != nil {
		t.Skip("cargo is not installed (set up Rust to run this check)")
	}
	root := writeCrate(t, `use std::{fs, net::TcpListener, thread, time::Duration};
fn main() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    fs::write("port.txt", listener.local_addr().unwrap().port().to_string()).unwrap();
    thread::sleep(Duration::from_secs(120));
}
`)
	spec, err := New().CommandSpec(run.Request{Kind: "bin", Root: root, WorkingDirectory: root, LanguageOptions: []byte(`{"bin":"demo"}`), Environment: os.Environ()})
	if err != nil {
		t.Fatal(err)
	}
	spec.SessionID, spec.Kind = "real-stop", "bin"
	manager := run.NewProcessManager()
	t.Cleanup(manager.Shutdown)
	started, err := manager.Start(spec)
	if err != nil {
		t.Fatal(err)
	}
	var port string
	deadline := time.Now().Add(2 * time.Minute)
	for time.Now().Before(deadline) {
		if data, err := os.ReadFile(filepath.Join(root, "port.txt")); err == nil && len(data) > 0 {
			port = string(data)
			break
		}
		time.Sleep(200 * time.Millisecond)
	}
	if port == "" {
		t.Fatal("the program never started listening")
	}
	if connection, err := net.DialTimeout("tcp", "127.0.0.1:"+port, 2*time.Second); err != nil {
		t.Fatalf("the program should accept connections while it runs: %v", err)
	} else {
		_ = connection.Close()
	}
	if err := manager.Stop(started.ID); err != nil {
		t.Fatal(err)
	}
	if !manager.WaitStopped(started.ID, 20*time.Second) {
		t.Fatal("the run did not stop")
	}
	// Il figlio non ha più la porta aperta: lo stop ha chiuso cargo e il binario.
	closed := false
	for end := time.Now().Add(10 * time.Second); time.Now().Before(end); time.Sleep(200 * time.Millisecond) {
		connection, err := net.DialTimeout("tcp", "127.0.0.1:"+port, time.Second)
		if err != nil {
			closed = true
			break
		}
		_ = connection.Close()
	}
	if !closed {
		t.Fatal("the compiled binary survived the stop of `cargo run`")
	}
}

// Workspace virtuale con cargo vero: ogni test finisce nell'albero sotto il suo crate (prima il
// package vuoto faceva scartare ogni evento), e la Run singola per nome dell'albero esegue davvero
// un test invece di 0 in verde.
func TestRealCargoTestVirtualWorkspaceFillsTheTree(t *testing.T) {
	requireRealCargo(t)
	if _, err := exec.LookPath("cargo"); err != nil {
		t.Skip("cargo is not installed (set up Rust to run this check)")
	}
	root := t.TempDir()
	writeFile(t, root, "Cargo.toml", "[workspace]\nmembers = [\"util\", \"app\"]\nresolver = \"2\"\n")
	writeFile(t, root, "util/Cargo.toml", "[package]\nname = \"util\"\nversion = \"0.1.0\"\nedition = \"2021\"\n")
	writeFile(t, root, "util/src/lib.rs", "pub fn double(v: u32) -> u32 { v * 2 }\n#[cfg(test)]\nmod tests {\n    use super::*;\n    #[test]\n    fn doubles() { assert_eq!(double(2), 4); }\n}\n")
	writeFile(t, root, "app/Cargo.toml", "[package]\nname = \"app\"\nversion = \"0.1.0\"\nedition = \"2021\"\n")
	writeFile(t, root, "app/src/lib.rs", "#[cfg(test)]\nmod tests {\n    #[test]\n    fn boots() {}\n    #[test]\n    fn fails() { assert_eq!(1, 2); }\n}\n")

	collect := func(options string) map[string]string {
		t.Helper()
		spec, parser, err := New().TestCommand(idetesting.Request{Root: root, WorkingDirectory: root, Environment: os.Environ(), LanguageOptions: []byte(options)})
		if err != nil {
			t.Fatal(err)
		}
		command := exec.Command(spec.Executable, spec.Arguments...)
		command.Dir, command.Env = root, spec.Environment
		output, _ := command.CombinedOutput() // cargo test esce con errore se un test fallisce
		tree := idetesting.NewTree()
		for _, line := range strings.Split(string(output), "\n") {
			if event, ok := parser.Parse([]byte(line)); ok {
				tree.Apply(event)
			}
		}
		results, _ := tree.Snapshot()
		statuses := map[string]string{}
		for _, result := range results {
			if result.Name != "" {
				statuses[result.Package+"/"+result.Name] = result.Status
			}
		}
		return statuses
	}

	all := collect(`{}`)
	for name, want := range map[string]string{"util/tests/doubles": "pass", "app/tests/boots": "pass", "app/tests/fails": "fail"} {
		if all[name] != want {
			t.Errorf("%s = %q, want %q (all: %v)", name, all[name], want, all)
		}
	}
	// La Run singola riparte dal nome dell'albero (`tests/boots`) e deve eseguire quel test.
	if single := collect(`{"run":"tests/boots"}`); single["app/tests/boots"] != "pass" {
		t.Errorf("a rerun from the tree name must run the test, got %v", single)
	}
}
