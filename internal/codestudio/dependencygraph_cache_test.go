package codestudio

import (
	"path/filepath"
	"testing"
)

func TestDependencyModuleStampChangesWithModuleFiles(t *testing.T) {
	directory := t.TempDir()
	writeFixtureFile(t, directory, "go.mod", "module example.com/app\n\ngo 1.22\n")
	writeFixtureFile(t, directory, "go.sum", "example.com/left v1.0.0 h1:abc=\n")

	stamp := dependencyModuleStamp(directory, filepath.Join(directory, "go"))
	if stamp == "" {
		t.Fatal("stamp attesa")
	}
	if again := dependencyModuleStamp(directory, filepath.Join(directory, "go")); again != stamp {
		t.Fatal("lo stamp non deve cambiare senza modifiche ai file")
	}

	writeFixtureFile(t, directory, "go.mod", "module example.com/app\n\ngo 1.22\n\nrequire example.com/left v1.0.0\n")
	if changed := dependencyModuleStamp(directory, filepath.Join(directory, "go")); changed == stamp {
		t.Fatal("lo stamp deve cambiare quando go.mod cambia")
	}
}

func TestDependencyGraphCacheRoundTrip(t *testing.T) {
	cache := newDependencyGraphCache()
	key := dependencyGraphKey("session-one", "/project/app", "/sdk/go")
	report := DependencyGraphReport{ModulePath: "example.com/app", DirectCount: 2}

	if _, ok := cache.get(key, "stamp-one"); ok {
		t.Fatal("cache vuota non deve rispondere")
	}
	cache.set(key, "stamp-one", report)
	cached, ok := cache.get(key, "stamp-one")
	if !ok {
		t.Fatal("report atteso in cache")
	}
	if cached.ModulePath != "example.com/app" || cached.DirectCount != 2 {
		t.Fatalf("report in cache inatteso: %+v", cached)
	}
	if _, ok := cache.get(key, "stamp-two"); ok {
		t.Fatal("uno stamp diverso deve invalidare la voce")
	}

	cache.set(key, "stamp-one", report)
	cache.invalidateSession("session-one")
	if _, ok := cache.get(key, "stamp-one"); ok {
		t.Fatal("invalidateSession deve rimuovere le voci della sessione")
	}
}

func TestDependencyGraphUsesCacheUntilFilesChange(t *testing.T) {
	workspace := t.TempDir()
	writeFixtureFile(t, workspace, "app/go.mod", "module example.com/app\n\ngo 1.22\n\nrequire (\n\texample.com/left v1.0.0\n\texample.com/right v1.0.0\n)\n\nreplace example.com/left => ../left\nreplace example.com/right => ../right\nreplace example.com/shared v1.0.0 => ../sharedv1\nreplace example.com/shared v1.5.0 => ../sharedv2\n")
	writeFixtureFile(t, workspace, "left/go.mod", "module example.com/left\n\ngo 1.22\n\nrequire example.com/shared v1.0.0\n")
	writeFixtureFile(t, workspace, "right/go.mod", "module example.com/right\n\ngo 1.22\n\nrequire example.com/shared v1.5.0\n")
	writeFixtureFile(t, workspace, "sharedv1/go.mod", "module example.com/shared\n\ngo 1.22\n")
	writeFixtureFile(t, workspace, "sharedv2/go.mod", "module example.com/shared\n\ngo 1.22\n")

	service := NewService(&memoryStore{}, func(EventEnvelope) {})
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(filepath.Join(workspace, "app"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetToolAuthorization(string(session.ID), true); err != nil {
		t.Fatal(err)
	}

	report, err := service.DependencyGraph(string(session.ID), "")
	if err != nil {
		t.Fatal(err)
	}
	if report.DirectCount != 2 {
		t.Fatalf("direct attese 2, ottenute %d", report.DirectCount)
	}

	// Una seconda chiamata senza modifiche deve essere servita dalla cache:
	// il report viene alterato direttamente in cache, se la chiamata eseguisse
	// di nuovo i comandi go restituirebbe il valore vero (2).
	goBinary, err := service.toolchain.GoBinary(session.ID)
	if err != nil {
		t.Fatal(err)
	}
	directory, err := service.documents.resolveDirectory(session.Project, "")
	if err != nil {
		t.Fatal(err)
	}
	key := dependencyGraphKey(session.ID, directory, goBinary)
	stamp := dependencyModuleStamp(directory, goBinary)
	poisoned := report
	poisoned.DirectCount = 999
	service.depGraph.set(key, stamp, poisoned)

	cached, err := service.DependencyGraph(string(session.ID), "")
	if err != nil {
		t.Fatal(err)
	}
	if cached.DirectCount != 999 {
		t.Fatalf("la seconda chiamata deve essere servita dalla cache, ottenuto DirectCount %d", cached.DirectCount)
	}

	// go.mod cambia: lo stamp cambia, il grafo viene ricalcolato dal vivo.
	writeFixtureFile(t, workspace, "app/go.mod", "module example.com/app\n\ngo 1.22\n\nrequire (\n\texample.com/left v1.0.0\n\texample.com/right v1.0.0\n\texample.com/shared v1.5.0\n)\n\nreplace example.com/left => ../left\nreplace example.com/right => ../right\nreplace example.com/shared v1.0.0 => ../sharedv1\nreplace example.com/shared v1.5.0 => ../sharedv2\n")
	refreshed, err := service.DependencyGraph(string(session.ID), "")
	if err != nil {
		t.Fatal(err)
	}
	if refreshed.DirectCount != 3 {
		t.Fatalf("dopo la modifica di go.mod attese 3 direct, ottenute %d", refreshed.DirectCount)
	}

	// Le modifiche su disco dal watcher invalidano la cache della sessione.
	service.depGraph.set(key, dependencyModuleStamp(directory, goBinary), poisoned)
	service.filesChanged(session.ID, FilesChanged{Changes: []DiskChange{{Path: "main.go", Kind: FileChanged}}})
	if _, ok := service.depGraph.get(key, dependencyModuleStamp(directory, goBinary)); ok {
		t.Fatal("filesChanged deve invalidare la cache del grafo dipendenze")
	}
}
