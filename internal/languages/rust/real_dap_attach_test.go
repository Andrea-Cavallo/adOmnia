package rust

import (
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/dap"
)

// writeLoopCrate scrive un bin che gira finché non viene terminato: la riga 5 si ripete ogni 50 ms.
func writeLoopCrate(t *testing.T, root string) {
	t.Helper()
	writeFile(t, root, "Cargo.toml", "[package]\nname = \"looper\"\nversion = \"0.1.0\"\nedition = \"2021\"\n")
	writeFile(t, root, "src/main.rs", strings.Join([]string{
		"fn main() {",
		"    let mut ticks: u64 = 0;",
		"    loop {",
		"        std::thread::sleep(std::time::Duration::from_millis(50));",
		"        ticks = std::hint::black_box(ticks + 1);",
		"    }",
		"}",
		"",
	}, "\n"))
}

// TestRealCodeLLDBAttachesToRunningProcess: Attach to Rust Process su un programma già avviato
// fuori da adOmnia. Il breakpoint si lega, la fermata arriva sulla riga del loop e Stop stacca il
// debugger lasciando vivo il programma. Opt-in come gli altri test reali (ADOMNIA_TEST_CARGO).
func TestRealCodeLLDBAttachesToRunningProcess(t *testing.T) {
	requireRealCargo(t)
	adapterPath, _, _ := LocateCodeLLDB(os.Getenv("ADOMNIA_TEST_TOOLS"))
	if adapterPath == "" {
		t.Skip("CodeLLDB is not installed: install it (Install CodeLLDB…) or set ADOMNIA_TEST_TOOLS to run this check")
	}
	root := t.TempDir()
	writeLoopCrate(t, root)
	toolchain, err := ResolveToolchain(root, root, "")
	if err != nil {
		t.Fatal(err)
	}
	program, err := buildArtifactPath(toolchain.Cargo, root, DebugOptions{Bin: "looper"})
	if err != nil {
		t.Fatal(err)
	}
	target := exec.Command(program)
	if err := target.Start(); err != nil {
		t.Fatal(err)
	}
	exited := make(chan error, 1)
	go func() { exited <- target.Wait() }()
	t.Cleanup(func() { _ = target.Process.Kill(); <-exited })

	spec, err := New().DebugAdapter(dap.LaunchRequest{
		Root: root, WorkingDirectory: root, Environment: os.Environ(),
		LanguageOptions: []byte(`{"processId":` + strconv.Itoa(target.Process.Pid) + `,"adapter":` + strconv.Quote(adapterPath) + `}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	rig := newDAPRig(t)
	sessionID := dap.SessionID("real-rust-attach")
	source := filepath.Join(root, "src", "main.rs")
	rig.manager.SetBreakpoints(sessionID, root, source, []dap.Breakpoint{{Line: 5}})
	started, err := rig.manager.Start(dap.Launch{SessionID: sessionID, Root: root, Spec: spec})
	if err != nil {
		t.Fatal(err)
	}
	stopped := rig.waitState(started.ID, dap.DebugStopped)
	if stopped.StopReason != "breakpoint" {
		t.Fatalf("stop reason = %q", stopped.StopReason)
	}
	threadID := stopped.ThreadID
	frames, err := rig.manager.StackTrace(started.ID, threadID)
	if err != nil || len(frames) == 0 || frames[0].Line != 5 || !strings.HasSuffix(filepath.ToSlash(frames[0].Path), "src/main.rs") {
		t.Fatalf("frames = %+v %v", frames, err)
	}

	if err := rig.manager.Stop(started.ID); err != nil {
		t.Fatal(err)
	}
	rig.waitState(started.ID, dap.DebugTerminated)
	select {
	case err := <-exited:
		t.Fatalf("Stop after attach must detach and leave the program running, it exited: %v", err)
	case <-time.After(time.Second):
	}
}
