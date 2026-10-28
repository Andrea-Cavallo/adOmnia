// Package toml legge il sottoinsieme di TOML usato dai manifest dei progetti (pyproject.toml,
// Cargo.toml): tabelle, chiavi punteggiate, stringhe (anche multilinea), numeri, booleani, date,
// array e tabelle inline. Le righe che non si interpretano vengono ignorate: un manifest
// malformato non deve bloccare le altre unità. È una lettura dichiarativa: non esegue mai codice
// del progetto. Estratto da internal/languages/python (primo consumatore) quando Rust è diventato
// il secondo (RS-1.2): i due adapter condividono questo parser invece di duplicarlo.
package toml

import (
	"strings"
)

// Parse legge un documento TOML in una struttura map[string]any. Non restituisce mai errori: un
// manifest malformato produce il sottoinsieme che si è riusciti a leggere.
func Parse(data []byte) map[string]any {
	root := map[string]any{}
	table := root
	lines := strings.Split(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n")
	for index := 0; index < len(lines); index++ {
		line := strings.TrimSpace(stripComment(lines[index]))
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "[[") {
			if end := strings.Index(line, "]]"); end > 2 {
				table = arrayTable(root, splitKeyPath(line[2:end]))
			}
			continue
		}
		if strings.HasPrefix(line, "[") {
			if end := strings.LastIndex(line, "]"); end > 1 {
				table = tableAt(root, splitKeyPath(line[1:end]))
			}
			continue
		}
		key, raw, ok := cutAssignment(line)
		if !ok {
			continue
		}
		value, rest, ok := parseValue(raw, lines, &index)
		if !ok || strings.TrimSpace(rest) != "" {
			continue
		}
		assign(table, splitKeyPath(key), value)
	}
	return root
}

// stripComment toglie il commento finale rispettando le stringhe.
func stripComment(line string) string {
	inString, quote := false, byte(0)
	for i := 0; i < len(line); i++ {
		char := line[i]
		switch {
		case inString && char == quote:
			inString = false
		case inString:
		case char == '"' || char == '\'':
			inString, quote = true, char
		case char == '#':
			return line[:i]
		}
	}
	return line
}

// splitKeyPath spezza `tool.pytest.ini_options` nelle sue parti.
func splitKeyPath(key string) []string {
	var parts []string
	for part := range strings.SplitSeq(key, ".") {
		part = strings.Trim(strings.TrimSpace(part), `"'`)
		if part != "" {
			parts = append(parts, part)
		}
	}
	return parts
}

// cutAssignment separa la chiave dal valore su `=`, rispettando le stringhe nella chiave.
func cutAssignment(line string) (string, string, bool) {
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

// parseValue interpreta un valore TOML. I valori multilinea consumano le righe successive
// aggiornando index; il resto della riga viene restituito per rilevare syntax error.
func parseValue(raw string, lines []string, index *int) (any, string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, "", false
	}
	for _, marker := range []string{`"""`, `'''`} {
		if after, ok := strings.CutPrefix(raw, marker); ok {
			text := after
			if before, after, ok := strings.Cut(text, marker); ok {
				return before, after, true
			}
			var builder strings.Builder
			builder.WriteString(text)
			for *index+1 < len(lines) {
				*index++
				next := strings.ReplaceAll(lines[*index], "\r", "")
				if before, after, ok := strings.Cut(next, marker); ok {
					builder.WriteString("\n")
					builder.WriteString(before)
					return builder.String(), after, true
				}
				builder.WriteString("\n")
				builder.WriteString(next)
			}
			return nil, "", false
		}
	}
	switch raw[0] {
	case '"', '\'':
		quote := raw[0]
		for i := 1; i < len(raw); i++ {
			if raw[i] == '\\' && quote == '"' {
				i++
				continue
			}
			if raw[i] == quote {
				return unquote(raw[1:i]), raw[i+1:], true
			}
		}
		return nil, "", false
	case '[':
		return parseArray(raw, lines, index)
	case '{':
		return parseInlineTable(raw, lines, index)
	}
	token := raw
	if space := strings.IndexAny(token, " \t#"); space >= 0 {
		token, raw = token[:space], raw[space:]
	} else {
		raw = ""
	}
	switch token {
	case "true", "false":
		return token == "true", raw, true
	}
	if isNumber(token) {
		return token, raw, true
	}
	return nil, "", false
}

// isNumber accetta interi, float, date e orari scritti senza trattini/due punti estranei.
func isNumber(token string) bool {
	if token == "" {
		return false
	}
	for i := 0; i < len(token); i++ {
		char := token[i]
		if char >= '0' && char <= '9' || char == '.' || char == '-' || char == '+' || char == ':' ||
			char == '_' || char == 'T' || char == 'Z' || char >= 'a' && char <= 'f' || char >= 'A' && char <= 'F' {
			continue
		}
		return false
	}
	return strings.ContainsAny(token, "0123456789")
}

