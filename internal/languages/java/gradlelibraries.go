package java

import (
	"os"
	"path/filepath"
	"strings"
)

// External Libraries per Gradle. Gradle non ha un repository locale con il layout fisso di Maven: i jar
// stanno in una cache indicizzata per hash, e il grafo risolto (BOM, version catalog, conflitti) esiste solo
// quando lo calcola Gradle. Quindi:
//   - la lista completa si ottiene con un task di sola lettura iniettato via init script (nessuna modifica al
//     progetto), autorizzato come run/test/debug;
//   - senza autorizzazione si legge in modo statico ciò che i build script dichiarano con una versione;
//   - i jar e i sorgenti si cercano nella cache Gradle, con fallback sul repository Maven locale.

// GradleLibrariesInitScript registra un task che stampa i componenti risolti delle configurazioni che
// External Libraries mostra. Il prefisso ADOMNIA| rende il parsing indipendente dai log di Gradle.
const GradleLibrariesInitScript = `allprojects { p ->
    if (p.tasks.findByName('adomniaLibraries') == null) {
        p.tasks.register('adomniaLibraries') {
            doLast {
                def names = ['compileClasspath', 'runtimeClasspath', 'testCompileClasspath', 'testRuntimeClasspath', 'annotationProcessor', 'testAnnotationProcessor', 'kapt', 'ksp']
                names.each { name ->
                    def cfg = p.configurations.findByName(name)
                    if (cfg == null || !cfg.canBeResolved) {
                        return
                    }
                    try {
                        cfg.incoming.resolutionResult.allComponents.each { comp ->
                            def id = comp.id
                            if (!(id instanceof org.gradle.api.artifacts.component.ModuleComponentIdentifier)) {
                                return
                            }
                            def direct = cfg.allDependencies.any { d -> d.group == id.group && d.name == id.module }
                            println "ADOMNIA|LIB|${p.projectDir.absolutePath}|${cfg.name}|${id.group}|${id.module}|${id.version}|${direct}"
                        }
                    } catch (Throwable ignored) {
                    }
                }
            }
        }
    }
}
`

// GradleSourcesInitScript registra un task che risolve l'artefatto sources di una coordinata con i repository
// del progetto. La coordinata arriva da -Padomnia.coordinate=group:artifact:version (validata prima di partire).
const GradleSourcesInitScript = `rootProject { p ->
    if (p.tasks.findByName('adomniaSources') == null) {
        p.tasks.register('adomniaSources') {
            doLast {
                def coordinate = p.findProperty('adomnia.coordinate')
                def parts = coordinate == null ? [] : coordinate.split(':')
                if (parts.length != 3) {
                    throw new GradleException('adomnia.coordinate must be group:artifact:version')
                }
                def dependency = p.dependencies.create(parts[0] + ':' + parts[1] + ':' + parts[2])
                def configuration = p.configurations.detachedConfiguration(dependency)
                configuration.attributes.attribute(org.gradle.api.attributes.Category.CATEGORY_ATTRIBUTE, p.objects.named(org.gradle.api.attributes.Category, org.gradle.api.attributes.Category.DOCUMENTATION))
                configuration.attributes.attribute(org.gradle.api.attributes.DocsType.DOCS_TYPE_ATTRIBUTE, p.objects.named(org.gradle.api.attributes.DocsType, org.gradle.api.attributes.DocsType.SOURCES))
                configuration.files.each { file -> println "ADOMNIA|SOURCE|${file.absolutePath}" }
            }
        }
    }
}
`

// GradleLibrariesArguments eseguono il task che elenca le dipendenze risolte. La configuration cache è
// disattivata: il task legge le configurazioni a execution time, come fanno gli script di diagnostica.
func GradleLibrariesArguments(initScript string) []string {
	return []string{"--console=plain", "--no-configuration-cache", "-q", "--init-script", initScript, "adomniaLibraries"}
}

// GradleSourcesArguments scaricano il jar dei sorgenti di una sola coordinata.
func GradleSourcesArguments(initScript, groupID, artifactID, version string) []string {
	return []string{
		"--console=plain", "--no-configuration-cache", "-q", "--init-script", initScript, "adomniaSources",
		"-Padomnia.coordinate=" + groupID + ":" + artifactID + ":" + version,
	}
}

// GradleLibraryRef è una riga risolta dal task Gradle, prima della fusione per coordinata.
type GradleLibraryRef struct {
	ProjectDir    string
	Configuration string
	GroupID       string
	ArtifactID    string
	Version       string
	Direct        bool
}

// GradleScopeName traduce la configurazione Gradle nello scope mostrato accanto alla libreria.
func GradleScopeName(configuration string) string {
	switch {
	case strings.HasPrefix(configuration, "test"):
		return "test"
	case configuration == "annotationProcessor", configuration == "testAnnotationProcessor", configuration == "kapt", configuration == "ksp":
		return "provided"
	case configuration == "compileOnly", configuration == "compileOnlyApi", configuration == "providedCompile", configuration == "providedRuntime":
		return "provided"
	case strings.HasPrefix(configuration, "runtime"):
		return "runtime"
	}
	return "compile"
}

// ParseGradleLibrariesOutput legge le righe ADOMNIA|LIB| del task, ignorando tutto il resto dell'output.
func ParseGradleLibrariesOutput(text string) []GradleLibraryRef {
	refs := []GradleLibraryRef{}
	for line := range strings.SplitSeq(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		parts := strings.Split(strings.TrimSpace(line), "|")
		if len(parts) != 8 || parts[0] != "ADOMNIA" || parts[1] != "LIB" {
			continue
		}
		if parts[4] == "" || parts[5] == "" || parts[6] == "" {
			continue
		}
		refs = append(refs, GradleLibraryRef{
			ProjectDir:    parts[2],
			Configuration: parts[3],
			GroupID:       parts[4],
			ArtifactID:    parts[5],
			Version:       parts[6],
			Direct:        parts[7] == "true",
		})
	}
	return refs
}

// GradleUserHome è GRADLE_USER_HOME dell'ambiente del progetto, altrimenti ~/.gradle.
func GradleUserHome(environment []string) string {
	for _, entry := range environment {
		key, value, ok := strings.Cut(entry, "=")
		if ok && strings.EqualFold(strings.TrimSpace(key), "GRADLE_USER_HOME") {
			if trimmed := strings.TrimSpace(value); trimmed != "" {
				return trimmed
			}
		}
	}
	if home, err := os.UserHomeDir(); err == nil {
		return filepath.Join(home, ".gradle")
	}
	return ""
}

// GradleArtifactPath è il file di un artefatto nella cache Gradle: group e artifact sono cartelle piatte
// (i punti restano nel nome), la versione contiene una sottocartella con l'hash. classifier "" per il jar.
func GradleArtifactPath(userHome, groupID, artifactID, version, classifier string) string {
	if userHome == "" || groupID == "" || artifactID == "" || version == "" {
		return ""
	}
	base := filepath.Join(userHome, "caches", "modules-2", "files-2.1", groupID, artifactID, version)
	name := artifactID + "-" + version
	if classifier != "" {
		name += "-" + classifier
	}
	name += ".jar"
	if direct := filepath.Join(base, name); isFile(direct) {
		return direct
	}
	entries, err := os.ReadDir(base)
	if err != nil {
		return ""
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		candidate := filepath.Join(base, entry.Name(), name)
		if isFile(candidate) {
			return candidate
		}
	}
	return ""
}
