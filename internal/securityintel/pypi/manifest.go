package pypi

import (
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/securityintel"
)

// declaredRequirement è una dipendenza letta da un manifest, con la versione esatta solo quando il
// manifest la fissa (`==` o `===`, oppure un valore Poetry esattamente numerico).
type declaredRequirement struct {
	name    string // normalizzato PEP 503: minuscolo, `-` come unico separatore
	version string // vuota se non è fissata
	scope   securityintel.Scope
}

// lockedPackage è una voce di `poetry.lock` o `uv.lock`: lì la versione è quella risolta.
type lockedPackage struct {
	name      string
	version   string
	testScope bool
}

// declaredRequirements legge le dipendenze di un manifest: requirements*.txt o pyproject.toml.
func declaredRequirements(base string, data []byte) ([]declaredRequirement, []string) {
	base = strings.ToLower(base)
	if isRequirementsFile(base) {
		return parseRequirements(string(data), requirementsScope(base))
	}
	if base == "pyproject.toml" {
		return parsePyproject(string(data))
	}
	return nil, nil
}

// requirementsScope: un file `requirements-dev.txt` o `requirements-test*.txt` dichiara dipendenze
// di sviluppo, che non espongono il servizio in produzione.
func requirementsScope(base string) securityintel.Scope {
	for _, marker := range []string{"dev", "test", "lint", "docs"} {
		if strings.Contains(base, marker) {
			return securityintel.ScopeTest
		}
	}
	return securityintel.ScopeCompile
}

// parseRequirements interpreta un requirements file: una dipendenza per riga, con extra, marker,
// commenti e opzioni pip. Le righe che pip non può risolvere senza rete (URL, VCS, `-e`) non
// diventano componenti e non producono warning: non sono coordinate interrogabili.
func parseRequirements(text string, scope securityintel.Scope) ([]declaredRequirement, []string) {
	var requirements []declaredRequirement
	var warnings []string
	seen := map[string]bool{}
	for line := range strings.SplitSeq(text, "\n") {
		line = stripRequirementComment(line)
		if line == "" || strings.HasPrefix(line, "-") {
			continue
		}
		requirement, ok, reason := parseRequirementLine(line, scope)
		if !ok {
			if reason != "" {
				warnings = append(warnings, reason)
			}
			continue
		}
		if seen[requirement.name] {
			continue
		}
		seen[requirement.name] = true
		requirements = append(requirements, requirement)
	}
	return requirements, warnings
}

// parseRequirementLine interpreta `name[extra]==1.2.3 ; marker`, `name>=1`, `name @ url`.
func parseRequirementLine(line string, scope securityintel.Scope) (declaredRequirement, bool, string) {
	if strings.Contains(line, "://") || strings.Contains(line, "@") {
		return declaredRequirement{}, false, ""
	}
	if index := strings.IndexByte(line, ';'); index >= 0 {
		line = strings.TrimSpace(line[:index]) // environment marker: non cambia la coordinata
	}
	specStart := strings.IndexAny(line, "=<>!~[ (")
	name := line
	specifier := ""
	if specStart >= 0 {
		name = line[:specStart]
		specifier = line[specStart:]
		// `requests[socks]==2.32.3`: gli extra non fanno parte della versione.
		if strings.HasPrefix(specifier, "[") {
			if end := strings.IndexByte(specifier, ']'); end >= 0 {
				specifier = specifier[end+1:]
			}
		}
	}
	name = normalizeName(name)
	if name == "" || strings.HasPrefix(name, "#") {
		return declaredRequirement{}, false, ""
	}
	version := exactVersion(specifier)
	if specifier != "" && version == "" && !strings.ContainsAny(specifier, "=<>!~") {
		// Un extra o un commento non sono una versione: la dipendenza resta valida.
		version = ""
	}
	return declaredRequirement{name: name, version: version, scope: scope}, true, ""
}

// exactVersion legge la versione da uno specifier che la fissa davvero: `==1.2.3` o `===1.2.3`.
// `>=`, `~=`, `!=`, `>` non sono versioni risolte e non si inventano.
func exactVersion(specifier string) string {
	specifier = strings.TrimSpace(specifier)
	specifier = strings.TrimPrefix(specifier, "=") // `==` → `=`
	if !strings.HasPrefix(specifier, "=") {
		return ""
	}
	value := strings.TrimPrefix(specifier, "=")
	value = strings.TrimSpace(value)
	value = strings.TrimPrefix(value, "=")
	value = strings.TrimSpace(value)
	if index := strings.IndexAny(value, ", ;[("); index >= 0 {
		value = strings.TrimSpace(value[:index])
	}
	if value == "" || strings.ContainsAny(value, "*<>=!~") {
		return ""
	}
	return value
}

// stripRequirementComment rimuove un commento `#` non dentro una stringa (raro nei requirements,
// ma i marker possono contenerne uno).
func stripRequirementComment(line string) string {
	line = strings.TrimSpace(line)
	if line == "" || strings.HasPrefix(line, "#") {
		return ""
	}
	if index := strings.Index(line, " #"); index >= 0 {
		line = strings.TrimSpace(line[:index])
	}
	return line
}

