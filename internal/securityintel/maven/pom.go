// Package maven è l'adapter Maven di adOmnia Security Intelligence.
//
// Risolve le dipendenze di un pom.xml come Maven le risolverebbe davvero: proprietà
// interpolate, parent POM ereditati, versioni gestite da dependencyManagement e da BOM
// importati, scope, opzionali e dipendenze dei plugin di build. Non è una lettura
// naive del XML: il testo del manifest descrive l'intenzione, il grafo effettivo è
// un'altra cosa, ed è il grafo effettivo a finire nel report di sicurezza.
package maven

import (
	"encoding/xml"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"adomnia/internal/ide/project"
)

const maxPomBytes = 4 << 20

// POM è il modello del pezzo di pom.xml che il motore interpreta.
type POM struct {
	XMLName xml.Name `xml:"project"`
	// ModelVersion è obbligatorio nel pom e serve a distinguere i formati.
	ModelVersion string `xml:"modelVersion"`
	Parent       *struct {
		GroupID      string `xml:"groupId"`
		ArtifactID   string `xml:"artifactId"`
		Version      string `xml:"version"`
		RelativePath string `xml:"relativePath"`
	} `xml:"parent"`
	GroupID              string       `xml:"groupId"`
	ArtifactID           string       `xml:"artifactId"`
	Version              string       `xml:"version"`
	Packaging            string       `xml:"packaging"`
	Name                 string       `xml:"name"`
	Properties           Properties   `xml:"properties"`
	Dependencies         []Dependency `xml:"dependencies>dependency"`
	DependencyManagement struct {
		Dependencies []Dependency `xml:"dependencies>dependency"`
	} `xml:"dependencyManagement"`
	Build struct {
		Plugins []Plugin `xml:"plugins>plugin"`
	} `xml:"build"`
	Modules []string `xml:"modules>module"`
}

// Dependency è una dipendenza dichiarata o gestita.
type Dependency struct {
	GroupID    string `xml:"groupId"`
	ArtifactID string `xml:"artifactId"`
	Version    string `xml:"version"`
	Type       string `xml:"type"`
	Classifier string `xml:"classifier"`
	Scope      string `xml:"scope"`
	Optional   bool   `xml:"optional"`
	Exclusions []struct {
		GroupID    string `xml:"groupId"`
		ArtifactID string `xml:"artifactId"`
	} `xml:"exclusions>exclusion"`
}

// Plugin è un plugin di build: le sue dipendenze entrano nel processo di build e
// possono essere vulnerabili anche se non finiscono nell'artefatto distribuito.
type Plugin struct {
	GroupID      string       `xml:"groupId"`
	ArtifactID   string       `xml:"artifactId"`
	Version      string       `xml:"version"`
	Dependencies []Dependency `xml:"dependencies>dependency"`
}

// Properties è la mappa delle proprietà del pom, lette come elementi figli.
type Properties struct {
	Entries []Property `xml:",any"`
}

// Property è una proprietà nome → valore.
type Property struct {
	XMLName xml.Name
	Value   string `xml:",chardata"`
}

// Map converte le proprietà in una mappa.
func (p Properties) Map() map[string]string {
	result := map[string]string{}
	for _, entry := range p.Entries {
		result[entry.XMLName.Local] = strings.TrimSpace(entry.Value)
	}
	return result
}

// Coordinate è l'identità Maven di un artefatto.
type Coordinate struct {
	GroupID    string `json:"groupId"`
	ArtifactID string `json:"artifactId"`
	Version    string `json:"version"`
	Type       string `json:"type,omitempty"`
	Classifier string `json:"classifier,omitempty"`
}

// Key è la rappresentazione "groupId:artifactId" usata da OSV per l'ecosistema Maven.
func (c Coordinate) Key() string {
	return c.GroupID + ":" + c.ArtifactID
}

// String è la coordinata completa "groupId:artifactId:version[:type[:classifier]]".
func (c Coordinate) String() string {
	parts := []string{c.GroupID, c.ArtifactID, c.Version}
	if c.Type != "" && c.Type != "jar" {
		parts = append(parts, c.Type)
	}
	return strings.Join(parts, ":")
}

// ReadPOM legge e decodifica un pom.xml. Un pom malformato non è un errore fatale:
// i campi letti prima dell'errore valgono, e la risoluzione lo segnalerà.
func ReadPOM(path string) (POM, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return POM{}, err
	}
	if len(data) > maxPomBytes {
		data = data[:maxPomBytes]
	}
	var pom POM
	// encoding/xml si ferma alla prima riga malformata: il contenuto letto resta valido.
	decodeErr := xml.Unmarshal(data, &pom)
	return pom, decodeErr
}

// propertyPattern riconosce i riferimenti "${name}" da interpolare.
var propertyPattern = regexp.MustCompile(`\$\{([^}]+)\}`)

// Interpolate sostituisce i riferimenti a proprietà in un valore. Le proprietà non
// risolte restano nel testo: è meglio vedere "${project.version}" che un valore
// inventato, e il report lo segnala come warning.
func Interpolate(value string, properties map[string]string) string {
	if !strings.Contains(value, "${") {
		return value
	}
	return propertyPattern.ReplaceAllStringFunc(value, func(match string) string {
		name := strings.TrimSuffix(strings.TrimPrefix(match, "${"), "}")
		if resolved, found := properties[name]; found && resolved != "" {
			return resolved
		}
		return match
	})
}

