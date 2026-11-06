package java

import (
	"path/filepath"
	"slices"
	"sort"
	"strings"
)

// External Libraries di un progetto Maven: le dipendenze che il build risolve, con il jar e il jar dei
// sorgenti nel repository locale. Come i moduli del go.mod per Go: codice da leggere, non da modificare.

// LibraryRef è una dipendenza risolta di un modulo, come la dà il resolver offline del pom.
type LibraryRef struct {
	GroupID    string
	ArtifactID string
	Version    string
	Scope      string
	Direct     bool
	// Module è la cartella del pom che la porta, relativa al progetto ("" per la radice).
	Module string
}

// Library è una riga di External Libraries.
type Library struct {
	GroupID    string `json:"groupId"`
	ArtifactID string `json:"artifactId"`
	Version    string `json:"version"`
	Scope      string `json:"scope,omitempty"`
	// Direct è vero se almeno un pom del progetto la dichiara.
	Direct bool `json:"direct"`
	// Modules sono i pom (cartelle relative al progetto) che la portano.
	Modules []string `json:"modules"`
	// Downloaded dice se il jar è nel repository locale; Sources se c'è anche il jar dei sorgenti.
	Downloaded bool `json:"downloaded"`
	Sources    bool `json:"sources"`
}

// Coordinate è `group:artifact:version`.
func (l Library) Coordinate() string { return l.GroupID + ":" + l.ArtifactID + ":" + l.Version }

// ArtifactPath è il file di un artefatto nel repository Maven locale; classifier "" per il jar principale.
func ArtifactPath(repository, groupID, artifactID, version, classifier string) string {
	if repository == "" || groupID == "" || artifactID == "" || version == "" {
		return ""
	}
	name := artifactID + "-" + version
	if classifier != "" {
		name += "-" + classifier
	}
	return filepath.Join(repository, filepath.FromSlash(strings.ReplaceAll(groupID, ".", "/")), artifactID, version, name+".jar")
}

// ProjectCoordinate è `group:artifact` di un pom del progetto (il groupId può venire dal parent): una
// dipendenza verso un altro modulo dello stesso progetto non è una libreria esterna.
func ProjectCoordinate(pomPath string) string {
	pom := readPom(pomPath)
	group := pom.GroupID
	if group == "" {
		group = pom.Parent.GroupID
	}
	if group == "" || pom.ArtifactID == "" {
		return ""
	}
	return group + ":" + pom.ArtifactID
}

// maxReactorPoms limita i pom di un reactor: un progetto vero ne ha decine, non migliaia.
const maxReactorPoms = 500

// ReactorPoms sono il pom dato e quelli dei suoi `<modules>`, ricorsivamente, dentro root: un progetto multi-modulo
// è un'unità sola nella detection, ma ogni modulo ha le sue dipendenze.
func ReactorPoms(rootPom, root string) []string {
	poms := []string{}
	seen := map[string]bool{}
	queue := []string{filepath.Clean(rootPom)}
	for len(queue) > 0 && len(poms) < maxReactorPoms {
		pom := queue[0]
		queue = queue[1:]
		if seen[pom] || !isFile(pom) || !withinRoot(root, pom) {
			continue
		}
		seen[pom] = true
		poms = append(poms, pom)
		for _, module := range readPom(pom).Modules {
			candidate := filepath.Join(filepath.Dir(pom), filepath.FromSlash(strings.TrimSpace(module)))
			if !strings.HasSuffix(strings.ToLower(candidate), ".xml") {
				candidate = filepath.Join(candidate, "pom.xml")
			}
			queue = append(queue, filepath.Clean(candidate))
		}
	}
	return poms
}

func withinRoot(root, path string) bool {
	relative, err := filepath.Rel(root, path)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

// MergeLibraries unisce le dipendenze di tutti i moduli: stessa coordinata una volta sola, i moduli del progetto
// fuori, le dirette prima. Il repository dice cosa è già scaricato e se ci sono i sorgenti.
func MergeLibraries(refs []LibraryRef, own map[string]bool, repository string) []Library {
	merged := map[string]*Library{}
	order := []string{}
	for _, ref := range refs {
		if ref.GroupID == "" || ref.ArtifactID == "" || ref.Version == "" || own[ref.GroupID+":"+ref.ArtifactID] {
			continue
		}
		key := ref.GroupID + ":" + ref.ArtifactID + ":" + ref.Version
		library, known := merged[key]
		if !known {
			library = &Library{GroupID: ref.GroupID, ArtifactID: ref.ArtifactID, Version: ref.Version, Scope: ref.Scope}
			merged[key] = library
			order = append(order, key)
		}
		library.Direct = library.Direct || ref.Direct
		if !slices.Contains(library.Modules, ref.Module) {
			library.Modules = append(library.Modules, ref.Module)
		}
	}
	libraries := make([]Library, 0, len(order))
	for _, key := range order {
		library := *merged[key]
		library.Downloaded = isFile(ArtifactPath(repository, library.GroupID, library.ArtifactID, library.Version, ""))
		library.Sources = isFile(ArtifactPath(repository, library.GroupID, library.ArtifactID, library.Version, "sources"))
		libraries = append(libraries, library)
	}
	sort.SliceStable(libraries, func(i, j int) bool {
		if libraries[i].Direct != libraries[j].Direct {
			return libraries[i].Direct
		}
		return libraries[i].Coordinate() < libraries[j].Coordinate()
	})
	return libraries
}

// SourcesDownloadArguments scaricano nel repository locale il jar dei sorgenti di una sola libreria.
func SourcesDownloadArguments(groupID, artifactID, version string) []string {
	return []string{"-B", "-q", "org.apache.maven.plugins:maven-dependency-plugin:3.6.1:get", "-Dartifact=" + groupID + ":" + artifactID + ":" + version + ":jar:sources", "-Dtransitive=false"}
}

// LibraryCoordinateValid rifiuta coordinate con caratteri che non stanno in un percorso del repository.
func LibraryCoordinateValid(groupID, artifactID, version string) bool {
	for _, part := range []string{groupID, artifactID, version} {
		if part == "" || strings.ContainsAny(part, `/\: `) || strings.Contains(part, "..") || strings.HasPrefix(part, "-") {
			return false
		}
	}
	return true
}
