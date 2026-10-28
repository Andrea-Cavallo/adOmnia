package maven

import (
	"encoding/xml"
	"fmt"
	"regexp"
	"sort"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/securityintel"
)

// UpgradeManifest implementa securityintel.UpgradeEditor per pom.xml.
//
// È una trasformazione pura del testo: nessun processo, nessuna rete, nessuna
// scrittura. La modifica tocca solo la riga che decide davvero la versione:
// - il <version> della dichiarazione, quando è scritto lì;
// - il valore della proprietà, quando la dichiarazione usa "${proprietà}".
//
// Quando la versione arriva da un parent POM, da un BOM o da dependencyManagement,
// la modifica non è applicabile in questo file e viene restituito un errore con il
// motivo: il finding risulta bloccato invece di proporre un comando che fallisce.
func (*Adapter) UpgradeManifest(manifestText string, component securityintel.Component, targetVersion string) (string, error) {
	groupID, artifactID, found := strings.Cut(component.Name, ":")
	if !found || groupID == "" || artifactID == "" {
		return "", fmt.Errorf("the Maven coordinate %q is not valid", component.Name)
	}
	// Un pom malformato non ferma l'edit: valgono le proprietà lette fin qui.
	var pom POM
	_ = xml.Unmarshal([]byte(manifestText), &pom)
	properties := PomProperties(pom, nil)

	// Le proprietà dichiarate in questo file, con la posizione del loro valore.
	declared := map[string]textSpan{}
	if block := propertiesBlockPattern.FindStringIndex(manifestText); block != nil {
		body := manifestText[block[0]:block[1]]
		for name := range properties {
			if isProjectProperty(name) {
				continue
			}
			if span, _ := findElement(body, name); span != (textSpan{}) {
				declared[name] = textSpan{start: block[0] + span.start, end: block[0] + span.end}
			}
		}
	}

	replacements := []textReplacement{}
	reasons := []string{}
	seen := map[int]bool{}
	matched := 0
	for _, block := range dependencyBlockPattern.FindAllStringIndex(manifestText, -1) {
		base := block[0]
		body := manifestText[block[0]:block[1]]
		_, rawGroup := findElement(body, "groupId")
		_, rawArtifact := findElement(body, "artifactId")
		if strings.TrimSpace(Interpolate(strings.TrimSpace(rawGroup), properties)) != groupID ||
			strings.TrimSpace(Interpolate(strings.TrimSpace(rawArtifact), properties)) != artifactID {
			continue
		}
		matched++
		versionSpan, rawVersion := findElement(body, "version")
		rawVersion = strings.TrimSpace(rawVersion)
		switch {
		case rawVersion == "":
			reasons = append(reasons, "the version is not declared in this dependency: it is managed by dependencyManagement, a parent POM or an imported BOM")
		case strings.HasPrefix(rawVersion, "${"):
			name := strings.TrimSuffix(strings.TrimPrefix(rawVersion, "${"), "}")
			if isProjectProperty(name) {
				reasons = append(reasons, "the version is the project's own version ("+name+"): it cannot be upgraded here")
				continue
			}
			span, ok := declared[name]
			if !ok {
				reasons = append(reasons, "the version comes from property "+name+", which is not defined in this POM: it is managed by a parent POM or an imported BOM")
				continue
			}
			if current := strings.TrimSpace(Interpolate(rawVersion, properties)); current != "" && current != component.Version {
				reasons = append(reasons, fmt.Sprintf("this declaration resolves to %s while the graph selects %s: the version is managed elsewhere", current, component.Version))
				continue
			}
			if !seen[span.start] {
				seen[span.start] = true
				replacements = append(replacements, textReplacement{span: span, text: targetVersion})
			}
		default:
			if current := strings.TrimSpace(Interpolate(rawVersion, properties)); current != "" && current != component.Version {
				reasons = append(reasons, fmt.Sprintf("this declaration resolves to %s while the graph selects %s: the version is managed elsewhere", current, component.Version))
				continue
			}
			span := textSpan{start: base + versionSpan.start, end: base + versionSpan.end}
			if !seen[span.start] {
				seen[span.start] = true
				replacements = append(replacements, textReplacement{span: span, text: targetVersion})
			}
		}
	}

	if matched == 0 {
		return "", fmt.Errorf("%s is not declared in this POM: it is a transitive dependency. Add a dependency entry or upgrade the component that pulls it in", component.Name)
	}
	if len(replacements) == 0 {
		message := "the declared version cannot be changed for " + component.Name
		if len(reasons) > 0 {
			message += ": " + reasons[len(reasons)-1]
		}
		return "", fmt.Errorf("%s", message)
	}
	// Le sostituzioni si applicano dalla fine, così le posizioni restano valide.
	sort.SliceStable(replacements, func(left, right int) bool {
		return replacements[left].span.start > replacements[right].span.start
	})
	result := manifestText
	for _, replacement := range replacements {
		result = result[:replacement.span.start] + replacement.text + result[replacement.span.end:]
	}
	return result, nil
}

