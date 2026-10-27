package java

import (
	"context"
	"encoding/xml"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
)

const (
	maxScanDirectories = 4_000
	maxScanDepth       = 4
	maxUnits           = 50
)

// Cartelle di output di Maven (le altre, come build/.gradle, sono già ignorate dal core).
func ignoredDirectory(name string) bool {
	return project.IgnoredDirectory(name) || strings.EqualFold(name, "target")
}

var gradleBuildFiles = []string{"build.gradle.kts", "build.gradle"}

// DetectUnits trova i progetti Maven (pom.xml) e Gradle (build.gradle[.kts]) più esterni: i moduli di un
// progetto multi-modulo appartengono al progetto che li contiene e si eseguono da lì. Non esegue nulla.
// La scansione del disco è la stessa condivisa con gli altri linguaggi.
func (l *Language) DetectUnits(ctx context.Context, root string) ([]project.Unit, error) {
	visitor := l.NewUnitsVisitor(root)
	walkErr := project.WalkDirectories(ctx, root, project.MaxScanDirectories, visitor)
	units, err := visitor.Units()
	if err != nil {
		return units, err
	}
	return units, walkErr
}

// NewUnitsVisitor raccoglie i progetti Maven/Gradle da una scansione condivisa.
func (*Language) NewUnitsVisitor(root string) project.UnitsVisitor {
	return &unitsVisitor{}
}

// unitsVisitor è il visitor project detection di Java: riconosce il progetto più
// esterno per cartella e non scende nei suoi sottoprogetti (che ne sono moduli).
type unitsVisitor struct {
	units     []project.Unit
	skipRoots []string
	visited   int
	done      bool
}

func (v *unitsVisitor) VisitDirectory(visit project.DirectoryVisit) bool {
	if v.done || v.skipped(visit.Path) {
		return false
	}
	if visit.Name != "" && ignoredDirectory(visit.Name) {
		// Cartelle di output di Maven: non fanno parte della detection.
		v.skipRoots = append(v.skipRoots, visit.Path)
		return false
	}
	if visit.Depth > maxScanDepth {
		return false
	}
	v.visited++
	if v.visited > maxScanDirectories {
		v.done = true
		return false
	}
	if unit, ok := unitInCandidate(visit); ok {
		v.units = append(v.units, unit)
		// I sottoprogetti sono moduli di questo.
		v.skipRoots = append(v.skipRoots, visit.Path)
		if len(v.units) >= maxUnits {
			v.done = true
		}
		return false
	}
	return true
}

func (v *unitsVisitor) skipped(path string) bool {
	for _, root := range v.skipRoots {
		if path == root || strings.HasPrefix(path, root+string(filepath.Separator)) {
			return true
		}
	}
	return false
}

func (v *unitsVisitor) Units() ([]project.Unit, error) {
	sort.SliceStable(v.units, func(i, j int) bool { return v.units[i].Root < v.units[j].Root })
	return append([]project.Unit(nil), v.units...), nil
}

// unitInCandidate riconosce un progetto dalla lista di file già letta dalla
// scansione condivisa; i nomi candidati evitano ogni stat superfluo.
func unitInCandidate(visit project.DirectoryVisit) (project.Unit, bool) {
	candidate := false
	for _, name := range visit.Files {
		if name == "pom.xml" {
			candidate = true
			break
		}
		if slices.Contains(gradleBuildFiles, name) {
			candidate = true
		}
	}
	if !candidate {
		return project.Unit{}, false
	}
	return unitIn(visit.Path)
}

// unitIn riconosce un progetto nella cartella. Maven vince se ci sono entrambi i build file.
func unitIn(directory string) (project.Unit, bool) {
	if pom := filepath.Join(directory, "pom.xml"); isFile(pom) {
		return project.Unit{Language: ID, Kind: UnitMaven, Root: directory, Name: readPom(pom).ArtifactID, Manifest: pom}, true
	}
	for _, name := range gradleBuildFiles {
		if manifest := filepath.Join(directory, name); isFile(manifest) {
			return project.Unit{Language: ID, Kind: UnitGradle, Root: directory, Name: gradleName(directory), Manifest: manifest}, true
		}
	}
	return project.Unit{}, false
}