// parsePyproject legge le dipendenze di pyproject.toml: PEP 621 (`[project] dependencies`,
// `[project.optional-dependencies]`, `[dependency-groups]`) e il formato Poetry. I gruppi di sviluppo
// dichiarano dipendenze di test; un extra resta codice di produzione quando viene attivato.
func parsePyproject(text string) ([]declaredRequirement, []string) {
	var requirements []declaredRequirement
	seen := map[string]bool{}
	add := func(values []string, scope securityintel.Scope) {
		for _, value := range values {
			requirement, ok, _ := parseRequirementLine(value, scope)
			if !ok || seen[requirement.name] {
				continue
			}
			seen[requirement.name] = true
			requirements = append(requirements, requirement)
		}
	}
	lines := strings.Split(text, "\n")
	section := ""
	for index := 0; index < len(lines); index++ {
		line := strings.TrimSpace(lines[index])
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			section = strings.ToLower(strings.Trim(line, "[] "))
			continue
		}
		key, value, found := strings.Cut(line, "=")
		if !found || !strings.Contains(value, "[") {
			continue
		}
		key = strings.ToLower(strings.TrimSpace(key))
		switch section {
		case "project":
			if key != "dependencies" {
				continue
			}
			values, next := readTomlArray(lines, index, line)
			index = next
			add(values, securityintel.ScopeCompile)
		case "project.optional-dependencies":
			values, next := readTomlArray(lines, index, line)
			index = next
			add(values, securityintel.ScopeCompile)
		case "dependency-groups":
			values, next := readTomlArray(lines, index, line)
			index = next
			add(values, groupScope(key))
		}
	}
	for _, requirement := range parsePoetryDependencies(lines) {
		if seen[requirement.name] {
			continue
		}
		seen[requirement.name] = true
		requirements = append(requirements, requirement)
	}
	return requirements, nil
}

// groupScope dice se un gruppo di dipendenze (`dev`, `test`, `docs`…) è di sviluppo.
func groupScope(group string) securityintel.Scope {
	switch group {
	case "dev", "test", "testing", "tests", "lint", "typecheck", "docs":
		return securityintel.ScopeTest
	}
	return securityintel.ScopeCompile
}

// readTomlArray legge un array TOML che può stare su più righe: dalla riga corrente fino alla
// chiusura `]`, restituendo le stringhe fra virgolette e l'indice dell'ultima riga consumata.
func readTomlArray(lines []string, start int, first string) ([]string, int) {
	var values []string
	pending := first[strings.Index(first, "["):]
	for index := start; index < len(lines); index++ {
		content := pending
		if index > start {
			content = lines[index]
		}
		values = append(values, tomlStrings(content)...)
		if strings.Contains(content, "]") {
			return values, index
		}
	}
	return values, len(lines) - 1
}

// tomlStrings estrae le stringhe fra virgolette di una riga TOML, ignorando i commenti.
func tomlStrings(line string) []string {
	if index := strings.Index(line, "#"); index >= 0 {
		line = line[:index]
	}
	var values []string
	for {
		quote := strings.IndexAny(line, `"'`)
		if quote < 0 {
			return values
		}
		rest := line[quote+1:]
		end := strings.IndexByte(rest, line[quote])
		if end < 0 {
			return values
		}
		values = append(values, rest[:end])
		line = rest[end+1:]
	}
}

// parsePoetryDependencies legge le tabelle `[tool.poetry.dependencies]` e i gruppi Poetry.
func parsePoetryDependencies(lines []string) []declaredRequirement {
	var requirements []declaredRequirement
	section := ""
	for _, raw := range lines {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			section = strings.ToLower(strings.Trim(line, "[] "))
			continue
		}
		if !strings.Contains(section, "poetry") || !strings.Contains(section, "dependencies") {
			continue
		}
		if !strings.Contains(line, "=") {
			continue
		}
		key, value, _ := strings.Cut(line, "=")
		name := normalizeName(strings.Trim(key, ` "'`))
		if name == "" || name == "python" {
			continue
		}
		if index := strings.Index(value, "#"); index >= 0 {
			value = value[:index]
		}
		value = strings.TrimSpace(value)
		version := ""
		if strings.HasPrefix(value, `"`) || strings.HasPrefix(value, `'`) {
			// `name = "1.2.3"` è un pin; `name = "^1.2"` è un intervallo.
			literal := strings.Trim(value, ` "'`)
			if isExactVersionLiteral(literal) {
				version = literal
			}
		} else if strings.Contains(value, "version") {
			if literal := tomlVersionField(value); isExactVersionLiteral(literal) {
				version = literal
			}
		}
		scope := securityintel.ScopeCompile
		if strings.Contains(section, "group.dev") || strings.Contains(section, "group.test") {
			scope = securityintel.ScopeTest
		}
		requirements = append(requirements, declaredRequirement{name: name, version: version, scope: scope})
	}
	return requirements
}

