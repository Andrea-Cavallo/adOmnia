package codestudio

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/languages/native"
)

// NativeLibraries è External Libraries di un progetto C/C++: le dipendenze dichiarate nei manifest
// (find_package, pkg-config, FetchContent/CPM, vcpkg, Conan, Meson). FetchContent e vcpkg hanno il
// codice nel progetto e si sfogliano; una libreria di sistema resta la sola dichiarazione.
func (s *Service) NativeLibraries(sessionID string) (LanguageLibraries, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return LanguageLibraries{}, err
	}
	result := LanguageLibraries{Language: "cpp", Libraries: []LanguageLibrary{}, Warnings: []string{}}
	type aggregate struct {
		library LanguageLibrary
		modules map[string]bool
	}
	merged := map[string]*aggregate{}
	order := []string{}
	for _, unit := range languageUnits(session.Project, "cpp") {
		module := projectRelativePath(session.Project, unit.Root)
		for _, declaration := range native.Declarations(unit.Root) {
			key := strings.ToLower(declaration.Name)
			entry, known := merged[key]
			if !known {
				entry = &aggregate{modules: map[string]bool{}}
				entry.library = LanguageLibrary{
					Name: declaration.Name, Version: declaration.Version, Direct: true,
					Kind: declaration.Kind, Directory: declaration.Directory, Available: declaration.Directory != "",
				}
				if entry.library.Version == "" && declaration.Directory != "" {
					entry.library.Version = native.VersionFromVcpkgSpdx(declaration.Directory)
				}
				if !entry.library.Available {
					entry.library.Note = fmt.Sprintf("declared in %s; a system package or not downloaded in this project", declaration.Manifest)
				}
				merged[key] = entry
				order = append(order, key)
			}
			if entry.library.Version == "" && declaration.Version != "" {
				entry.library.Version = declaration.Version
			}
			if entry.library.Directory == "" && declaration.Directory != "" {
				entry.library.Directory = declaration.Directory
				entry.library.Kind = declaration.Kind
				entry.library.Available = true
				entry.library.Note = ""
			}
			if module != "" {
				entry.modules[module] = true
			}
		}
	}
	libraries := make([]LanguageLibrary, 0, len(order))
	for _, key := range order {
		entry := merged[key]
		entry.library.Module = joinedModules(entry.modules)
		libraries = append(libraries, entry.library)
	}
	sort.SliceStable(libraries, func(i, j int) bool {
		if libraries[i].Available != libraries[j].Available {
			return libraries[i].Available
		}
		return strings.ToLower(libraries[i].Name) < strings.ToLower(libraries[j].Name)
	})
	result.Libraries = libraries
	return result, nil
}

// NativeLibrarySource localizza il codice di una dipendenza C/C++: FetchContent/CPM (`_deps/<name>-src`)
// o vcpkg (`vcpkg_installed/<triplet>/share/<name>`). Una libreria di sistema non ha sorgenti qui.
func (s *Service) NativeLibrarySource(sessionID, name, module string) (DependencySource, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return DependencySource{}, err
	}
	name = strings.TrimSpace(name)
	if name == "" || strings.ContainsAny(name, `/\`) || name == "." || name == ".." {
		return DependencySource{}, fmt.Errorf("invalid C/C++ dependency name")
	}
	units := languageUnits(session.Project, "cpp")
	forEachUnit := func(matchModule bool) (DependencySource, bool) {
		for _, unit := range units {
			if matchModule && module != "" && module != "." {
				if unitModule := projectRelativePath(session.Project, unit.Root); strings.Trim(module, "/.") != strings.Trim(unitModule, "/.") {
					continue
				}
			}
			for _, declaration := range native.Declarations(unit.Root) {
				if !strings.EqualFold(declaration.Name, name) {
					continue
				}
				if declaration.Directory == "" {
					return DependencySource{
						Found: false, ModulePath: declaration.Name,
						Reason: fmt.Sprintf("%s is declared in %s but its source is not in this project (system package or not downloaded)", declaration.Name, declaration.Manifest),
					}, true
				}
				source := DependencySource{ModulePath: declaration.Name, Version: declaration.Version}
				described := describeDependencyDirectory(session.Project, source, declaration.Directory, "native-dependency")
				// Il primo file è un header/sorgente, non CMakeLists.txt o un README.
				if entry := nativeEntryPath(described); entry != "" {
					described.EntryPath = entry
					described.EntryFile = filepath.Join(described.Directory, filepath.FromSlash(entry))
				}
				// Il codice di terze parti vive nel progetto (build/_deps, vcpkg_installed): si apre
				// sempre in sola lettura, come una dipendenza scaricata.
				described.Kind = "native-dependency"
				described.RelativeDir = ""
				described.EntryRelative = ""
				return described, true
			}
		}
		return DependencySource{}, false
	}
	if source, ok := forEachUnit(true); ok {
		return source, nil
	}
	if source, ok := forEachUnit(false); ok {
		return source, nil
	}
	return DependencySource{
		Found: false, ModulePath: name,
		Reason: "this dependency is not declared in the C/C++ build files",
	}, nil
}

// nativeExternalRoots rende leggibili le cartelle delle dipendenze C/C++ che vivono nel progetto
// (FetchContent, vcpkg): l'API external le apre come codice di terze parti, in sola lettura.
func (s *Service) nativeExternalRoots(session Session) []string {
	if len(languageUnits(session.Project, "cpp")) == 0 {
		return nil
	}
	return []string{session.Project.RealPath}
}

// nativeEntryPath sceglie il primo header o sorgente della dipendenza: CMakeLists.txt e i README
// restano sfogliabili, ma non sono il file che si apre per primo.
func nativeEntryPath(source DependencySource) string {
	for _, extension := range []string{".h", ".hpp", ".hh", ".hxx", ".c", ".cc", ".cpp", ".cxx", ".inl", ".ipp"} {
		for _, file := range source.Files {
			if strings.HasSuffix(strings.ToLower(file.Path), extension) {
				return file.Path
			}
		}
	}
	return ""
}
