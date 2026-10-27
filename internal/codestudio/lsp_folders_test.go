package codestudio

import (
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
	"github.com/Andrea-Cavallo/adOmnia/internal/languages/golang"
)

func TestWorkspaceFolderRoots(t *testing.T) {
	root := t.TempDir()
	unit := func(language, kind, directory string) project.Unit {
		return project.Unit{Language: language, Kind: kind, Root: filepath.Join(root, directory)}
	}
	monorepo := []project.Unit{unit("go", "module", "orders"), unit("go", "module", "payments"), unit("java", "module", "billing"), unit("go", "loose", "tools")}
	if got := workspaceFolderRoots(root, monorepo, "go"); !reflect.DeepEqual(got, []string{filepath.Join(root, "orders"), filepath.Join(root, "payments")}) {
		t.Fatalf("go: %v", got)
	}
	if got := workspaceFolderRoots(root, monorepo, "java"); len(got) != 1 {
		t.Fatalf("java: %v", got)
	}
	if got := workspaceFolderRoots(root, monorepo, "python"); got != nil {
		t.Fatalf("a language without units keeps the project root: %v", got)
	}
	withWork := append(monorepo, project.Unit{Language: "go", Kind: "workspace", Root: root})
	if got := workspaceFolderRoots(root, withWork, "go"); got != nil {
		t.Fatalf("go.work at the root keeps the project root: %v", got)
	}
}

// gopls dalla radice carica solo i moduli dei file aperti; i server che non scoprono le unità
// annidate (Java, TypeScript) ricevono invece una cartella per unità.
func TestServersThatDiscoverNestedUnitsGetOnlyTheProjectRoot(t *testing.T) {
	root := t.TempDir()
	units := []project.Unit{
		{Language: golang.ID, Kind: "module", Root: filepath.Join(root, "pdld-auth", "pdld-auth")},
		{Language: golang.ID, Kind: "module", Root: filepath.Join(root, "pdld-core", "pdld-core")},
	}
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for _, discovers := range []bool{true, false} {
		manager := NewLSPManager(newLanguageRegistry())
		session := Session{ID: SessionID(fmt.Sprintf("discovers-%t", discovers)), Project: Project{Name: "pdld", RootPath: root, RealPath: root, Units: units}}
		options := LanguageServerOptions{Language: golang.ID, Binary: binary, Environment: append(os.Environ(), fakeGoplsEnv+"=1"), DiscoversNestedUnits: discovers}
		if _, err := manager.Start(session, options); err != nil {
			t.Fatal(err)
		}
		state, _ := manager.server(session.ID, golang.ID)
		folders := state.workspaceFolders()
		manager.Shutdown()
		want := 2
		if discovers {
			want = 1
		}
		if len(folders) != want {
			t.Fatalf("discovers=%t: %d workspace folders, want %d: %v", discovers, len(folders), want, folders)
		}
		if discovers && folders[0]["uri"] != fileURI(root) {
			t.Fatalf("expected the project root, got %v", folders[0])
		}
	}
}
