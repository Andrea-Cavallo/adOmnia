package java

import (
	"os"
	"strings"
)

// valuesOf legge i valori scritti nei file di configurazione Spring del progetto, con il profilo
// di ciascuno: è ciò che dice quale property è effettivamente in uso.
func valuesOf(configFiles []string) []SpringValue {
	var values []SpringValue
	baseKeys := map[string]bool{}
	for _, path := range configFiles {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		profile := profileOf(fileNameOf(path))
		file := path
		parsed := parseSpringValues(data, file, profile, fileNameOf(path))
		for _, value := range parsed {
			if value.Profile == "" {
				baseKeys[value.Key] = true
			}
		}
		values = append(values, parsed...)
	}
	for index := range values {
		values[index].OverridesBase = values[index].Profile != "" && baseKeys[values[index].Key]
	}
	return values
}

func fileNameOf(path string) string {
	slashed := filepathToSlash(path)
	if cut := strings.LastIndex(slashed, "/"); cut >= 0 {
		return slashed[cut+1:]
	}
	return slashed
}

// parseSpringValues riconosce .properties e .yml/.yaml dal nome del file.
func parseSpringValues(data []byte, file, profile, name string) []SpringValue {
	lower := strings.ToLower(name)
	if strings.HasSuffix(lower, ".properties") {
		return parsePropertyValues(data, file, profile)
	}
	return parseYamlValues(data, file, profile)
}

// parsePropertyValues legge un file in formato .properties: `key=value`, `key:value` o `key value`.
func parsePropertyValues(data []byte, file, profile string) []SpringValue {
	var values []SpringValue
	lines := strings.Split(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n")
	var pending strings.Builder
	pendingLine := 0
	for index, raw := range lines {
		line := strings.TrimRight(raw, " \t\r")
		if pending.Len() > 0 {
			pending.WriteString(strings.TrimLeft(line, " \t"))
			if strings.HasSuffix(line, "\\") && len(line) > 1 {
				pending.WriteString("\n")
				continue
			}
			values = append(values, propertyLineValue(pending.String(), file, profile, pendingLine)...)
			pending.Reset()
			continue
		}
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, "!") {
			continue
		}
		if strings.HasSuffix(line, "\\") && len(line) > 1 {
			pending.WriteString(strings.TrimSuffix(strings.TrimLeft(line, " \t"), "\\"))
			pendingLine = index + 1
			continue
		}
		values = append(values, propertyLineValue(line, file, profile, index+1)...)
	}
	if pending.Len() > 0 {
		values = append(values, propertyLineValue(pending.String(), file, profile, pendingLine)...)
	}
	return values
}

// propertyLineValue estrae chiave e valore da una riga di un .properties.
func propertyLineValue(line, file, profile string, lineNumber int) []SpringValue {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return nil
	}
	separator := strings.IndexAny(trimmed, "=:")
	if separator < 0 {
		separator = strings.IndexAny(trimmed, " \t")
	}
	if separator <= 0 {
		return nil
	}
	key := strings.TrimSpace(trimmed[:separator])
	value := strings.TrimSpace(trimmed[separator+1:])
	startColumn := strings.Index(line, key) + 1
	return []SpringValue{{
		Key: key, Value: unquote(value), Profile: profile, File: file, Line: lineNumber,
		StartColumn: startColumn, EndColumn: startColumn + len([]rune(key)),
	}}
}

// parseYamlValues legge un .yml/.yaml a livelli di indentazione. Ogni documento separato da `---`
// può dichiarare il suo profilo con `spring.config.activate.on-profile`.
func parseYamlValues(data []byte, file, profile string) []SpringValue {
	var values []SpringValue
	text := strings.ReplaceAll(string(data), "\r\n", "\n")
	for _, document := range splitYamlDocuments(text) {
		documentProfile := profile
		if declared := yamlProfileOf(document.lines); declared != "" {
			documentProfile = declared
		}
		values = append(values, parseYamlDocument(document.lines, file, documentProfile)...)
	}
	return values
}

type yamlDocument struct {
	lines []string
}

// splitYamlDocuments divide un file YAML nei documenti separati da `---`.
func splitYamlDocuments(text string) []yamlDocument {
	var documents []yamlDocument
	var current []string
	for _, line := range strings.Split(text, "\n") {
		if strings.TrimSpace(line) == "---" {
			if len(current) > 0 {
				documents = append(documents, yamlDocument{lines: current})
			}
			current = nil
			continue
		}
		current = append(current, line)
	}
	if len(current) > 0 {
		documents = append(documents, yamlDocument{lines: current})
	}
	return documents
}

// yamlProfileOf è il profilo dichiarato da un documento YAML (`on-profile: prod`).
func yamlProfileOf(lines []string) string {
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "#") {
			continue
		}
		if strings.HasPrefix(trimmed, "on-profile:") || strings.HasSuffix(strings.TrimSpace(strings.SplitN(trimmed, ":", 2)[0]), "on-profile") {
			value := strings.TrimSpace(strings.SplitN(trimmed, ":", 2)[1])
			return strings.Trim(value, `"'`)
		}
	}
	return ""
}

// parseYamlDocument converte i livelli di indentazione in chiavi separate da punti.
func parseYamlDocument(lines []string, file, profile string) []SpringValue {
	var values []SpringValue
	type level struct {
		key string
		indent int
	}
	var stack []level
	for index, raw := range lines {
		if strings.TrimSpace(raw) == "" || strings.HasPrefix(strings.TrimSpace(raw), "#") {
			continue
		}
		indent := countIndent(raw)
		trimmed := strings.TrimSpace(raw)
		cut := strings.Index(trimmed, ":")
		if cut < 0 {
			continue
		}
		key := strings.TrimSpace(trimmed[:cut])
		value := strings.TrimSpace(trimmed[cut+1:])
		for len(stack) > 0 && stack[len(stack)-1].indent >= indent {
			stack = stack[:len(stack)-1]
		}
		path := key
		if len(stack) > 0 {
			path = stack[len(stack)-1].key + "." + key
		}
		if value == "" {
			stack = append(stack, level{key: path, indent: indent})
			continue
		}
		// I valori multilinea (`|`, `>`) non hanno un valore scalare da indicizzare.
		if value == "|" || value == ">" || value == "|-" || value == ">-" {
			stack = append(stack, level{key: path, indent: indent})
			continue
		}
		if isActivationKey(path) {
			continue
		}
		startColumn := strings.Index(raw, key) + 1
		values = append(values, SpringValue{
			Key: path, Value: strings.Trim(unquote(value), "[]"), Profile: profile, File: file, Line: index + 1,
			StartColumn: startColumn, EndColumn: startColumn + len([]rune(key)),
		})
	}
	return values
}

func countIndent(line string) int {
	count := 0
	for _, char := range line {
		if char != ' ' && char != '\t' {
			break
		}
		count++
	}
	return count
}

// isActivationKey è true per le chiavi che attivano un profilo: non sono proprietà dell'applicazione.
func isActivationKey(path string) bool {
	return path == "spring.config.activate.on-profile" || path == "spring.profiles" ||
		strings.HasPrefix(path, "spring.config.activate.") || strings.HasPrefix(path, "spring.profiles.")
}
