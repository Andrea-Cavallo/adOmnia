package golang

import (
	"os"
	"path/filepath"
	"testing"

	"adomnia/internal/ide/sdk"
)

func TestGoplsConfigurationKeepsVulncheckOptIn(t *testing.T) {
	if got := goplsConfiguration(GoplsSettings{})["vulncheck"]; got != "Off" {
		t.Fatalf("vulncheck by default = %v, want Off (local-first)", got)
	}
	if got := goplsConfiguration(GoplsSettings{Vulncheck: true})["vulncheck"]; got != "Imports" {
		t.Fatalf("vulncheck when enabled = %v, want Imports", got)
	}
}

func TestGoplsServerSpecDescribesTheGoServer(t *testing.T) {
	spec := GoplsServerSpec(GoplsInfo{Binary: "/bin/gopls", Version: "v0.23.0"}, []string{"GOMEMLIMIT=2GiB"}, GoplsSettings{Gofumpt: true})
	if spec.Language != ID || spec.Name != "gopls" || spec.Configuration == nil {
		t.Fatalf("spec = %+v", spec)
	}
	defaults := map[string]int{}
	for _, entry := range spec.Environment {
		defaults[entry]++
	}
	if defaults["GOMEMLIMIT=2GiB"] != 1 || defaults["GOMEMLIMIT=1GiB"] != 0 || defaults["GO_TELEMETRY_CHILD=2"] != 1 {
		t.Fatalf("i predefiniti non devono sovrascrivere le scelte dell'utente: %v", spec.Environment)
	}
	if !spec.WatchesFile("/p/go.sum") || spec.WatchesFile("/p/README.md") {
		t.Fatal("gopls deve osservare go.sum ma non i file non Go")
	}
}

// La ricerca segue l'ordine personalizzato → gestito → GOPATH/bin → PATH, e un binario
// personalizzato sparito ferma la ricerca invece di essere sostituito in silenzio.
func TestToolSearchOrderAndMissingCustomBinary(t *testing.T) {
	root, gopath := t.TempDir(), t.TempDir()
	candidates := ToolSearch([]string{"gopls"}, "/custom/gopls", root, gopath).Candidates()
	if len(candidates) < 3 || candidates[0].Source != sdk.SourceCustom || candidates[1].Source != sdk.SourceManaged || candidates[2].Source != "GOPATH" {
		t.Fatalf("order = %+v", candidates)
	}
	if info := LocateGopls(filepath.Join(root, "missing-gopls"), root, gopath); info.Available || info.Source != sdk.SourceCustom || info.Error == "" {
		t.Fatalf("missing custom = %+v", info)
	}
	if info := LocateGopls("", "", t.TempDir()); info.Available && info.Source == "GOPATH" {
		t.Fatalf("an empty GOPATH/bin cannot provide gopls: %+v", info)
	}
	binary := filepath.Join(gopath, "bin", sdk.ExecutableName("gopls"))
	if err := os.MkdirAll(filepath.Dir(binary), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(binary, []byte("not a real gopls"), 0o755); err != nil {
		t.Fatal(err)
	}
	if info := LocateGopls("", "", gopath); info.Binary != binary || info.Source != "GOPATH" || info.Available || info.Error == "" {
		t.Fatalf("a broken gopls must be reported, not used: %+v", info)
	}
}
