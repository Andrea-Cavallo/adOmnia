package java

import (
	"regexp"
	"strings"
)

// Dipendenze di un build.gradle / build.gradle.kts, nello stesso formato del pom (PomDependency): l'editor
// segna le versioni, propone gli aggiornamenti e scrive la versione (o la variabile che la governa) allo
// stesso modo. È analisi del testo, non l'esecuzione di Gradle: ciò che un DSL calcola a runtime non si risolve.

var (
	// implementation 'g:a:v' · implementation("g:a:v") · api platform("g:a:v") · classpath "g:a:v"
	gradleStringDependency = regexp.MustCompile(`\b(implementation|api|compileOnly|compileOnlyApi|runtimeOnly|testImplementation|testCompileOnly|testRuntimeOnly|annotationProcessor|testAnnotationProcessor|kapt|ksp|developmentOnly|classpath|compile|runtime|testCompile|testRuntime|providedCompile|providedRuntime)\b\s*\(?\s*((?:enforced)?[Pp]latform\(\s*)?(["'])([\w.\-]+):([\w.\-]+)(?::([^"':@\s]+))?(?:@[\w]+)?(["'])`)
	// implementation group: 'g', name: 'a', version: 'v'
	gradleMapDependency = regexp.MustCompile(`\b(implementation|api|compileOnly|runtimeOnly|testImplementation|testRuntimeOnly|annotationProcessor|classpath|compile|runtime|testCompile)\b\s*\(?\s*group\s*[:=]\s*["']([\w.\-]+)["']\s*,\s*name\s*[:=]\s*["']([\w.\-]+)["'](?:\s*,\s*version\s*[:=]\s*["']([^"']+)["'])?`)
	// id 'org.springframework.boot' version '3.2.0' · id("...") version "..."
	gradlePlugin = regexp.MustCompile(`\bid\s*\(?\s*["']([\w.\-]+)["']\s*\)?\s*version\s*\(?\s*["']([^"']+)["']`)
	// springVersion = '3.2.0' · ext.springVersion = "3.2.0" · val springVersion = "3.2.0" · def springVersion = '3.2.0'
	gradleVariable = regexp.MustCompile(`^\s*(?:ext\.|extra\["?|(?:val|var|def|final\s+String|String)\s+)?["']?([A-Za-z_][\w.]*)["']?\]?\s*=\s*(["'])([^"']*)(["'])`)
	gradleVarUse   = regexp.MustCompile(`^\$\{?([A-Za-z_][\w.]*)\}?$`)
)

type gradleVariableDefinition struct {
	value                  string
	line, startCol, endCol int
}

// ParseGradleDependencies legge le coordinate dichiarate in un build script Gradle (Groovy o Kotlin).
func ParseGradleDependencies(data []byte) ([]PomDependency, error) {
	lines := strings.Split(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n")
	variables := map[string]gradleVariableDefinition{}
	for index, line := range lines {
		if match := gradleVariable.FindStringSubmatchIndex(line); match != nil {
			name := line[match[2]:match[3]]
			variables[name] = gradleVariableDefinition{value: line[match[6]:match[7]], line: index + 1, startCol: match[6] + 1, endCol: match[7] + 1}
		}
	}
	var found []PomDependency
	for index, line := range lines {
		if comment := strings.Index(line, "//"); comment >= 0 && !strings.Contains(line[:comment], "://") {
			line = line[:comment]
		}
		lineNumber := index + 1
		for _, match := range gradleStringDependency.FindAllStringSubmatchIndex(line, -1) {
			section := SectionDependency
			if match[4] >= 0 {
				section = SectionManagement
			}
			dependency := PomDependency{GroupID: line[match[8]:match[9]], ArtifactID: line[match[10]:match[11]], Section: section, Scope: line[match[2]:match[3]], Line: lineNumber}
			if match[12] >= 0 {
				applyGradleVersion(&dependency, line[match[12]:match[13]], lineNumber, match[12]+1, match[13]+1, variables)
			} else {
				dependency.StartCol, dependency.EndCol = match[10]+1, match[11]+1
			}
			found = append(found, dependency)
		}
		for _, match := range gradleMapDependency.FindAllStringSubmatchIndex(line, -1) {
			dependency := PomDependency{GroupID: line[match[4]:match[5]], ArtifactID: line[match[6]:match[7]], Section: SectionDependency, Scope: line[match[2]:match[3]], Line: lineNumber, StartCol: match[6] + 1, EndCol: match[7] + 1}
			if match[8] >= 0 {
				applyGradleVersion(&dependency, line[match[8]:match[9]], lineNumber, match[8]+1, match[9]+1, variables)
			}
			found = append(found, dependency)
		}
		for _, match := range gradlePlugin.FindAllStringSubmatchIndex(line, -1) {
			dependency := PomDependency{GroupID: line[match[2]:match[3]], ArtifactID: line[match[2]:match[3]] + ".gradle.plugin", Section: SectionPlugin, Line: lineNumber}
			applyGradleVersion(&dependency, line[match[4]:match[5]], lineNumber, match[4]+1, match[5]+1, variables)
			found = append(found, dependency)
		}
	}
	return found, nil
}

// applyGradleVersion scrive versione e posizione; se la versione è `$nome` o `${nome}` il punto da riscrivere è
// quello della variabile, come per le property del pom.
func applyGradleVersion(dependency *PomDependency, version string, line, startCol, endCol int, variables map[string]gradleVariableDefinition) {
	dependency.Version, dependency.Line, dependency.StartCol, dependency.EndCol = version, line, startCol, endCol
	dependency.Resolved = version
	use := gradleVarUse.FindStringSubmatch(version)
	if use == nil {
		return
	}
	dependency.Property, dependency.Resolved = use[1], ""
	if definition, ok := variables[use[1]]; ok {
		dependency.Resolved = definition.value
		dependency.PropertyLine, dependency.PropertyStartCol, dependency.PropertyEndCol = definition.line, definition.startCol, definition.endCol
	}
}
