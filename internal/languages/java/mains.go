package java

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"adomnia/internal/ide/run"
)

// Limiti della scansione: un monorepo enorme non deve bloccare l'apertura del progetto.
const (
	maxMainScanFiles = 3_000
	maxMainSourceKB  = 256
	maxMainClasses   = 12
)

// mainClass è una classe eseguibile trovata nei sorgenti di un modulo.
type mainClass struct {
	// Module è la cartella del modulo (con il suo pom.xml o build file) che contiene la classe.
	Module string
	// Class è il nome qualificato (package + classe).
	Class string
	// Spring è vero se la classe è annotata @SpringBootApplication.
	Spring bool
}

var (
	mainMethod     = regexp.MustCompile(`public\s+static\s+void\s+main\s*\(\s*(?:final\s+)?String\s*(?:\[\s*\]|\.\.\.)`)
	packageLine    = regexp.MustCompile(`(?m)^\s*package\s+([\w.]+)\s*;`)
	springBootMark = regexp.MustCompile(`@SpringBootApplication\b`)
)

// findMainClasses cerca i `public static void main` nei sorgenti principali (src/main/java) di ogni modulo
// dell'unità. Legge solo file .java piccoli e si ferma ai limiti: è un suggerimento, non un indice.
func findMainClasses(unitRoot string) []mainClass {
	var found []mainClass
	scanned := 0
	_ = filepath.WalkDir(unitRoot, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			if path != unitRoot && (ignoredDirectory(entry.Name()) || depth(unitRoot, path) > maxScanDepth+4) {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(entry.Name(), ".java") || !inMainSources(path) {
			return nil
		}
		if scanned++; scanned > maxMainScanFiles || len(found) >= maxMainClasses {
			return filepath.SkipAll
		}
		if class, ok := readMainClass(path, unitRoot); ok {
			found = append(found, class)
		}
		return nil
	})
	sort.SliceStable(found, func(i, j int) bool {
		if found[i].Module != found[j].Module {
			return found[i].Module < found[j].Module
		}
		return found[i].Class < found[j].Class
	})
	return found
}

func inMainSources(path string) bool {
	return strings.Contains(filepath.ToSlash(path), "/src/main/java/")
}

func readMainClass(path, unitRoot string) (mainClass, bool) {
	info, err := os.Stat(path)
	if err != nil || info.Size() > maxMainSourceKB<<10 {
		return mainClass{}, false
	}
	data, err := os.ReadFile(path)
	if err != nil || !mainMethod.Match(data) {
		return mainClass{}, false
	}
	name := strings.TrimSuffix(filepath.Base(path), ".java")
	if match := packageLine.FindSubmatch(data); match != nil {
		name = string(match[1]) + "." + name
	}
	slashed := filepath.ToSlash(path)
	module := filepath.FromSlash(slashed[:strings.Index(slashed, "/src/main/java/")])
	if _, ok := unitIn(module); !ok {
		module = unitRoot
	}
	return mainClass{Module: module, Class: name, Spring: springBootMark.Match(data)}, true
}

// MainCommand è il comando che esegue una classe `main` del modulo (Maven: compila e poi exec:java col
// classpath del modulo). Gradle non sa eseguire una classe scelta senza il suo build script: lì serve il
// task `run` del plugin application, proposto come configurazione.
func MainCommand(module, mainClass string) (executable string, arguments []string, display string, err error) {
	unit, ok := unitIn(module)
	if !ok || unit.Kind != UnitMaven {
		return "", nil, "", fmt.Errorf("running a chosen class needs a Maven module: use the Gradle application run configuration instead")
	}
	tool, ok := resolveBuildTool(unit)
	if !ok {
		return "", nil, "", fmt.Errorf("neither the project wrapper nor Maven was found: install Maven or add the wrapper to the project")
	}
	arguments = []string{"-B", "compile", execPlugin + ":java", "-Dexec.mainClass=" + mainClass}
	executable = tool.Target
	if strings.HasPrefix(executable, "./") {
		executable = filepath.Join(unit.Root, filepath.FromSlash(strings.TrimPrefix(executable, "./")))
	} else if found, lookErr := lookPath(executable); lookErr == nil {
		executable = found
	}
	if err := run.CheckBatchSafe(executable, arguments); err != nil {
		return "", nil, "", err
	}
	return executable, arguments, tool.Label + " " + strings.Join(arguments, " "), nil
}

// ModuleOf è la cartella del modulo (con pom.xml o build file) che contiene il file, risalendo fino a root.
func ModuleOf(root, file string) (string, bool) {
	for dir := filepath.Dir(file); strings.HasPrefix(dir, root); dir = filepath.Dir(dir) {
		if _, ok := unitIn(dir); ok {
			return dir, true
		}
		if dir == root || filepath.Dir(dir) == dir {
			break
		}
	}
	return "", false
}
