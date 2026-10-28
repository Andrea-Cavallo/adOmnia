package python

import (
	"context"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
)

// entryScriptNames sono i nomi di file che di solito avviano un progetto Python.
var entryScriptNames = []string{"main.py", "__main__.py", "run.py", "app.py", "cli.py"}

// Suggest propone cosa eseguire nell'unità: script di avvio verificabili, entry point verificabili,
// server dei framework riconosciuti e pytest. Non importa il progetto e non indovina entry point
// ambigui: senza un indizio verificabile non propone nulla (PY-3.3, PY-7.1).
func (*Language) Suggest(_ context.Context, projectRoot string, unit project.Unit) []run.Suggestion {
	if unit.Language != ID {
		return nil
	}
	manifest := readManifest(unit.Root)
	var entries []suggestEntry
	entries = append(entries, frameworkEntries(unit, manifest)...)
	entries = append(entries, scriptEntries(unit)...)
	entries = append(entries, entryPointEntries(unit, manifest)...)
	if hasTestFiles(unit.Root) || manifest.hasDependency("pytest") {
		entries = append(entries, suggestEntry{action: "test", name: "pytest", id: ":pytest", title: "Python · pytest", options: Options{Module: "pytest"}})
	}
	suggestions := make([]run.Suggestion, 0, len(entries))
	for _, entry := range entries {
		options, _ := jsonutil.Marshal(entry.options)
		suggestions = append(suggestions, run.Suggestion{
			ID: ID + "|" + relativeDirectory(projectRoot, unit.Root) + "|" + entry.action + entry.id, Language: ID,
			Action: entry.action, UnitRoot: unit.Root, Title: entry.title,
			Configuration: run.Configuration{
				Language: ID, Name: entry.name, Kind: run.Kind(entry.kind()),
				LanguageOptions: options, ProgramArguments: entry.arguments,
			},
		})
	}
	return suggestions
}

// suggestEntry è una proposta prima di diventare una Configuration.
type suggestEntry struct {
	action    string
	name      string
	id        string
	title     string
	options   Options
	arguments []string
}

func (e suggestEntry) kind() string {
	if e.options.Script != "" {
		return "script"
	}
	return "module"
}

// scriptEntries propone gli script di avvio dell'unità: i nomi canonici verificabili, poi il
// manifest quando è uno script sciolto.
func scriptEntries(unit project.Unit) []suggestEntry {
	var entries []suggestEntry
	for _, name := range entryScriptNames {
		if !isFile(filepath.Join(unit.Root, name)) {
			continue
		}
		entries = append(entries, suggestEntry{
			action: "run", name: strings.TrimSuffix(name, ".py"), id: ":" + name, title: "Python · " + name,
			options: Options{Script: name},
		})
	}
	if len(entries) == 0 && strings.EqualFold(filepath.Ext(unit.Manifest), ".py") && isFile(unit.Manifest) {
		name := filepath.Base(unit.Manifest)
		// manage.py ha già la sua proposta (Django): non duplicarla come script generico.
		if name != "manage.py" {
			entries = append(entries, suggestEntry{
				action: "run", name: strings.TrimSuffix(name, ".py"), id: ":" + name, title: "Python · " + name,
				options: Options{Script: name},
			})
		}
	}
	return entries
}

