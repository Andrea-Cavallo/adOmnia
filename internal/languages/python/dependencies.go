package python

import (
	"path/filepath"
	"sort"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
)

// DeclaredDependency è una dipendenza dichiarata da un'unità Python, con la versione risolta dal
// lockfile quando c'è. Serve alla vista delle dipendenze di Code Studio, che per Go e Maven mostra
// le stesse informazioni: nome, vincolo dichiarato, versione effettiva, file e riga.
//
// Lettura statica: nessun processo, nessun import, nessuna installazione (PY-1.2).
type DeclaredDependency struct {
	// Name è il nome normalizzato PEP 503, lo stesso usato da Security Intelligence.
	Name string `json:"name"`
	// Spec è il vincolo come scritto nel manifest (`==1.2.3`, `>=2`, vuoto se nudo).
	Spec string `json:"spec,omitempty"`
	// Version è la versione esatta dichiarata ("" se il manifest non la fissa).
	Version string `json:"version,omitempty"`
	// Resolved è la versione del lockfile (`poetry.lock`, `uv.lock`), "" se assente.
	Resolved string `json:"resolved,omitempty"`
	// Dev dice che la dipendenza arriva da un gruppo di sviluppo: non è nel runtime.
	Dev bool `json:"dev,omitzero"`
	// Source è il file che la dichiara, relativo all'unità (`requirements.txt`, `pyproject.toml`).
	Source string `json:"source"`
	// Line è la riga 1-based nel file, 0 se non determinabile (tabella Poetry).
	Line int `json:"line,omitzero"`
}

// DeclaredDependencies elenca le dipendenze di un'unità: pyproject.toml (PEP 621 e Poetry) e
// requirements*.txt, comprese le dipendenze di sviluppo, marcate come tali. L'ordine è stabile.
func DeclaredDependencies(unitRoot string) []DeclaredDependency {
	var dependencies []DeclaredDependency
	seen := map[string]bool{}
	add := func(dependency DeclaredDependency) {
		key := dependency.Name + "\x00" + dependency.Source
		if dependency.Name == "" || seen[key] {
			return
		}
		seen[key] = true
		dependencies = append(dependencies, dependency)
	}
	for _, dependency := range pyprojectDependencies(unitRoot) {
		add(dependency)
	}
	for _, name := range requirementsFiles(unitRoot) {
		data, err := readLimited(filepath.Join(unitRoot, name), maxManifestBytes)
		if err != nil {
			continue
		}
		for _, dependency := range requirementDependencies(name, string(data)) {
			add(dependency)
		}
	}
	locked := LockedVersions(unitRoot)
	for index := range dependencies {
		if version, ok := locked[dependencies[index].Name]; ok {
			dependencies[index].Resolved = version
		}
	}
	sort.SliceStable(dependencies, func(i, j int) bool {
		if dependencies[i].Source != dependencies[j].Source {
			return dependencies[i].Source < dependencies[j].Source
		}
		return dependencies[i].Name < dependencies[j].Name
	})
	return dependencies
}

// requirementsFiles sono i requirements*.txt dell'unità, con `requirements.txt` per primo.
func requirementsFiles(root string) []string {
	matches, err := filepath.Glob(filepath.Join(root, "requirements*.txt"))
	if err != nil {
		return nil
	}
	names := make([]string, 0, len(matches))
	for _, match := range matches {
		names = append(names, filepath.Base(match))
	}
	sort.Slice(names, func(i, j int) bool {
		if names[i] == "requirements.txt" {
			return true
		}
		if names[j] == "requirements.txt" {
			return false
		}
		return names[i] < names[j]
	})
	return names
}

// requirementDependencies legge un requirements file riga per riga, conservando la riga.
func requirementDependencies(source, text string) []DeclaredDependency {
	var dependencies []DeclaredDependency
	for index, raw := range strings.Split(text, "\n") {
		line := strings.TrimSpace(strings.TrimSuffix(raw, "\r"))
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "-") {
			continue
		}
		parsed, ok := parseRequirementSpec(line)
		if !ok {
			continue
		}
		parsed.Source, parsed.Line = source, index+1
		parsed.Dev = isDevRequirements(source)
		dependencies = append(dependencies, parsed)
	}
	return dependencies
}

