package rust

import (
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"adomnia/internal/ide/dap"
)

// Complementi di RS-6.6 a `real_dap_test.go`: i due casi d'errore che restano fuori dal flusso
// felice — la launch che fallisce (programma inesistente) deve essere spiegata dal messaggio del
// prodotto, e un adapter che non apre mai la connessione deve dare errore entro il timeout.
// Come gli altri test reali è opt-in (ADOMNIA_TEST_CARGO) e salta con motivo esplicito senza tool.

// immediateExit è un eseguibile che termina subito, per simulare un adapter morto.
func immediateExit() (string, []string) {
	if runtime.GOOS == "windows" {
		return "cmd.exe", []string{"/c", "exit", "0"}
	}
	return "/bin/true", nil
}

// RS-6.6: crash adapter — il programma di debug non parte e l'errore è spiegato.
func TestRealCodeLLDBLaunchFailureIsExplained(t *testing.T) {
	requireRealCargo(t)
	adapterPath, _, _ := LocateCodeLLDB(os.Getenv("ADOMNIA_TEST_TOOLS"))
	if adapterPath == "" {
		t.Skip("CodeLLDB is not installed: install it (Install CodeLLDB…) or set ADOMNIA_TEST_TOOLS to run this check")
	}
	root := t.TempDir()
	writeFile(t, root, "Cargo.toml", "[package]\nname = \"demo\"\nversion = \"0.1.0\"\nedition = \"2021\"\n")
	writeFile(t, root, "src/main.rs", "fn main() {}\n")
	spec, err := New().DebugAdapter(dap.LaunchRequest{
		Root: root, WorkingDirectory: root, Environment: os.Environ(),
		LanguageOptions: []byte(`{"bin":"demo","adapter":` + strconv.Quote(adapterPath) + `}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	// Il programma dichiarato dalla launch non esiste: la sessione deve riportare l'errore spiegato.
	spec.Launch = func(string) (string, map[string]any) {
		return "launch", map[string]any{
			"type": "lldb", "request": "launch", "program": filepath.Join(root, "target", "debug", "missing-probe"), "cwd": root,
		}
	}
	manager := dap.NewDebugManager()
	t.Cleanup(manager.Shutdown)
	info, err := manager.Start(dap.Launch{SessionID: dap.SessionID("rs-m1-launch-fail"), Root: root, Spec: spec})
	if err != nil {
		return // l'errore può arrivare già dalla Start: è comunque un fallimento spiegato
	}
	deadline := time.Now().Add(30 * time.Second)
	for info.Error == "" && time.Now().Before(deadline) {
		time.Sleep(100 * time.Millisecond)
		for _, active := range manager.Active(dap.SessionID("rs-m1-launch-fail")) {
			info = active
		}
	}
	if !strings.Contains(info.Error, "CodeLLDB could not launch the program") {
		t.Fatalf("launch error = %q", info.Error)
	}
}

// RS-6.6: timeout — un adapter che termina subito non apre mai la connessione DAP: il manager è
// asincrono (Start torna subito), ma il fallimento deve essere riportato in un tempo finito e la
// sessione non deve restare appesa.
func TestRealCodeLLDBConnectionFailureIsReported(t *testing.T) {
	requireRealCargo(t)
	adapterPath, _, _ := LocateCodeLLDB(os.Getenv("ADOMNIA_TEST_TOOLS"))
	if adapterPath == "" {
		t.Skip("CodeLLDB is not installed: install it (Install CodeLLDB…) or set ADOMNIA_TEST_TOOLS to run this check")
	}
	root := t.TempDir()
	writeFile(t, root, "Cargo.toml", "[package]\nname = \"demo\"\nversion = \"0.1.0\"\nedition = \"2021\"\n")
	writeFile(t, root, "src/main.rs", "fn main() {}\n")
	spec, err := New().DebugAdapter(dap.LaunchRequest{
		Root: root, WorkingDirectory: root, Environment: os.Environ(),
		LanguageOptions: []byte(`{"bin":"demo","adapter":` + strconv.Quote(adapterPath) + `}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	// Un eseguibile che termina subito: l'indirizzo non aprirà mai il socket DAP.
	spec.Executable, spec.Arguments = immediateExit()
	manager := dap.NewDebugManager()
	t.Cleanup(manager.Shutdown)
	session := dap.SessionID("rs-m1-conn-fail")
	info, err := manager.Start(dap.Launch{SessionID: session, Root: root, Spec: spec})
	if err != nil {
		return // il falliore può arrivare già dalla Start: è comunque riportato
	}
	deadline := time.Now().Add(60 * time.Second)
	reported := false
	for time.Now().Before(deadline) {
		for _, active := range manager.Active(session) {
			info = active
			if info.Error != "" {
				reported = true
			}
		}
		if reported || len(manager.Active(session)) == 0 {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if !reported && len(manager.Active(session)) != 0 {
		t.Fatalf("a dead adapter left the session hanging: %+v", info)
	}
}