// parseArray legge un array inline, anche su più righe.
func parseArray(raw string, lines []string, index *int) (any, string, bool) {
	items := []any{}
	text := strings.TrimPrefix(raw, "[")
	for {
		for {
			text = strings.TrimSpace(text)
			if text == "" || strings.HasPrefix(text, "#") {
				break
			}
			if after, ok := strings.CutPrefix(text, "]"); ok {
				return items, after, true
			}
			value, rest, ok := parseValue(text, lines, index)
			if !ok {
				return nil, "", false
			}
			items = append(items, value)
			text = strings.TrimPrefix(strings.TrimSpace(rest), ",")
		}
		if *index+1 >= len(lines) {
			return nil, "", false
		}
		*index++
		text = stripComment(strings.ReplaceAll(lines[*index], "\r", ""))
	}
}

// parseInlineTable legge `{ chiave = valore, ... }` su una sola riga.
func parseInlineTable(raw string, _ []string, _ *int) (any, string, bool) {
	end := strings.LastIndex(raw, "}")
	if end < 0 {
		return nil, "", false
	}
	table := map[string]any{}
	for entry := range strings.SplitSeq(raw[1:end], ",") {
		key, value, ok := cutAssignment(strings.TrimSpace(entry))
		if !ok {
			continue
		}
		if parsed, rest, ok := parseValue(value, nil, new(int)); ok && strings.TrimSpace(rest) == "" {
			assign(table, splitKeyPath(key), parsed)
		}
	}
	return table, raw[end+1:], true
}

// unquote decodifica le sequenze di escape più comuni delle stringhe base.
func unquote(text string) string {
	if !strings.Contains(text, `\`) {
		return text
	}
	var builder strings.Builder
	for i := 0; i < len(text); i++ {
		if text[i] != '\\' || i+1 >= len(text) {
			builder.WriteByte(text[i])
			continue
		}
		i++
		switch text[i] {
		case 'n':
			builder.WriteByte('\n')
		case 't':
			builder.WriteByte('\t')
		case 'r':
			builder.WriteByte('\r')
		case '\\':
			builder.WriteByte('\\')
		case '"':
			builder.WriteByte('"')
		default:
			builder.WriteByte('\\')
			builder.WriteByte(text[i])
		}
	}
	return builder.String()
}

// assign scrive value nel percorso di tabelle indicato, creando le tabelle mancanti.
func assign(table map[string]any, path []string, value any) {
	for len(path) > 1 {
		child, ok := table[path[0]].(map[string]any)
		if !ok {
			child = map[string]any{}
			table[path[0]] = child
		}
		table, path = child, path[1:]
	}
	if len(path) == 1 {
		table[path[0]] = value
	}
}

// tableAt raggiunge la tabella del percorso, creandola.
func tableAt(root map[string]any, path []string) map[string]any {
	table := root
	for _, part := range path {
		child, ok := table[part].(map[string]any)
		if !ok {
			child = map[string]any{}
			table[part] = child
		}
		table = child
	}
	return table
}

// arrayTable raggiunge l'ultima tabella di un `[[...]]`, aggiungendone una nuova.
func arrayTable(root map[string]any, path []string) map[string]any {
	table := root
	for _, part := range path[:len(path)-1] {
		child, ok := table[part].(map[string]any)
		if !ok {
			child = map[string]any{}
			table[part] = child
		}
		table = child
	}
	last := path[len(path)-1]
	list, _ := table[last].([]map[string]any)
	entry := map[string]any{}
	table[last] = append(list, entry)
	return entry
}

// Value cammina il percorso nel documento TOML e restituisce il valore grezzo (nil se manca).
func Value(table map[string]any, path ...string) any {
	current := any(table)
	for _, part := range path {
		child, ok := current.(map[string]any)
		if !ok {
			return nil
		}
		current = child[part]
	}
	return current
}

// String legge una stringa dal documento; "" se la chiave manca o non è una stringa.
func String(table map[string]any, path ...string) string {
	text, _ := Value(table, path...).(string)
	return text
}

// Strings legge un array di stringhe dal documento.
func Strings(table map[string]any, path ...string) []string {
	value := Value(table, path...)
	list, ok := value.([]any)
	if !ok {
		return nil
	}
	var result []string
	for _, item := range list {
		if text, ok := item.(string); ok {
			result = append(result, text)
		}
	}
	return result
}

// Table legge una tabella annidata dal documento (nil se manca).
func Table(table map[string]any, path ...string) map[string]any {
	child, _ := Value(table, path...).(map[string]any)
	return child
}

// Tables legge un array di tabelle (`[[...]]`) dal documento (nil se manca).
func Tables(table map[string]any, path ...string) []map[string]any {
	value := Value(table, path...)
	if list, ok := value.([]map[string]any); ok {
		return list
	}
	list, ok := value.([]any)
	if !ok {
		return nil
	}
	result := make([]map[string]any, 0, len(list))
	for _, item := range list {
		if child, ok := item.(map[string]any); ok {
			result = append(result, child)
		}
	}
	return result
}