// modulePattern riconosce `modulo:funzione` negli entry point del manifest.
var modulePattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$`)

// entryPointEntries propone `python -m modulo` solo per gli entry point verificabili: il modulo
// esiste come file e dichiara un punto d'ingresso eseguibile con `-m`. Uno script console del
// manifest non diventa mai automaticamente un comando (PY-3.3).
func entryPointEntries(unit project.Unit, manifest Manifest) []suggestEntry {
	var entries []suggestEntry
	for name, entry := range manifest.Scripts {
		module, _, ok := strings.Cut(entry, ":")
		if !ok || !modulePattern.MatchString(module) {
			continue
		}
		if !hasModuleMain(unit.Root, module) {
			continue
		}
		entries = append(entries, suggestEntry{
			action: "run", name: name, id: ":entry-" + name, title: "Python · " + name + " (python -m " + module + ")",
			options: Options{Module: module},
		})
	}
	return entries
}

// hasModuleMain dice se il modulo esiste dentro l'unità e ha un `__main__` o una guardia
// `if __name__ == "__main__"`: l'unica forma di entry point eseguibile con `python -m`.
func hasModuleMain(root, module string) bool {
	relative := filepath.FromSlash(strings.ReplaceAll(module, ".", "/"))
	for _, candidate := range []string{relative + ".py", filepath.Join(relative, "__main__.py")} {
		path := filepath.Join(root, candidate)
		if !isFile(path) {
			continue
		}
		data, err := readLimited(path, 64<<10)
		if err != nil {
			continue
		}
		text := string(data)
		if strings.Contains(text, `__name__`) && strings.Contains(text, "__main__") {
			return true
		}
		if filepath.Base(candidate) == "__main__.py" {
			return true
		}
	}
	return false
}

// frameworkEntries riconosce i framework dagli indizi statici (dipendenze dichiarate, manage.py,
// una sola app riconosciuta nei sorgenti) e propone il comando del framework. Nessun import del
// progetto, nessuna porta o entry point indovinata: con più candidati non propone nulla.
func frameworkEntries(unit project.Unit, manifest Manifest) []suggestEntry {
	if isFile(filepath.Join(unit.Root, "manage.py")) {
		return []suggestEntry{{
			action: "run", name: "Django runserver", id: ":django", title: "Django · manage.py runserver",
			options: Options{Script: "manage.py"}, arguments: []string{"runserver"},
		}}
	}
	declarations := dependencyNames(manifest.Dependencies, manifest.DevDependencies)
	module, attribute := findAppAssignment(unit.Root, `FastAPI\s*\(`)
	if module != "" && (declarations["fastapi"] || declarations["uvicorn"]) {
		return []suggestEntry{{
			action: "run", name: "FastAPI " + module + ":" + attribute, id: ":fastapi", title: "FastAPI · uvicorn " + module + ":" + attribute,
			options: Options{Module: "uvicorn", App: module + ":" + attribute, Reload: true},
		}}
	}
	module, attribute = findAppAssignment(unit.Root, `Flask\s*\(`)
	if module != "" && declarations["flask"] {
		return []suggestEntry{{
			action: "run", name: "Flask " + module + ":" + attribute, id: ":flask", title: "Flask · flask --app " + module + ":" + attribute + " run",
			options: Options{Module: "flask", App: module + ":" + attribute},
		}}
	}
	return nil
}

// appAssignment è `<nome> = Framework(` nei sorgenti alla radice dell'unità o nei primi livelli.
var appAssignment = regexp.MustCompile(`(?m)^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*`)

// findAppAssignment cerca una sola assegnazione `app = Framework(`: con più candidati o nessuno
// restituisce "", "" e non si propone nulla.
func findAppAssignment(root, frameworkPattern string) (string, string) {
	framework := regexp.MustCompile(frameworkPattern)
	matches := 0
	module, attribute := "", ""
	for _, file := range candidateSources(root) {
		data, err := readLimited(file, 64<<10)
		if err != nil {
			continue
		}
		text := string(data)
		index := framework.FindStringIndex(text)
		if index == nil {
			continue
		}
		lineStart := strings.LastIndex(text[:index[0]], "\n") + 1
		if assignment := appAssignment.FindStringSubmatch(text[lineStart:index[1]]); assignment != nil {
			matches++
			relative, err := filepath.Rel(root, file)
			if err != nil {
				continue
			}
			module, attribute = strings.TrimSuffix(filepath.ToSlash(relative), ".py"), assignment[1]
		}
	}
	if matches != 1 {
		return "", ""
	}
	return strings.ReplaceAll(module, "/", "."), attribute
}

// candidateSources sono i sorgenti esaminati per il rilevamento delle app: radice e due livelli,
// con un limite di file e senza cartelle ignorate.
func candidateSources(root string) []string {
	var files []string
	_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			if path == root {
				return nil
			}
			if project.IgnoredDirectory(entry.Name()) || depthOf(root, path) > 2 {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.EqualFold(filepath.Ext(entry.Name()), ".py") {
			files = append(files, path)
		}
		if len(files) >= 32 {
			return filepath.SkipAll
		}
		return nil
	})
	return files
}

// hasTestFiles dice se l'unità ha file di test pytest.
func hasTestFiles(root string) bool {
	found := false
	_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			if path != root && (project.IgnoredDirectory(entry.Name()) || depthOf(root, path) > 3) {
				return filepath.SkipDir
			}
			return nil
		}
		name := entry.Name()
		if strings.HasPrefix(name, "test_") && strings.EqualFold(filepath.Ext(name), ".py") || strings.EqualFold(name, "conftest.py") {
			found = true
			return filepath.SkipAll
		}
		return nil
	})
	return found
}

// depthOf è la profondità di path sotto root.
func depthOf(root, path string) int {
	relative, err := filepath.Rel(root, path)
	if err != nil || relative == "." {
		return 0
	}
	return strings.Count(filepath.ToSlash(relative), "/") + 1
}
