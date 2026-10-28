package language

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
)

// fakeLanguage dimostra che il core non è cablato su Go: nessuna capability.
type fakeLanguage struct{ id string }

func (f fakeLanguage) ID() string   { return f.id }
func (f fakeLanguage) Name() string { return "Fake " + f.id }

// fakeDetector implementa solo ProjectDetector.
type fakeDetector struct {
	fakeLanguage
	units []project.Unit
	err   error
}

func (f fakeDetector) DetectUnits(context.Context, string) ([]project.Unit, error) {
	return f.units, f.err
}

func TestRegistryRegistersFakeLanguages(t *testing.T) {
	registry := NewRegistry()
	if err := registry.Register(fakeLanguage{id: "fake"}); err != nil {
		t.Fatal(err)
	}
	if err := registry.Register(fakeDetector{id: "java"}); err != nil {
		t.Fatal(err)
	}
	if got, ok := registry.Get("java"); !ok || got.Name() != "Fake java" {
		t.Fatalf("Get(java) = %v, %v", got, ok)
	}
	if _, ok := registry.Get("rust"); ok {
		t.Fatal("unregistered language found")
	}
	ids := []string{}
	for _, l := range registry.All() {
		ids = append(ids, l.ID())
	}
	if strings.Join(ids, ",") != "fake,java" {
		t.Fatalf("registration order lost: %v", ids)
	}
}

func TestRegistryRejectsInvalidAndDuplicateLanguages(t *testing.T) {
	registry := NewRegistry()
	for _, bad := range []Language{nil, fakeLanguage{id: ""}, fakeLanguage{id: "Go"}, fakeLanguage{id: "a b"}} {
		if err := registry.Register(bad); err == nil {
			t.Fatalf("expected error for %#v", bad)
		}
	}
	if err := registry.Register(fakeLanguage{id: "go"}); err != nil {
		t.Fatal(err)
	}
	if err := registry.Register(fakeLanguage{id: "go"}); err == nil {
		t.Fatal("duplicate ID accepted")
	}
}

func TestCapabilitiesDeriveFromInterfaces(t *testing.T) {
	if CapabilitiesOf(fakeLanguage{id: "plain"}).ProjectDetection {
		t.Fatal("plain language must not detect projects")
	}
	if !CapabilitiesOf(fakeDetector{id: "java"}).ProjectDetection {
		t.Fatal("detector capability not derived")
	}
}

func TestDetectUnitsMergesLanguagesAndKeepsPartialResults(t *testing.T) {
	registry := NewRegistry()
	_ = registry.Register(fakeLanguage{id: "plain"})
	_ = registry.Register(fakeDetector{id: "java", units: []project.Unit{{Language: "java", Kind: "maven", Root: "/p/gateway"}}})
	_ = registry.Register(fakeDetector{id: "broken", units: []project.Unit{{Language: "broken", Kind: "x", Root: "/p/x"}}, err: errors.New("boom")})
	_ = registry.Register(fakeDetector{id: "ts", units: []project.Unit{{Language: "ts", Kind: "npm", Root: "/p/frontend"}}})

	units, err := registry.DetectUnits(context.Background(), "/p")
	if err == nil || !strings.Contains(err.Error(), "broken: boom") {
		t.Fatalf("detector error not reported: %v", err)
	}
	languages := []string{}
	for _, unit := range units {
		languages = append(languages, unit.Language)
	}
	if strings.Join(languages, ",") != "java,broken,ts" {
		t.Fatalf("units lost or reordered: %v", languages)
	}
}

// fakeScanner implementa UnitScanner: la detection passa dalla walk condivisa
// e DetectUnits non deve più essere chiamato dal registry.
type fakeScanner struct {
	fakeLanguage
	visitor *scanRecorder
}

func (f fakeScanner) DetectUnits(context.Context, string) ([]project.Unit, error) {
	return nil, errors.New("DetectUnits must not run when the walk is shared")
}

