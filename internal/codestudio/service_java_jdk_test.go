package codestudio

import (
	"os"
	"path/filepath"
	"testing"

	"adomnia/internal/ide/sdk"
	"adomnia/internal/languages/java"
)

func fakeProjectJDK(t *testing.T) string {
	t.Helper()
	home := filepath.Join(t.TempDir(), "jdk-25")
	writeFixtureFile(t, filepath.Join(home, "bin"), sdk.ExecutableName("java"), "")
	writeFixtureFile(t, home, "release", "JAVA_VERSION=\"25.0.4\"\n")
	return home
}

// TestEveryRunUsesTheProjectJDK: il JDK scelto per il progetto deve arrivare a **ogni** esecuzione,
// anche ai comandi liberi come `./mvnw test`. Altrimenti Maven compila con il JDK di sistema e un
// progetto Java 25 muore con "release version 25 not supported" (visto nell'app il 2026-10-20).
func TestEveryRunUsesTheProjectJDK(t *testing.T) {
	root := t.TempDir()
	writeFixtureFile(t, root, "pom.xml", "<project/>")
	jdk := fakeProjectJDK(t)
	if err := java.SetProjectJavaHome(root, jdk); err != nil {
		t.Fatal(err)
	}
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, languageID := range []string{"", java.ID} {
		environment, err := service.executionEnvironment(session.ID, languageID, nil)
		if err != nil {
			t.Fatal(err)
		}
		// Non stampare l'ambiente: contiene segreti della macchina.
		hasHome, hasPath := false, false
		for _, entry := range environment {
			if entry == "JAVA_HOME="+jdk {
				hasHome = true
			}
			if entry == "PATH="+filepath.Join(jdk, "bin")+string(os.PathListSeparator)+os.Getenv("PATH") {
				hasPath = true
			}
		}
		if !hasHome || !hasPath {
			t.Fatalf("language %q: JDK del progetto assente dall'ambiente (JAVA_HOME=%t PATH=%t)", languageID, hasHome, hasPath)
		}
	}
}