// parseRequirementSpec separa nome, extra, vincolo e marker da una riga di requirements.
func parseRequirementSpec(line string) (DeclaredDependency, bool) {
	if strings.Contains(line, "://") || strings.Contains(line, " @ ") {
		return DeclaredDependency{}, false
	}
	if index := strings.IndexByte(line, '#'); index >= 0 {
		line = strings.TrimSpace(line[:index])
	}
	if index := strings.IndexByte(line, ';'); index >= 0 {
		line = strings.TrimSpace(line[:index])
	}
	name, spec := line, ""
	if index := strings.IndexAny(line, "=<>!~[ ("); index >= 0 {
		name, spec = line[:index], line[index:]
		// `requests[socks]==2.32.3`: gli extra non fanno parte del vincolo di versione.
		if strings.HasPrefix(spec, "[") {
			if end := strings.IndexByte(spec, ']'); end >= 0 {
				spec = spec[end+1:]
			}
		}
		spec = strings.TrimSpace(spec)
	}
	name = normalizeDependencyName(name)
	if name == "" {
		return DeclaredDependency{}, false
	}
	return DeclaredDependency{Name: name, Spec: spec, Version: exactVersionOf(spec)}, true
}

// exactVersionOf legge la versione solo se il vincolo la fissa (`==`/`===`).
func exactVersionOf(spec string) string {
	spec = strings.TrimSpace(spec)
	rest, found := strings.CutPrefix(spec, "==")
	if !found {
		return ""
	}
	rest = strings.TrimPrefix(rest, "=")
	if index := strings.IndexAny(rest, ", ;[("); index >= 0 {
		rest = rest[:index]
	}
	rest = strings.TrimSpace(rest)
	if rest == "" || strings.ContainsAny(rest, "*<>=!~") {
		return ""
	}
	return rest
}

// isDevRequirements dice se il file dichiara dipendenze di sviluppo.
func isDevRequirements(source string) bool {
	lower := strings.ToLower(source)
	for _, marker := range []string{"dev", "test", "lint", "docs"} {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}

// pyprojectDependencies legge `[project] dependencies`, `[project.optional-dependencies]`,
// `[dependency-groups]` e le tabelle Poetry, con la riga di ogni voce quando è su una riga sola.
func pyprojectDependencies(root string) []DeclaredDependency {
	data, err := readLimited(filepath.Join(root, "pyproject.toml"), maxManifestBytes)
	if err != nil {
		return nil
	}
	lines := strings.Split(string(data), "\n")
	var dependencies []DeclaredDependency
	section := ""
	for index := range lines {
		line := strings.TrimSpace(strings.TrimSuffix(lines[index], "\r"))
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			section = strings.ToLower(strings.Trim(line, "[] "))
			continue
		}
		key, value, found := strings.Cut(line, "=")
		if !found {
			continue
		}
		key = strings.ToLower(strings.TrimSpace(key))
		value = strings.TrimSpace(value)
		switch section {
		case "project":
			if key != "dependencies" {
				continue
			}
			dependencies = append(dependencies, arrayDependencies(lines, index, line, false)...)
		case "project.optional-dependencies":
			dependencies = append(dependencies, arrayDependencies(lines, index, line, false)...)
		case "dependency-groups":
			dependencies = append(dependencies, arrayDependencies(lines, index, line, isDevGroup(key))...)
		default:
			if !strings.Contains(section, "poetry") || !strings.Contains(section, "dependencies") {
				continue
			}
			if name := normalizeDependencyName(strings.Trim(key, ` "'`)); name != "" && name != "python" {
				dependency := DeclaredDependency{Name: name, Spec: strings.Trim(value, ` "'`), Source: "pyproject.toml", Line: index + 1, Dev: strings.Contains(section, "dev") || strings.Contains(section, "test")}
				if version := poetryVersion(value); version != "" {
					dependency.Version = version
				}
				dependencies = append(dependencies, dependency)
			}
		}
	}
	return dependencies
}

// arrayDependencies estrae le stringhe di un array TOML, anche su più righe.
func arrayDependencies(lines []string, start int, first string, dev bool) []DeclaredDependency {
	var dependencies []DeclaredDependency
	pending := first[strings.Index(first, "["):]
	for index := start; index < len(lines); index++ {
		content := pending
		if index > start {
			content = lines[index]
		}
		if index := strings.Index(content, "#"); index >= 0 {
			content = content[:index]
		}
		for _, quoted := range quotedStrings(content) {
			if parsed, ok := parseRequirementSpec(quoted); ok {
				parsed.Source, parsed.Line, parsed.Dev = "pyproject.toml", index+1, dev
				dependencies = append(dependencies, parsed)
			}
		}
		if strings.Contains(content, "]") {
			break
		}
	}
	return dependencies
}

