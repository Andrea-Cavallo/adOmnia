package rust

import (
	"strings"
	"testing"

	idetesting "adomnia/internal/ide/testing"
)

// Il lock di `target/` non è un blocco dell'IDE: la riga di cargo va riconosciuta e spiegata,
// una sola volta per esecuzione (RS-3.5).
func TestRunConsoleExplainsTheBuildLockOnce(t *testing.T) {
	console := runConsole(workspacePaths{})
	text, handled := console("    Blocking waiting for file lock on build directory")
	if !handled {
		t.Fatal("the build lock line is not recognized")
	}
	if !strings.HasPrefix(text, "    Blocking waiting for file lock on build directory") {
		t.Fatalf("the original line is not kept: %q", text)
	}
	if !strings.Contains(text, buildLockExplanation) {
		t.Fatalf("the lock is not explained: %q", text)
	}
	second, handled := console("Blocking waiting for file lock on package cache")
	if !handled {
		t.Fatal("the second lock line is not recognized")
	}
	if strings.Contains(second, buildLockExplanation) {
		t.Fatalf("the explanation is repeated: %q", second)
	}
}

// Le righe che non sono il lock restano alla ConsoleLine dei percorsi (RS-3.3).
func TestRunConsoleLeavesOtherLinesToThePathRewrite(t *testing.T) {
	console := runConsole(workspacePaths{})
	for _, line := range []string{"   Compiling api v0.1.0", "error: could not compile `api`", "thread 'main' panicked at src/main.rs:3:5"} {
		if _, handled := console(line); handled {
			t.Fatalf("a plain output line is rewritten: %q", line)
		}
	}
}

// Anche `cargo test` mostra la spiegazione: la sua ConsoleLine è la stessa della Run.
func TestTestCommandExplainsTheBuildLock(t *testing.T) {
	spec, _, err := New().TestCommand(idetesting.Request{Root: t.TempDir(), WorkingDirectory: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	if spec.ConsoleLine == nil {
		t.Fatal("cargo test has no console rewriter")
	}
	text, handled := spec.ConsoleLine("Blocking waiting for file lock on build directory")
	if !handled || !strings.Contains(text, buildLockExplanation) {
		t.Fatalf("cargo test does not explain the build lock: %q", text)
	}
}