// PomProperties costruisce la mappa delle proprietà implicite di un pom più quelle
// esplicite. Le proprietà implicite di Maven sono quelle che ogni pom ha sempre.
func PomProperties(pom POM, inherited map[string]string) map[string]string {
	properties := map[string]string{}
	for key, value := range inherited {
		properties[key] = value
	}
	for key, value := range pom.Properties.Map() {
		properties[key] = value
	}
	groupID := pom.GroupID
	if groupID == "" && pom.Parent != nil {
		groupID = pom.Parent.GroupID
	}
	version := pom.Version
	if version == "" && pom.Parent != nil {
		version = pom.Parent.Version
	}
	properties["project.groupId"] = groupID
	properties["project.artifactId"] = pom.ArtifactID
	properties["project.version"] = version
	properties["groupId"] = groupID
	properties["artifactId"] = pom.ArtifactID
	properties["version"] = version
	// Le due forme abbreviate che Maven accetta e che compaiono nei pom reali.
	properties["pom.groupId"] = groupID
	properties["pom.artifactId"] = pom.ArtifactID
	properties["pom.version"] = version
	return properties
}

// ParentCoordinate ritorna la coordinata del parent, già interpolata.
func ParentCoordinate(pom POM, properties map[string]string) (Coordinate, bool) {
	if pom.Parent == nil {
		return Coordinate{}, false
	}
	return Coordinate{
		GroupID:    Interpolate(pom.Parent.GroupID, properties),
		ArtifactID: Interpolate(pom.Parent.ArtifactID, properties),
		Version:    Interpolate(pom.Parent.Version, properties),
	}, true
}

// DependencyCoordinate ritorna la coordinata interpolata di una dipendenza.
func DependencyCoordinate(dependency Dependency, properties map[string]string) Coordinate {
	coordinate := Coordinate{
		GroupID:    strings.TrimSpace(Interpolate(dependency.GroupID, properties)),
		ArtifactID: strings.TrimSpace(Interpolate(dependency.ArtifactID, properties)),
		Version:    strings.TrimSpace(Interpolate(dependency.Version, properties)),
		Type:       strings.TrimSpace(Interpolate(dependency.Type, properties)),
		Classifier: strings.TrimSpace(Interpolate(dependency.Classifier, properties)),
	}
	if coordinate.Type == "" {
		coordinate.Type = "jar"
	}
	return coordinate
}

// ScopeOf normalizza lo scope di una dipendenza. Maven assegna "compile" quando lo
// scope non è dichiarato.
func ScopeOf(dependency Dependency) string {
	scope := strings.ToLower(strings.TrimSpace(dependency.Scope))
	switch scope {
	case "runtime", "provided", "test", "system", "import":
		return scope
	default:
		return "compile"
	}
}

// LocalRepository trova la repository locale Maven. Rispetta maven.repo.local se
// impostato nell'ambiente, altrimenti ~/.m2/repository.
func LocalRepository(environment []string) string {
	for _, entry := range environment {
		if strings.HasPrefix(entry, "maven.repo.local=") {
			if path := strings.TrimPrefix(entry, "maven.repo.local="); path != "" {
				return path
			}
		}
	}
	for _, entry := range environment {
		if strings.HasPrefix(entry, "MAVEN_OPTS=") && strings.Contains(entry, "maven.repo.local=") {
			if value, found := extractOption(entry, "-Dmaven.repo.local="); found {
				return value
			}
		}
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".m2", "repository")
}

// extractOption estrae il valore di un'opzione "-D" da una riga di argomenti.
func extractOption(arguments, prefix string) (string, bool) {
	index := strings.Index(arguments, prefix)
	if index < 0 {
		return "", false
	}
	value := arguments[index+len(prefix):]
	if end := strings.IndexAny(value, " \t"); end >= 0 {
		value = value[:end]
	}
	return strings.Trim(value, `"`), value != ""
}

// PomPath è il percorso di un artefatto nella repository locale Maven.
func PomPath(repository string, coordinate Coordinate) string {
	if repository == "" || coordinate.GroupID == "" || coordinate.ArtifactID == "" || coordinate.Version == "" {
		return ""
	}
	groupPath := strings.ReplaceAll(coordinate.GroupID, ".", string(filepath.Separator))
	return filepath.Join(repository, groupPath, coordinate.ArtifactID, coordinate.Version, coordinate.ArtifactID+"-"+coordinate.Version+".pom")
}

// FindPOMs trova i pom.xml più esterni sotto root, come fa la detection dell'IDE: i
// sottoprogetti appartengono al progetto che li contiene e si analizzano da lì.
func FindPOMs(root string) ([]string, error) {
	var manifests []string
	visited := 0
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			if entry != nil && entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if !entry.IsDir() {
			return nil
		}
		if path != root && (project.IgnoredDirectory(entry.Name()) || strings.EqualFold(entry.Name(), "target") || depthOf(root, path) > 4) {
			return filepath.SkipDir
		}
		visited++
		if visited > 4_000 || len(manifests) >= 50 {
			return filepath.SkipAll
		}
		if pom := filepath.Join(path, "pom.xml"); isFile(pom) {
			manifests = append(manifests, pom)
			return filepath.SkipDir // i sottoprogetti sono moduli di questo
		}
		return nil
	})
	sort.Strings(manifests)
	return manifests, err
}

func depthOf(root, path string) int {
	relative, err := filepath.Rel(root, path)
	if err != nil || relative == "." {
		return 0
	}
	return strings.Count(filepath.ToSlash(relative), "/") + 1
}

func isFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}
