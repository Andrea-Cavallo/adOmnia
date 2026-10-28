package codestudio

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
)

// Makefile e docker compose nel flusso "Detected" (P2-B): i kind `make` e `docker-compose` esistono
// già, qui si propongono i target e i servizi trovati nel progetto — senza nuovi runner e senza
// eseguire nulla. Una proposta compare solo se lo strumento è installato sulla macchina, così la
// card non promette un avvio impossibile.

const maxToolSuggestions = 8

var (
	makefileNames = []string{"Makefile", "makefile", "GNUmakefile"}
	composeNames  = []string{"compose.yaml", "compose.yml", "docker-compose.yml", "docker-compose.yaml"}
	// Un target può essere eseguito da `make`: niente variabili, niente pattern, niente percorsi.
	makeTargetPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)
)

// makeSuggestions propone un target per ogni regola del Makefile del progetto.
func makeSuggestions(projectRoot string, lookPath func(string) (string, error)) []run.Suggestion {
	if _, err := lookPath("make"); err != nil {
		return nil
	}
	for _, name := range makefileNames {
		data, err := os.ReadFile(filepath.Join(projectRoot, name))
		if err != nil {
			continue
		}
		var found []run.Suggestion
		for _, target := range makefileTargets(string(data)) {
			if len(found) >= maxToolSuggestions {
				return found
			}
			found = append(found, run.Suggestion{
				ID: "make|" + target, Action: "run", UnitRoot: projectRoot,
				Title: "Makefile · " + target,
				Configuration: run.Configuration{
					Name: "make " + target, Kind: "make", Target: name, ProgramArguments: []string{target},
				},
			})
		}
		return found
	}
	return nil
}

// makefileTargets legge i target delle regole (`nome: dipendenze`). Ricette (righe con tab),
// commenti, assegnazioni di variabili, target speciali (`.PHONY`) e pattern rule (`%`) non sono
// target eseguibili.
func makefileTargets(content string) []string {
	var targets []string
	seen := map[string]bool{}
	for line := range strings.SplitSeq(content, "\n") {
		line = strings.TrimSuffix(line, "\r")
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, "\t") {
			continue
		}
		rule, _, ok := strings.Cut(trimmed, ":")
		if !ok {
			continue
		}
		// `VAR = value`, `VAR := …`, `VAR ?= …` non sono regole.
		if strings.ContainsAny(rule, "=?+") {
			continue
		}
		for _, field := range strings.Fields(rule) {
			if !makeTargetPattern.MatchString(field) || seen[field] {
				continue
			}
			seen[field] = true
			targets = append(targets, field)
		}
	}
	return targets
}

// composeSuggestions propone un servizio per ogni servizio del file compose del progetto.
func composeSuggestions(projectRoot string, lookPath func(string) (string, error)) []run.Suggestion {
	if _, err := lookPath("docker"); err != nil {
		return nil
	}
	for _, name := range composeNames {
		data, err := os.ReadFile(filepath.Join(projectRoot, name))
		if err != nil {
			continue
		}
		var found []run.Suggestion
		for _, service := range composeServices(data) {
			if len(found) >= maxToolSuggestions {
				return found
			}
			found = append(found, run.Suggestion{
				ID: "compose|" + name + "|" + service, Action: "run", UnitRoot: projectRoot,
				Title: "Compose · " + service,
				Configuration: run.Configuration{
					Name: name + " " + service, Kind: "docker-compose", Target: name, ProgramArguments: []string{"up", service},
				},
			})
		}
		return found
	}
	return nil
}

// composeServices elenca i nomi sotto `services:` in ordine alfabetico (stabile fra due scan).
func composeServices(data []byte) []string {
	var document struct {
		Services map[string]yaml.Node `yaml:"services"`
	}
	if err := yaml.Unmarshal(data, &document); err != nil {
		return nil
	}
	services := make([]string, 0, len(document.Services))
	for name := range document.Services {
		if run.ValidComposeService(name) {
			services = append(services, name)
		}
	}
	sort.Strings(services)
	return services
}

// buildToolSuggestions sono le proposte generiche di make e compose, nello stesso punto degli
// script e del Procfile.
func buildToolSuggestions(projectRoot string, lookPath func(string) (string, error)) []run.Suggestion {
	var found []run.Suggestion
	found = append(found, makeSuggestions(projectRoot, lookPath)...)
	found = append(found, composeSuggestions(projectRoot, lookPath)...)
	return found
}