// tomlVersionField estrae `version = "x"` da una tabella inline Poetry.
func tomlVersionField(value string) string {
	index := strings.Index(value, "version")
	if index < 0 {
		return ""
	}
	rest := value[index:]
	if _, after, found := strings.Cut(rest, "="); found {
		rest = strings.TrimSpace(after)
	}
	values := tomlStrings(rest)
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

// isExactVersionLiteral dice se un valore è una versione numerica esatta (`1.2.3`, `2.0.0rc1`) e non
// un intervallo Poetry (`^1.2`, `~1.2`, `*`, `>=1.2`).
func isExactVersionLiteral(literal string) bool {
	if literal == "" || strings.ContainsAny(literal, "^~*<>=!, ") {
		return false
	}
	digits := 0
	for _, c := range literal {
		switch {
		case c >= '0' && c <= '9':
			digits++
		case c == '.' || c == '-' || c == '+' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'):
		default:
			return false
		}
	}
	return digits > 0
}

// readLockfile cerca il lockfile accanto al manifest e ne legge i pacchetti risolti.
func readLockfile(root string) ([]lockedPackage, []string, bool) {
	for _, name := range []string{"poetry.lock", "uv.lock"} {
		data, err := os.ReadFile(filepath.Join(root, name))
		if err != nil {
			continue
		}
		locked, warnings := parseLockfile(string(data))
		if len(locked) == 0 {
			warnings = append(warnings, name+" lists no package with a version")
		}
		return locked, warnings, true
	}
	return nil, nil, false
}

// parseLockfile legge i blocchi `[[package]]` di poetry.lock e uv.lock: `name`, `version` e il
// gruppo (Poetry: `groups`/`category`; uv: nessun gruppo, lo scope resta di produzione).
func parseLockfile(text string) ([]lockedPackage, []string) {
	var packages []lockedPackage
	var warnings []string
	var current *lockedPackage
	flush := func() {
		if current == nil {
			return
		}
		if current.name != "" && current.version != "" {
			packages = append(packages, *current)
		} else if current.name != "" {
			warnings = append(warnings, current.name+" has no resolved version in the lockfile")
		}
		current = nil
	}
	for raw := range strings.SplitSeq(text, "\n") {
		line := strings.TrimSpace(raw)
		if strings.HasPrefix(line, "[[package]]") {
			flush()
			current = &lockedPackage{}
			continue
		}
		if current == nil {
			continue
		}
		if strings.HasPrefix(line, "[") {
			// Fine del blocco (es. `[package.dependencies]`, `[metadata]`): i campi che servono sono
			// già stati letti prima, quindi si esce dal blocco.
			flush()
			continue
		}
		if !strings.Contains(line, "=") {
			continue
		}
		key, value, _ := strings.Cut(line, "=")
		key = strings.ToLower(strings.TrimSpace(key))
		value = strings.TrimSpace(value)
		switch key {
		case "name":
			current.name = normalizeName(strings.Trim(value, ` "'`))
		case "version":
			current.version = strings.Trim(strings.TrimSpace(value), ` "'`)
		case "category":
			current.testScope = strings.Contains(strings.ToLower(value), "dev")
		case "groups":
			groups := strings.ToLower(value)
			current.testScope = strings.Contains(groups, `"dev"`) || strings.Contains(groups, `"test"`)
		}
		if key == "source" && (strings.Contains(value, "editable") || strings.Contains(value, "virtual")) {
			// Il progetto stesso (uv.lock): non è una dipendenza.
			current = nil
		}
	}
	flush()
	sort.Slice(packages, func(i, j int) bool { return packages[i].name < packages[j].name })
	return packages, warnings
}

// normalizeName è la normalizzazione PEP 503: minuscolo e `.`/`_` come `-`. È il nome che OSV usa
// per l'ecosistema PyPI.
func normalizeName(name string) string {
	normalized := strings.ToLower(strings.TrimSpace(name))
	normalized = strings.Trim(normalized, ` "'`)
	normalized = strings.ReplaceAll(normalized, "_", "-")
	return strings.ReplaceAll(normalized, ".", "-")
}

// pyprojectName legge il nome del progetto da `[project] name` o, in un pyproject Poetry, da
// `[tool.poetry] name`. È solo un'etichetta per il report: non partecipa alla risoluzione.
func pyprojectName(text string) string {
	section := ""
	for raw := range strings.SplitSeq(text, "\n") {
		line := strings.TrimSpace(raw)
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			section = strings.ToLower(strings.Trim(line, "[] "))
			continue
		}
		if section != "project" && section != "tool.poetry" {
			continue
		}
		key, value, found := strings.Cut(line, "=")
		if !found || strings.TrimSpace(key) != "name" {
			continue
		}
		if values := tomlStrings(value); len(values) > 0 {
			return values[0]
		}
	}
	return ""
}
