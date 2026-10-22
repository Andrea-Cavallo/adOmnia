package rust

import (
	"os"
	"regexp"
	"strings"
)

// CargoDependency è una dipendenza dichiarata in un Cargo.toml con la posizione esatta del valore
// della versione, così l'editor può segnare la riga e sostituire solo la versione (RS-8.1, analogo
// di pomdeps.go per Maven).
type CargoDependency struct {
	Name      string   `json:"name"`
	Version   string   `json:"version,omitempty"`
	Section   string   `json:"section"` // "dependencies" | "dev-dependencies" | "build-dependencies"
	Workspace bool     `json:"workspace,omitempty"`
	Path      string   `json:"path,omitempty"`
	Git       string   `json:"git,omitempty"`
	Features  []string `json:"features,omitempty"`
	// Posizione del valore della versione (o della riga della dipendenza se non c'è versione), 1-based.
	Line     int `json:"line"`
	StartCol int `json:"startColumn"`
	EndCol   int `json:"endColumn"`
}

// Key è il nome del crate: il coordinate che crates.io e OSV usano.
func (d CargoDependency) Key() string { return d.Name }

var (
	// depSection è `[dependencies]` / `[dev-dependencies]` / `[build-dependencies]` /
	// `[workspace.dependencies]`.
	depSection = regexp.MustCompile(`^\[(?:workspace\.)?(dependencies|dev-dependencies|build-dependencies)\]$`)
	// inlineVersion è `version = "…"` in una tabella inline.
	inlineVersion = regexp.MustCompile(`\bversion\s*=\s*"([^"]*)"`)
	// inlinePath / inlineGit / inlineFeatures leggono gli altri campi della tabella inline.
	inlinePath     = regexp.MustCompile(`\bpath\s*=\s*"([^"]*)"`)
	inlineGit      = regexp.MustCompile(`\bgit\s*=\s*"([^"]*)"`)
	inlineWorkspace = regexp.MustCompile(`\bworkspace\s*=\s*true\b`)
)

// ReadCargoDependencies legge le dipendenze di un Cargo.toml con le posizioni di riga e colonna.
func ReadCargoDependencies(path string) ([]CargoDependency, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return ParseCargoDependencies(data), nil
}

// ParseCargoDependencies è ReadCargoDependencies su un testo già in memoria (anche non salvato).
// Nessuna risoluzione di rete né di `workspace = true` (la versione ereditata resta vuota qui).
func ParseCargoDependencies(data []byte) []CargoDependency {
	var deps []CargoDependency
	section := ""
	for lineIdx, raw := range strings.Split(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n") {
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		if match := depSection.FindStringSubmatch(trimmed); match != nil {
			section = match[1]
			continue
		}
		if section == "" {
			continue
		}
		name, value, ok := cutDependencyLine(trimmed)
		if !ok {
			continue
		}
		dep := CargoDependency{Name: name, Section: section, Line: lineIdx + 1}
		dep.Version, dep.Workspace, dep.Path, dep.Git, dep.Features = parseDependencyValue(value)
		if dep.Version != "" {
			dep.StartCol, dep.EndCol = versionColumn(trimmed, dep.Version)
		}
		deps = append(deps, dep)
	}
	return deps
}

// cutDependencyLine separa `name = value` rispettando le stringhe nella chiave.
func cutDependencyLine(line string) (name, value string, ok bool) {
	inString, quote := false, byte(0)
	for i := 0; i < len(line); i++ {
		char := line[i]
		switch {
		case inString && char == quote:
			inString = false
		case inString:
		case char == '"' || char == '\'':
			inString, quote = true, char
		case char == '=':
			return strings.TrimSpace(line[:i]), strings.TrimSpace(line[i+1:]), true
		}
	}
	return "", "", false
}

// parseDependencyValue interpreta il valore di una dipendenza: `"1.0"` (stringa) oppure una
// tabella inline `{ version = "1.0", features = […] }`.
func parseDependencyValue(value string) (version string, workspace bool, path, git string, features []string) {
	if strings.HasPrefix(value, `"`) {
		return trimQuotes(value), false, "", "", nil
	}
	if match := inlineVersion.FindStringSubmatch(value); match != nil {
		version = match[1]
	}
	workspace = inlineWorkspace.MatchString(value)
	if match := inlinePath.FindStringSubmatch(value); match != nil {
		path = match[1]
	}
	if match := inlineGit.FindStringSubmatch(value); match != nil {
		git = match[1]
	}
	features = featureList(value)
	return version, workspace, path, git, features
}

// featureList legge i nomi delle feature da `features = ["a", "b"]` nella tabella inline.
func featureList(value string) []string {
	start := strings.Index(value, "features")
	if start < 0 {
		return nil
	}
	open := strings.Index(value[start:], "[")
	close := strings.Index(value[start:], "]")
	if open < 0 || close < 0 || open > close {
		return nil
	}
	var features []string
	for _, item := range strings.Split(value[start+open+1:start+close], ",") {
		if name := trimQuotes(strings.TrimSpace(item)); name != "" {
			features = append(features, name)
		}
	}
	return features
}

func trimQuotes(value string) string {
	if len(value) >= 2 && (value[0] == '"' || value[0] == '\'') {
		return value[1 : len(value)-1]
	}
	return value
}

// versionColumn restituisce la colonna 1-based (in caratteri) del valore della versione nella riga.
func versionColumn(line, version string) (startCol, endCol int) {
	index := strings.Index(line, version)
	if index < 0 {
		return 0, 0
	}
	startCol = len([]rune(line[:index])) + 1
	endCol = startCol + len([]rune(version))
	return startCol, endCol
}
