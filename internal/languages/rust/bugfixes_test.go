package rust

import (
	"path/filepath"
	"testing"
)

// Regressioni per i bug MEDI (2026-10-22): ogni fix ha una prova.

func TestParseCargoDependenciesIgnoresLaterSections(t *testing.T) {
	deps := ParseCargoDependencies([]byte(`[dependencies]
serde = "1.0"

[features]
default = ["serde"]

[profile.release]
opt-level = 3
`))
	if len(deps) != 1 || deps[0].Name != "serde" {
		t.Fatalf("phantom dependencies after [features]/[profile.*]: %+v", deps)
	}
}

func TestParseCargoDependenciesTrimsTrailingComment(t *testing.T) {
	deps := ParseCargoDependencies([]byte("[dependencies]\nserde = \"1.0.219\" # latest stable\n"))
	if len(deps) != 1 || deps[0].Version != "1.0.219" {
		t.Fatalf("version corrupted by trailing comment: %+v", deps)
	}
}

func TestRustEditionWalksUpToCrate(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "Cargo.toml", "[package]\nname = \"app\"\nedition = \"2024\"\n")
	if edition := rustEdition(filepath.Join(root, "src", "bin")); edition != "2024" {
		t.Fatalf("edition must be read from the crate root, got %q", edition)
	}
}

func TestParseCargoLockTreeKeepsDuplicateVersions(t *testing.T) {
	tree := parseCargoLockTree([]byte(sampleLock))
	versions := map[string]bool{}
	for _, node := range tree {
		if node.Name == "serde" {
			versions[node.Version] = true
		}
	}
	if !versions["1.0.219"] || !versions["1.0.100"] {
		t.Fatalf("both serde versions must appear in the tree: %+v", tree)
	}
}

func TestVerbCallRejectsSubstringVerbs(t *testing.T) {
	// `target(` non deve essere letto come `get(`.
	if verbs := callVerbs("target(h)"); len(verbs) != 1 || verbs[0] != "ANY" {
		t.Fatalf("target( must not yield get: %+v", verbs)
	}
	if verbs := callVerbs("get(h).post(h)"); len(verbs) != 2 || verbs[0] != "GET" || verbs[1] != "POST" {
		t.Fatalf("get/post must be recognized: %+v", verbs)
	}
}

func TestResourceVerbsStopAtServiceBoundary(t *testing.T) {
	// I verbi della resource successiva non devono finire sulla prima.
	verbs := resourceVerbs(".route(web::get().to(a))).service(web::resource(\"/b\").route(web::post().to(b)))")
	if len(verbs) != 1 || verbs[0] != "GET" {
		t.Fatalf("verbs must stop at .service: %+v", verbs)
	}
}

func TestClapEnvAfterNestedMacro(t *testing.T) {
	got := EnvVarsInFile("src/main.rs", []byte(`#[arg(value_parser = clap::value_parser!(u16), env = "PORT")]
port: u16,
`))
	names := map[string]bool{}
	for _, r := range got {
		names[r.Name] = true
	}
	if !names["PORT"] {
		t.Fatalf("env after a nested macro must be found: %+v", got)
	}
}

func TestEstablishBecomesDatasource(t *testing.T) {
	got := DatabasesInFile("src/main.rs", []byte(`let conn = PgConnection::establish("postgres://localhost/app").unwrap();
let mem = SqliteConnection::establish(":memory:").unwrap();
`))
	var dsns []string
	for _, r := range got {
		if r.Kind == "datasource" {
			dsns = append(dsns, r.Name)
		}
	}
	if len(dsns) != 2 || dsns[0] != "postgres://localhost/app" || dsns[1] != ":memory:" {
		t.Fatalf("establish DSNs must be detected: %#v", dsns)
	}
}
