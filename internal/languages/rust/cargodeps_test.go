package rust

import "testing"

func TestParseCargoDependenciesStringAndInline(t *testing.T) {
	src := `[package]
name = "app"

[dependencies]
serde = "1.0"
tokio = { version = "1.42", features = ["full", "rt"] }

[dev-dependencies]
anyhow = "1"

[build-dependencies]
cc = { version = "1.1", features = ["parallel"] }
`
	deps := ParseCargoDependencies([]byte(src))
	byName := map[string]CargoDependency{}
	for _, d := range deps {
		byName[d.Name] = d
	}
	if len(deps) != 4 {
		t.Fatalf("deps = %+v", deps)
	}
	if byName["serde"].Version != "1.0" || byName["serde"].Section != "dependencies" {
		t.Fatalf("serde = %+v", byName["serde"])
	}
	if byName["tokio"].Version != "1.42" || len(byName["tokio"].Features) != 2 {
		t.Fatalf("tokio = %+v", byName["tokio"])
	}
	if byName["anyhow"].Section != "dev-dependencies" {
		t.Fatalf("anyhow = %+v", byName["anyhow"])
	}
	if byName["cc"].Section != "build-dependencies" {
		t.Fatalf("cc = %+v", byName["cc"])
	}
}

func TestCargoDependencyPositions(t *testing.T) {
	src := "[dependencies]\nserde = \"1.0\"\n"
	deps := ParseCargoDependencies([]byte(src))
	if len(deps) != 1 {
		t.Fatalf("deps = %+v", deps)
	}
	dep := deps[0]
	if dep.Line != 2 || dep.StartCol == 0 || dep.EndCol != dep.StartCol+3 {
		t.Fatalf("position = %+v", dep)
	}
}

func TestCargoDependencyWorkspacePathGit(t *testing.T) {
	src := `[dependencies]
serde = { workspace = true }
local = { path = "../local" }
kafka = { git = "https://github.com/x/kafka.git" }
`
	deps := ParseCargoDependencies([]byte(src))
	byName := map[string]CargoDependency{}
	for _, d := range deps {
		byName[d.Name] = d
	}
	if !byName["serde"].Workspace || byName["serde"].Version != "" {
		t.Fatalf("serde = %+v", byName["serde"])
	}
	if byName["local"].Path != "../local" {
		t.Fatalf("local = %+v", byName["local"])
	}
	if byName["kafka"].Git == "" {
		t.Fatalf("kafka = %+v", byName["kafka"])
	}
}

func TestCargoDependencyKey(t *testing.T) {
	dep := CargoDependency{Name: "serde"}
	if dep.Key() != "serde" {
		t.Fatal("Key must be the crate name")
	}
}

func TestParseCargoDependenciesIgnoresOtherSections(t *testing.T) {
	src := `[package]
name = "app"

[features]
default = ["tls"]
`
	deps := ParseCargoDependencies([]byte(src))
	if len(deps) != 0 {
		t.Fatalf("deps = %+v", deps)
	}
}
