package collab

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
)

const redactedValue = "***REDACTED***"

// secretKey rispecchia SECRET_KEY di frontend/src/lib/interopHub.ts.
var secretKey = regexp.MustCompile(`(?i)(authorization|token|secret|password|passwd|apikey|api_key|client_secret|cookie|set-cookie|private[_-]?key)`)

// Redact rimuove i segreti da un payload JSON prima che lasci l'host.
// Copre: campi con nome sensibile, righe {key|name, value} con chiave sensibile,
// variabili marcate secret (secret:true o type:"secret") e riferimenti `vault:`.
// Restituisce i path redatti per la preview.
func Redact(data json.RawMessage) (json.RawMessage, []string, error) {
	var root any
	if err := json.Unmarshal(data, &root); err != nil {
		return nil, nil, err
	}
	var paths []string
	root = redactValue(root, "", "$", &paths)
	out, err := json.Marshal(root)
	return out, paths, err
}

func redactValue(value any, key, path string, paths *[]string) any {
	switch v := value.(type) {
	case string:
		if v == "" {
			return v
		}
		if secretKey.MatchString(key) || strings.HasPrefix(v, "vault:") {
			*paths = append(*paths, path)
			return redactedValue
		}
		return v
	case []any:
		for i := range v {
			v[i] = redactValue(v[i], key, path+"["+strconv.Itoa(i)+"]", paths)
		}
		return v
	case map[string]any:
		if isSecretRow(v) {
			if s, ok := v["value"].(string); ok && s != "" {
				v["value"] = redactedValue
				*paths = append(*paths, path+"."+rowName(v))
			}
		}
		for k, child := range v {
			if k == "value" && v["value"] == redactedValue {
				continue
			}
			v[k] = redactValue(child, k, path+"."+k, paths)
		}
		return v
	}
	return value
}

func isSecretRow(row map[string]any) bool {
	if row["secret"] == true || row["type"] == "secret" {
		return true
	}
	return secretKey.MatchString(rowName(row))
}

func rowName(row map[string]any) string {
	for _, k := range []string{"key", "name"} {
		if s, ok := row[k].(string); ok && s != "" {
			return s
		}
	}
	return ""
}
