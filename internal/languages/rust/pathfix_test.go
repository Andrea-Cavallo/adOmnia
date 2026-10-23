package rust

import (
	"path/filepath"
	"testing"
)

func TestWorkspacePathsResolveRelativeToTheWorkspaceRoot(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "crates/api/src/main.rs", "fn main() {}\n")
	writeFile(t, root, "crates/api/src/local.rs", "")
	crate := filepath.Join(root, "crates", "api")
	paths := workspacePaths{directory: crate, root: root}

	// rustc stampa dalla radice del workspace; la Run parte dal crate.
	if got := paths.resolve("crates/api/src/main.rs"); got != "src/main.rs" {
		t.Fatalf("resolve = %q", got)
	}
	// Già valido dalla cartella di lavoro, assoluto, introvabile o fuori dal progetto: invariato.
	for _, path := range []string{"src/local.rs", filepath.Join(root, "crates", "api", "src", "main.rs"), "crates/missing/src/x.rs", "/rustc/abc/library/core/src/panicking.rs"} {
		if got := paths.resolve(path); got != "" {
			t.Errorf("resolve(%q) = %q, want unchanged", path, got)
		}
	}
}

func TestWorkspacePathsRootRelativeUsesTheProjectRoot(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "crates/api/src/main.rs", "fn main() {}\n")
	paths := workspacePaths{directory: filepath.Join(root, "crates", "api"), root: root}

	// Il frontend apre i fallimenti per il percorso relativo alla radice del progetto (RS-5.5).
	if got := paths.rootRelative("src/main.rs"); got != "crates/api/src/main.rs" {
		t.Fatalf("rootRelative = %q", got)
	}
	if got := paths.rootRelative(filepath.Join(root, "util", "src", "lib.rs")); got != "util/src/lib.rs" {
		t.Fatalf("rootRelative of an absolute path = %q", got)
	}
}

func TestPathFixingConsoleRewritesDiagnosticsAndPanicsButNotOtherOutput(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "crates/api/src/main.rs", "fn main() {}\n")
	console := pathFixingConsole(workspacePaths{directory: filepath.Join(root, "crates", "api"), root: root})

	rendered := `{"reason":"compiler-message","message":{"level":"error","message":"x","spans":[],"children":[],"rendered":"error: x\n \u001b[1m\u001b[38;5;12m--> \u001b[0mcrates/api/src/main.rs:3:5\n"}}`
	text, handled := console(rendered)
	if !handled || text != "error: x\n \x1b[1m\x1b[38;5;12m--> \x1b[0msrc/main.rs:3:5\n" {
		t.Fatalf("rendered = %q %v", text, handled)
	}
	text, handled = console("thread 'main' panicked at crates/api/src/main.rs:7:9:")
	if !handled || text != "thread 'main' panicked at src/main.rs:7:9:" {
		t.Fatalf("panic = %q %v", text, handled)
	}
	if _, handled := console("listening on 127.0.0.1:8080"); handled {
		t.Fatal("ordinary program output must pass through")
	}
	if text, handled := console(`{"reason":"build-finished","success":true}`); !handled || text != "" {
		t.Fatalf("cargo noise must stay hidden: %q %v", text, handled)
	}
}