// quotedStrings sono le stringhe fra virgolette di una riga TOML.
func quotedStrings(line string) []string {
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

// poetryVersion estrae la versione esatta da un valore Poetry (`"1.2.3"` o `{ version = "1.2.3" }`).
func poetryVersion(value string) string {
	literal := ""
	if strings.HasPrefix(value, "{") {
		index := strings.Index(value, "version")
		if index < 0 {
			return ""
		}
		if _, after, found := strings.Cut(value[index:], "="); found {
			if values := quotedStrings(after); len(values) > 0 {
				literal = values[0]
			}
		}
	} else if values := quotedStrings(value); len(values) > 0 {
		literal = values[0]
	}
	if literal == "" || strings.ContainsAny(literal, "^~*<>=!, ") {
		return ""
	}
	return literal
}

// isDevGroup dice se un gruppo di dipendenze (`dev`, `test`, `docs`…) è di sviluppo.
func isDevGroup(group string) bool {
	switch group {
	case "dev", "test", "testing", "tests", "lint", "typecheck", "docs":
		return true
	}
	return false
}

// LockedVersions legge le versioni risolte del lockfile dell'unità (poetry.lock o uv.lock).
// Il progetto stesso (voce editable/virtual di uv) non è una dipendenza.
func LockedVersions(unitRoot string) map[string]string {
	versions := map[string]string{}
	for _, name := range []string{"poetry.lock", "uv.lock"} {
		data, err := readLimited(filepath.Join(unitRoot, name), maxManifestBytes)
		if err != nil {
			continue
		}
		for packageName, version := range parseLockedVersions(string(data)) {
			if _, exists := versions[packageName]; !exists {
				versions[packageName] = version
			}
		}
		return versions
	}
	return versions
}

// parseLockedVersions legge i blocchi `[[package]]` di un lockfile Python.
func parseLockedVersions(text string) map[string]string {
	versions := map[string]string{}
	name, version, local := "", "", false
	flush := func() {
		if name != "" && version != "" && !local {
			versions[name] = version
		}
		name, version, local = "", "", false
	}
	for raw := range strings.SplitSeq(text, "\n") {
		line := strings.TrimSpace(strings.TrimSuffix(raw, "\r"))
		if strings.HasPrefix(line, "[[package]]") {
			flush()
			continue
		}
		if strings.HasPrefix(line, "[") {
			// `[package.dependencies]`, `[metadata]`: i campi del blocco sono già stati letti.
			if name != "" && version != "" {
				flush()
			}
			continue
		}
		key, value, found := strings.Cut(line, "=")
		if !found {
			continue
		}
		value = strings.TrimSpace(value)
		switch strings.ToLower(strings.TrimSpace(key)) {
		case "name":
			name = normalizeDependencyName(strings.Trim(value, ` "'`))
		case "version":
			version = strings.Trim(value, ` "'`)
		case "source":
			local = local || strings.Contains(value, "editable") || strings.Contains(value, "virtual")
		}
	}
	flush()
	return versions
}

// normalizeDependencyName è la normalizzazione PEP 503 (minuscolo, `-` come separatore).
func normalizeDependencyName(name string) string {
	normalized := strings.ToLower(strings.TrimSpace(name))
	normalized = strings.Trim(normalized, ` "'`)
	normalized = strings.ReplaceAll(normalized, "_", "-")
	return strings.ReplaceAll(normalized, ".", "-")
}

// UnitName è il nome leggibile dell'unità (quello del pyproject, altrimenti la cartella).
func UnitName(unit project.Unit) string {
	if unit.Name != "" {
		return unit.Name
	}
	return filepath.Base(unit.Root)
}

// HasManifest dice se l'unità ha un manifest Python leggibile.
func HasManifest(unitRoot string) bool {
	for _, name := range []string{"pyproject.toml", "setup.cfg", "setup.py", "manage.py"} {
		if isFile(filepath.Join(unitRoot, name)) {
			return true
		}
	}
	return isFile(filepath.Join(unitRoot, "requirements.txt"))
}
