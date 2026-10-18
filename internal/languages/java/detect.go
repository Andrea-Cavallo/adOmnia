package java

import (
	"context"
	"encoding/xml"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"adomnia/internal/ide/project"
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
func (*Language) DetectUnits(ctx context.Context, root string) ([]project.Unit, error) {
	var units []project.Unit
	visited := 0
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if walkErr != nil {
			if entry != nil && entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if !entry.IsDir() {
			return nil
		}
		if path != root && (ignoredDirectory(entry.Name()) || depth(root, path) > maxScanDepth) {
			return filepath.SkipDir
		}
		visited++
		if visited > maxScanDirectories || len(units) >= maxUnits {
			return filepath.SkipAll
		}
		if unit, ok := unitIn(path); ok {
			units = append(units, unit)
			return filepath.SkipDir // i sottoprogetti sono moduli di questo
		}
		return nil
	})
	sort.SliceStable(units, func(i, j int) bool { return units[i].Root < units[j].Root })
	return units, err
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
	file, err := os.Open(path)
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
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}