func (f fakeScanner) NewUnitsVisitor(string) project.UnitsVisitor { return f.visitor }

// scanRecorder raccoglie le visite della walk condivisa come unità.
type scanRecorder struct {
	language string
	visits   []project.DirectoryVisit
	err      error
}

func (s *scanRecorder) VisitDirectory(visit project.DirectoryVisit) bool {
	s.visits = append(s.visits, visit)
	return true
}

func (s *scanRecorder) Units() ([]project.Unit, error) {
	units := make([]project.Unit, 0, len(s.visits))
	for _, visit := range s.visits {
		units = append(units, project.Unit{Language: s.language, Kind: "seen", Root: visit.Path})
	}
	return units, s.err
}

func TestDetectUnitsSharesOneWalkAcrossScanners(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "pkg"), 0o755); err != nil {
		t.Fatal(err)
	}
	first := &scanRecorder{language: "one"}
	second := &scanRecorder{language: "two"}
	registry := NewRegistry()
	_ = registry.Register(fakeScanner{id: "one", visitor: first})
	_ = registry.Register(fakeScanner{id: "two", visitor: second})
	_ = registry.Register(fakeDetector{id: "plain", units: []project.Unit{{Language: "plain", Kind: "x", Root: "r"}}})

	units, err := registry.DetectUnits(context.Background(), root)
	// A per-language DetectUnits would report the fakeScanner error.
	if err != nil {
		t.Fatalf("shared walk not used: %v", err)
	}
	if len(first.visits) == 0 || len(first.visits) != len(second.visits) {
		t.Fatalf("visits = %d / %d", len(first.visits), len(second.visits))
	}
	for index := range first.visits {
		if first.visits[index].Path != second.visits[index].Path {
			t.Fatalf("visit %d differs: %s / %s", index, first.visits[index].Path, second.visits[index].Path)
		}
	}
	languages := []string{}
	for _, unit := range units {
		languages = append(languages, unit.Language)
	}
	if strings.Join(languages, ",") != "one,one,two,two,plain" {
		t.Fatalf("units lost or reordered: %v", languages)
	}
}

func TestDetectUnitsKeepsPartialResultsWhenAScannerFails(t *testing.T) {
	root := t.TempDir()
	broken := &scanRecorder{language: "broken", err: errors.New("boom")}
	registry := NewRegistry()
	_ = registry.Register(fakeScanner{id: "broken", visitor: broken})

	units, err := registry.DetectUnits(context.Background(), root)
	if err == nil || !strings.Contains(err.Error(), "broken: boom") {
		t.Fatalf("scanner error not reported: %v", err)
	}
	if len(units) != 1 {
		t.Fatalf("partial results lost: %v", units)
	}
}

// fakeSelector implementa solo DocumentSelector: riconosce i file con l'estensione indicata.
type fakeSelector struct {
	fakeLanguage
	extension, languageID string
}

func (f fakeSelector) DocumentLanguageID(path string) (string, bool) {
	return f.languageID, strings.HasSuffix(path, f.extension)
}

func TestForPathRoutesFilesToTheirLanguage(t *testing.T) {
	registry := NewRegistry()
	_ = registry.Register(fakeLanguage{id: "plain"})
	_ = registry.Register(fakeSelector{id: "java", extension: ".java", languageID: "java"})
	_ = registry.Register(fakeSelector{id: "ts", extension: ".ts", languageID: "typescript"})

	owner, languageID, ok := registry.ForPath("/p/src/App.ts")
	if !ok || owner.ID() != "ts" || languageID != "typescript" {
		t.Fatalf("ForPath(.ts) = %v %q %v", owner, languageID, ok)
	}
	if _, _, ok := registry.ForPath("/p/README.md"); ok {
		t.Fatal("a file no language selects must not be routed")
	}
	if !CapabilitiesOf(fakeSelector{id: "x"}).Documents {
		t.Fatal("Documents capability not derived")
	}
}