// pomInfo è la parte del pom.xml che serve a riconoscere il progetto.
type pomInfo struct {
	ArtifactID string `xml:"artifactId"`
	Parent     struct {
		GroupID    string `xml:"groupId"`
		ArtifactID string `xml:"artifactId"`
	} `xml:"parent"`
	Dependencies []struct {
		GroupID    string `xml:"groupId"`
		ArtifactID string `xml:"artifactId"`
	} `xml:"dependencies>dependency"`
	Plugins []struct {
		GroupID    string `xml:"groupId"`
		ArtifactID string `xml:"artifactId"`
	} `xml:"build>plugins>plugin"`
}

const maxManifestBytes = 1 << 20

func readPom(path string) pomInfo {
	data, err := readLimited(path)
	if err != nil {
		return pomInfo{}
	}
	var pom pomInfo
	// Un pom malformato resta un progetto: i campi letti prima dell'errore valgono comunque.
	_ = xml.Unmarshal(data, &pom)
	return pom
}

// usesSpringBoot è vero se il pom ha il parent, una dipendenza o il plugin di Spring Boot.
func (p pomInfo) usesSpringBoot() bool {
	if strings.Contains(p.Parent.ArtifactID, "spring-boot") {
		return true
	}
	for _, dependency := range p.Dependencies {
		if strings.Contains(dependency.ArtifactID, "spring-boot") {
			return true
		}
	}
	for _, plugin := range p.Plugins {
		if strings.Contains(plugin.ArtifactID, "spring-boot") {
			return true
		}
	}
	return false
}

var rootProjectName = regexp.MustCompile(`rootProject\.name\s*=\s*["']([^"']+)["']`)

// gradleName è rootProject.name di settings.gradle[.kts], altrimenti il nome della cartella.
func gradleName(directory string) string {
	for _, name := range []string{"settings.gradle.kts", "settings.gradle"} {
		if data, err := readLimited(filepath.Join(directory, name)); err == nil {
			if match := rootProjectName.FindSubmatch(data); match != nil {
				return string(match[1])
			}
		}
	}
	return filepath.Base(directory)
}

// usesGroup è vero se il pom ha il parent, una dipendenza o un plugin del groupId indicato (`io.quarkus`,
// `io.micronaut`): è il riconoscimento dei framework oltre Spring Boot.
func (p pomInfo) usesGroup(prefix string) bool {
	if strings.HasPrefix(p.Parent.GroupID, prefix) {
		return true
	}
	for _, dependency := range p.Dependencies {
		if strings.HasPrefix(dependency.GroupID, prefix) {
			return true
		}
	}
	for _, plugin := range p.Plugins {
		if strings.HasPrefix(plugin.GroupID, prefix) {
			return true
		}
	}
	return false
}

// gradleMentions è vero se il build file nomina il testo indicato (plugin id o coordinata).
func gradleMentions(manifest, text string) bool {
	data, err := readLimited(manifest)
	return err == nil && strings.Contains(string(data), text)
}

// gradleUsesSpringBoot cerca il plugin di Spring Boot nel build file.
func gradleUsesSpringBoot(manifest string) bool {
	data, err := readLimited(manifest)
	return err == nil && strings.Contains(string(data), "org.springframework.boot")
}

func readLimited(path string) ([]byte, error) {
	file, err := os.Open(path) // #nosec G703 -- read-only, size-limited manifest inside the opened project
	if err != nil {
		return nil, err
	}
	defer file.Close()
	return io.ReadAll(io.LimitReader(file, maxManifestBytes))
}

func depth(root, path string) int {
	relative, err := filepath.Rel(root, path)
	if err != nil || relative == "." {
		return 0
	}
	return strings.Count(filepath.ToSlash(relative), "/") + 1
}

func isFile(path string) bool {
	info, err := os.Stat(path) // #nosec G703 -- stat only inside the opened project
	return err == nil && !info.IsDir()
}
