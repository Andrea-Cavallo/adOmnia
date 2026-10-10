package collab

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// environmentPayload excludes private environments at the authoritative origin.
// Explicit opt-in applies only to a top-level environment variable's plain value.
// Vault references are never resolved or allowed across the network.
func environmentPayload(data json.RawMessage, selected []string) (json.RawMessage, map[string]string, error) {
	if len(selected) > 64 {
		return nil, nil, errors.New("troppi segreti selezionati")
	}
	var envs []map[string]any
	if err := json.Unmarshal(data, &envs); err != nil || envs == nil {
		return nil, nil, errors.New("environment non validi")
	}
	allowed := map[string]bool{}
	for _, id := range selected {
		if id == "" {
			return nil, nil, errors.New("ID di variabile non valido")
		}
		allowed[id] = true
	}
	values := map[string]string{}
	seen := map[string]bool{}
	public := make([]map[string]any, 0, len(envs))
	for _, env := range envs {
		if env["private"] == true {
			continue
		}
		variables, _ := env["variables"].([]any)
		for _, value := range variables {
			row, ok := value.(map[string]any)
			if !ok {
				continue
			}
			id, _ := row["id"].(string)
			if id != "" && seen[id] {
				return nil, nil, errors.New("ID di variabile duplicato")
			}
			seen[id] = true
			plain, _ := row["value"].(string)
			if allowed[id] && isSecretRow(row) && plain != redactedValue && !strings.HasPrefix(plain, "vault:") {
				if _, duplicate := values[id]; duplicate {
					return nil, nil, errors.New("ID di variabile segreta duplicato")
				}
				values[id] = plain
			}
		}
		public = append(public, env)
	}
	out, err := json.Marshal(public)
	return out, values, err
}

func restoreSelectedVariables(data json.RawMessage, values map[string]string, redacted []string) (json.RawMessage, []string) {
	if len(values) == 0 {
		return data, redacted
	}
	var envs []map[string]any
	if json.Unmarshal(data, &envs) != nil {
		return data, redacted
	}
	for i, env := range envs {
		variables, _ := env["variables"].([]any)
		for j, value := range variables {
			row, ok := value.(map[string]any)
			if !ok {
				continue
			}
			id, _ := row["id"].(string)
			if plain, ok := values[id]; ok {
				row["value"] = plain
				prefix := fmt.Sprintf("$[%d].variables[%d].", i, j)
				filtered := redacted[:0]
				for _, path := range redacted {
					if path != prefix+rowName(row) && path != prefix+"value" {
						filtered = append(filtered, path)
					}
				}
				redacted = filtered
			}
		}
	}
	out, _ := json.Marshal(envs)
	return out, redacted
}
