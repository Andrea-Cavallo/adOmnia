package codestudio

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"adomnia/internal/languages/java"
)

// TestJdtImportsARealMultiModuleProject porta Eclipse JDT LS su un progetto Maven/Gradle multi-modulo
// vero quando viene indicato: è la prova che il server si avvia con le impostazioni di produzione,
// importa il reactor per intero (ogni modulo diventa un progetto) e non solo la cartella radice.
// Non gira in CI: serve la cartella degli strumenti installati e un progetto reale.
//
//	ADOMNIA_TEST_JAVA_TOOLS=%APPDATA%\adomnia\goide\tools ADOMNIA_TEST_JAVA_PROJECT=C:\work\quarkus-super-heroes-main go test ./internal/codestudio/ -run TestJdtImportsARealMultiModuleProject -v
//
// L'import di un reactor grande richiede minuti: il test ha una scadenza lunga apposta.
func TestJdtImportsARealMultiModuleProject(t *testing.T) {
	tools, root := os.Getenv("ADOMNIA_TEST_JAVA_TOOLS"), os.Getenv("ADOMNIA_TEST_JAVA_PROJECT")
	if tools == "" || root == "" {
		t.Skip("set ADOMNIA_TEST_JAVA_TOOLS and ADOMNIA_TEST_JAVA_PROJECT to run this check on a real multi-module project")
	}
	modules := moduleDirectories(t, root)
	if len(modules) < 2 {
		t.Fatalf("%s is not a multi-module project: %d modules with sources", root, len(modules))
	}
	// Le impostazioni di produzione (JDK installati, JDK del progetto, settings.xml) più autobuild
	// spento: il server deve vedere il progetto come lo vede l'utente.
	settings := java.JDTSettingsFor(root)
	if configuration, ok := settings["java"].(map[string]any); ok {
		configuration["autobuild"] = map[string]any{"enabled": false}
	}
	service, _, session := startJavaDebugTestProject(t, root, tools, settings)

	// Il JDK che il progetto dichiara (dai moduli) deve essere tra quelli noti a JDT LS.
	report, err := service.JavaJDKs(string(session.ID))
	if err != nil {
		t.Fatal(err)
	}
	required := declaredJavaOfTree(t, root)
	t.Logf("required Java=%d (project) %d (adOmnia), installed=%d, selected=%q, suggested=%q",
		required, report.Required, len(report.Installed), report.Selected, report.Suggested)
	if required > 0 && report.Required != required {
		t.Fatalf("adOmnia reads required Java %d, the project declares %d", report.Required, required)
	}

	// java.project.getAll elenca i progetti importati: un modulo su uno è un progetto.
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	projects := waitImportedProjects(ctx, t, service, session)
	t.Logf("imported projects: %s", projects)
	matched := 0
	for _, module := range modules {
		if strings.Contains(projects, filepath.Base(module)) {
			matched++
		} else {
			t.Logf("module not named in the import result: %s", module)
		}
	}
	if matched < len(modules)/2 {
		t.Fatalf("JDT LS imported %d of %d modules: %s", matched, len(modules), projects)
	}
	t.Logf("modules recognized: %d/%d", matched, len(modules))

	// Il classpath di runtime (serve a Run e Debug) si chiede a java.project.getClasspaths con la
	// forma verificata per tentativi su JDT LS 1.60: arguments[0] = cartella del progetto come URI
	// `file:`, arguments[1] = testo JSON dei parametri (`scope`, `projectFolderPaths`). Un oggetto
	// strutturato al posto del testo JSON fallisce: il server fa il parsing della stringa.
	params, err := json.Marshal(map[string]any{"scope": "runtime", "projectFolderPaths": []string{modules[0]}})
	if err != nil {
		t.Fatal(err)
	}
	classpath, err := service.lsp.ExecuteCommand(ctx, session.ID, java.ID, "java.project.getClasspaths", fileURI(modules[0]), string(params))
	if err != nil {
		t.Fatalf("java.project.getClasspaths: %v", err)
	}
	if len(classpath) == 0 || string(classpath) == "null" {
		t.Fatalf("empty classpath for %s: %s", modules[0], classpath)
	}
	t.Logf("runtime classpath of %s: %d bytes of JSON", filepath.Base(modules[0]), len(classpath))
}

// moduleDirectories sono le cartelle dei moduli con sorgenti Java (figlie dirette della radice).
func moduleDirectories(t *testing.T, root string) []string {
	t.Helper()
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	var modules []string
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		directory := filepath.Join(root, entry.Name())
		if !fileExists(filepath.Join(directory, "pom.xml")) && !fileExists(filepath.Join(directory, "build.gradle")) && !fileExists(filepath.Join(directory, "build.gradle.kts")) {
			continue
		}
		if hasJavaSources(directory) {
			modules = append(modules, directory)
		}
	}
	return modules
}

func hasJavaSources(directory string) bool {
	found := false
	_ = filepath.WalkDir(filepath.Join(directory, "src"), func(path string, entry os.DirEntry, err error) error {
		if err != nil || found {
			return filepath.SkipAll
		}
		if !entry.IsDir() && strings.EqualFold(filepath.Ext(path), ".java") {
			found = true
			return filepath.SkipAll
		}
		return nil
	})
	return found
}

// declaredJavaOfTree è un oracolo indipendente: legge la release dichiarata nei pom dei moduli con
// una regex propria, senza riusare il codice di produzione.
func declaredJavaOfTree(t *testing.T, root string) int {
	t.Helper()
	release := regexp.MustCompile(`<(?:maven\.compiler\.release|maven\.compiler\.source|java\.version)>\s*([0-9]+)`)
	best := 0
	for _, module := range append([]string{root}, moduleDirectories(t, root)...) {
		data, err := os.ReadFile(filepath.Join(module, "pom.xml"))
		if err != nil {
			continue
		}
		for _, match := range release.FindAllSubmatch(data, -1) {
			if value, err := strconv.Atoi(string(match[1])); err == nil && value > best {
				best = value
			}
		}
	}
	return best
}

// waitImportedProjects attende che JDT LS finisca l'import e risponda con i progetti del workspace.
func waitImportedProjects(ctx context.Context, t *testing.T, service *Service, session Session) string {
	t.Helper()
	var lastErr error
	for {
		raw, err := service.lsp.ExecuteCommand(ctx, session.ID, java.ID, "java.project.getAll")
		if err == nil {
			projects := string(raw)
			if projects != "" && projects != "null" && projects != "[]" {
				return projects
			}
			lastErr = nil
		} else {
			lastErr = err
		}
		select {
		case <-ctx.Done():
			t.Fatalf("JDT LS did not report the imported projects (last error: %v)", lastErr)
			return ""
		case <-time.After(5 * time.Second):
		}
	}
}
