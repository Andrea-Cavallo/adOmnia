package codestudio

import (
	"fmt"
	"sort"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
	"github.com/Andrea-Cavallo/adOmnia/internal/languages/python"
)

// PythonLibraries è External Libraries di un progetto Python: i pacchetti installati nell'ambiente di
// ogni unità (site-packages letto staticamente), con le dichiarazioni del manifest come righe "non
// installate". Nessun processo: vale anche prima dell'autorizzazione dei tool.
func (s *Service) PythonLibraries(sessionID string) (LanguageLibraries, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return LanguageLibraries{}, err
	}
	result := LanguageLibraries{Language: python.ID, Libraries: []LanguageLibrary{}, Warnings: []string{}}
	type aggregate struct {
		library LanguageLibrary
		modules map[string]bool
		dev     bool
		runtime bool
	}
	merged := map[string]*aggregate{}
	order := []string{}
	add := func(name string, library LanguageLibrary, module string, direct, dev bool) *aggregate {
		key := python.NormalizedDependencyName(name)
		entry, known := merged[key]
		if !known {
			entry = &aggregate{library: library, modules: map[string]bool{}}
			entry.library.Name = key
			merged[key] = entry
			order = append(order, key)
		}
		if entry.library.Version == "" && library.Version != "" {
			entry.library.Version = library.Version
		}
		if entry.library.Directory == "" && library.Directory != "" {
			entry.library.Directory = library.Directory
			entry.library.Kind = library.Kind
			entry.library.Available = library.Available
		}
		if entry.library.Note == "" && library.Note != "" {
			entry.library.Note = library.Note
		}
		if direct {
			entry.library.Direct = true
		}
		if dev {
			entry.dev = true
		} else {
			entry.runtime = true
		}
		if module != "" {
			entry.modules[module] = true
		}
		return entry
	}
	for _, unit := range pythonUnits(session.Project) {
		module := projectRelativePath(session.Project, unit.Root)
		interpreter, _ := python.ResolveInterpreter(session.Project.RealPath, unit.Root, "")
		sites := python.SitePackages(unit.Root, interpreter.Path)
		if len(sites) == 0 {
			result.Warnings = append(result.Warnings, fmt.Sprintf("%s: no site-packages found; create the Python environment or select an interpreter to read the installed packages", moduleOrRoot(module)))
		}
		installed := map[string]bool{}
		for _, distribution := range python.InstalledDistributions(sites) {
			installed[distribution.Name] = true
			add(distribution.Name, LanguageLibrary{
				Version: distribution.Version, Direct: false, Kind: "site-packages",
				Directory: distribution.Directory, Available: true,
			}, module, false, false)
		}
		for _, declared := range python.DeclaredDependencies(unit.Root) {
			library := LanguageLibrary{Direct: true}
			if installed[declared.Name] {
				add(declared.Name, library, module, true, declared.Dev)
				continue
			}
			library.Version = declared.Resolved
			if library.Version == "" {
				library.Version = declared.Version
			}
			library.Kind = "declared"
			library.Available = false
			library.Note = "declared but not installed in the selected environment"
			if library.Version == "" && declared.Spec != "" {
				library.Note = fmt.Sprintf("declared %s but not installed in the selected environment", declared.Spec)
			}
			add(declared.Name, library, module, true, declared.Dev)
		}
	}
	libraries := make([]LanguageLibrary, 0, len(order))
	for _, key := range order {
		entry := merged[key]
		entry.library.Module = joinedModules(entry.modules)
		if entry.library.Scope == "" && entry.dev && !entry.runtime {
			entry.library.Scope = "dev"
		}
		libraries = append(libraries, entry.library)
	}
	sort.SliceStable(libraries, func(i, j int) bool {
		if libraries[i].Direct != libraries[j].Direct {
			return libraries[i].Direct
		}
		return libraries[i].Name < libraries[j].Name
	})
	result.Libraries = libraries
	return result, nil
}

// PythonLibrarySource localizza il codice di un pacchetto installato e lo descrive come il sorgente di
// una dipendenza Go: la cartella si sfoglia in sola lettura (o in modifica per un'installazione editable
// dentro il progetto).
func (s *Service) PythonLibrarySource(sessionID, name string) (DependencySource, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return DependencySource{}, err
	}
	normalized := python.NormalizedDependencyName(name)
	if normalized == "" || strings.ContainsAny(normalized, `/\`) || normalized == "." || normalized == ".." {
		return DependencySource{}, fmt.Errorf("invalid Python package name")
	}
	for _, unit := range pythonUnits(session.Project) {
		interpreter, _ := python.ResolveInterpreter(session.Project.RealPath, unit.Root, "")
		for _, distribution := range python.InstalledDistributions(python.SitePackages(unit.Root, interpreter.Path)) {
			if distribution.Name != normalized {
				continue
			}
			source := DependencySource{ModulePath: distribution.Name, Version: distribution.Version}
			described := describeDependencyDirectory(session.Project, source, distribution.Directory, "python-site-packages")
			// Un package installato è codice di terze parti anche quando l'ambiente vive nel progetto
			// (.venv): si apre in sola lettura, come la module cache di Go.
			described.Kind = "python-site-packages"
			described.RelativeDir = ""
			described.EntryRelative = ""
			return described, nil
		}
	}
	return DependencySource{
		Found: false, ModulePath: normalized,
		Reason: "this package is not installed in the selected Python environment",
	}, nil
}

// pythonExternalRoots sono i site-packages che External Libraries può sfogliare fuori dal progetto.
func (s *Service) pythonExternalRoots(session Session) []string {
	roots := []string{}
	for _, unit := range pythonUnits(session.Project) {
		interpreter, _ := python.ResolveInterpreter(session.Project.RealPath, unit.Root, "")
		roots = append(roots, python.SitePackages(unit.Root, interpreter.Path)...)
	}
	return roots
}

func pythonUnits(workspaceProject Project) []project.Unit {
	return languageUnits(workspaceProject, python.ID)
}

func moduleOrRoot(module string) string {
	if module == "" {
		return "."
	}
	return module
}

func joinedModules(modules map[string]bool) string {
	values := make([]string, 0, len(modules))
	for module := range modules {
		values = append(values, moduloOrDefault(module))
	}
	sort.Strings(values)
	return strings.Join(values, ", ")
}

func moduloOrDefault(module string) string {
	if module == "" {
		return "."
	}
	return module
}