// VerifySteps implementa securityintel.UpgradeEditor per pom.xml.
//
// Risoluzione delle dipendenze, compilazione, test: l'ordine che un utente seguirebbe
// a mano. Ogni passo avvia un processo e viene eseguito solo con autorizzazione
// esplicita; in modalità offline Maven lavora sulla repository locale (-o).
func (*Adapter) VerifySteps(target securityintel.Target, _ securityintel.Component, _ string, options securityintel.ResolveOptions) []securityintel.VerifyStep {
	executable := findMaven(options.Environment)
	arguments := func(goal string) []string {
		args := []string{"-B", "-f", target.Manifest}
		if options.Offline {
			args = append(args, "-o")
		}
		return append(args, goal)
	}
	display := func(goal string) string {
		prefix := "mvn -B"
		if options.Offline {
			prefix += " -o"
		}
		return prefix + " " + goal
	}
	return []securityintel.VerifyStep{
		{
			ID:              "build",
			Label:           "Compile",
			Command:         display("compile"),
			Program:         executable,
			Args:            arguments("compile"),
			Dir:             target.Root,
			RequiresProcess: true,
		},
		{
			ID:              "test",
			Label:           "Run tests",
			Command:         display("test"),
			Program:         executable,
			Args:            arguments("test"),
			Dir:             target.Root,
			RequiresProcess: true,
		},
	}
}

// textSpan è un intervallo di testo nel manifest.
type textSpan struct {
	start, end int
}

// textReplacement è una sostituzione testuale da applicare al manifest.
type textReplacement struct {
	span textSpan
	text string
}

var (
	dependencyBlockPattern = regexp.MustCompile(`(?s)<dependency\b[^>]*>.*?</dependency>`)
	propertiesBlockPattern = regexp.MustCompile(`(?s)<properties\b[^>]*>.*?</properties>`)
)

// findElement ritorna la posizione relativa e il contenuto di <name>…</name> in un
// frammento di pom. La posizione è vuota se l'elemento non c'è.
func findElement(body, name string) (textSpan, string) {
	pattern := regexp.MustCompile(`(?s)<` + regexp.QuoteMeta(name) + `\b[^>]*>(.*?)</` + regexp.QuoteMeta(name) + `>`)
	locations := pattern.FindStringSubmatchIndex(body)
	if locations == nil {
		return textSpan{}, ""
	}
	return textSpan{start: locations[2], end: locations[3]}, body[locations[2]:locations[3]]
}

// isProjectProperty dice se una proprietà esprime la versione del progetto: cambiarla
// significherebbe rinominare il progetto, non aggiornare una dipendenza.
func isProjectProperty(name string) bool {
	switch strings.TrimSpace(name) {
	case "version", "project.version", "pom.version", "parent.version", "project.groupId", "groupId", "project.artifactId", "artifactId":
		return true
	default:
		return false
	}
}
