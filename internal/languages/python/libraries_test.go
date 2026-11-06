package python

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func writeLibraryTestFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// TestSitePackagesFromInterpreterPrefisso: senza un .venv, site-packages si ricava dal prefisso
// dell'interprete scelto; la lettura è solo stat.
func TestSitePackagesFromInterpreterPrefix(t *testing.T) {
	prefix := t.TempDir()
	interpreter := filepath.Join(prefix, "bin", "python3")
	if runtime.GOOS == "windows" {
		interpreter = filepath.Join(prefix, "python.exe")
	}
	site := filepath.Join(prefix, "lib", "python3.12", "site-packages")
	if runtime.GOOS == "windows" {
		site = filepath.Join(prefix, "Lib", "site-packages")
	}
	if err := os.MkdirAll(site, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := SitePackages(t.TempDir(), interpreter); len(got) != 1 || got[0] != site {
		t.Fatalf("site-packages = %v, want %s", got, site)
	}
}

// TestSitePackagesFromProjectEnvironment: un .venv nel progetto vince sull'interprete.
func TestSitePackagesFromProjectEnvironment(t *testing.T) {
	root := t.TempDir()
	interpreter := filepath.Join(root, ".venv", "bin", "python")
	site := filepath.Join(root, ".venv", "lib", "python3.12", "site-packages")
	if runtime.GOOS == "windows" {
		interpreter = filepath.Join(root, ".venv", "Scripts", "python.exe")
		site = filepath.Join(root, ".venv", "Lib", "site-packages")
	}
	writeLibraryTestFile(t, interpreter, "")
	if err := os.MkdirAll(site, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := SitePackages(root, ""); len(got) != 1 || got[0] != site {
		t.Fatalf("site-packages = %v, want %s", got, site)
	}
}

func TestInstalledDistributionsReadsMetadataAndTopLevel(t *testing.T) {
	site := t.TempDir()
	writeLibraryTestFile(t, filepath.Join(site, "requests-2.31.0.dist-info", "METADATA"), "Metadata-Version: 2.1\nName: requests\nVersion: 2.31.0\n\n")
	writeLibraryTestFile(t, filepath.Join(site, "requests-2.31.0.dist-info", "top_level.txt"), "requests\n")
	writeLibraryTestFile(t, filepath.Join(site, "requests", "__init__.py"), "")
	writeLibraryTestFile(t, filepath.Join(site, "urllib3-2.0.7.dist-info", "METADATA"), "Name: urllib3\nVersion: 2.0.7\n\n")
	writeLibraryTestFile(t, filepath.Join(site, "urllib3", "__init__.py"), "")
	writeLibraryTestFile(t, filepath.Join(site, "single-1.0.dist-info", "METADATA"), "Name: single\nVersion: 1.0\n\n")

	distributions := InstalledDistributions([]string{site})
	byName := map[string]InstalledDistribution{}
	for _, distribution := range distributions {
		byName[distribution.Name] = distribution
	}
	requests, ok := byName["requests"]
	if !ok || requests.Version != "2.31.0" || requests.Directory != filepath.Join(site, "requests") {
		t.Fatalf("requests = %+v (all %+v)", requests, distributions)
	}
	urllib3, ok := byName["urllib3"]
	if !ok || urllib3.Directory != filepath.Join(site, "urllib3") {
		t.Fatalf("urllib3 = %+v", urllib3)
	}
	single, ok := byName["single"]
	if !ok || single.Directory != filepath.Join(site, "single-1.0.dist-info") {
		t.Fatalf("a distribution without a package directory must still be readable: %+v", single)
	}
}

func TestInstalledDistributionsKeepsTheFirstSitePackages(t *testing.T) {
	first, second := t.TempDir(), t.TempDir()
	for site, version := range map[string]string{first: "1.0", second: "2.0"} {
		writeLibraryTestFile(t, filepath.Join(site, "foo-"+version+".dist-info", "METADATA"), "Name: foo\nVersion: "+version+"\n\n")
		writeLibraryTestFile(t, filepath.Join(site, "foo", "__init__.py"), "")
	}
	distributions := InstalledDistributions([]string{first, second})
	if len(distributions) != 1 || distributions[0].Version != "1.0" || distributions[0].SitePackages != first {
		t.Fatalf("distributions = %+v", distributions)
	}
}
