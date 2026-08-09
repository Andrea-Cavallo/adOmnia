package storage

import (
	"encoding/json"
	"net/url"
	"regexp"
	"strings"
)

const redactedSecret = "***REDACTED***"

var (
	sensitiveStorageKey = regexp.MustCompile(`(?i)(password|passwd|passphrase|token|secret|api[-_]?key|authorization|cookie|private[-_]?key|access[-_]?key)`)
	embeddedCredentials = regexp.MustCompile(`^[^\s:@/]+:[^\s@/]+@(?:tcp\()?`)
)

func isProtectedSecret(value string) bool {
	return value == "" || strings.HasPrefix(strings.TrimSpace(value), "vault:")
}

func hasEmbeddedCredentials(value string) bool {
	trimmed := strings.TrimSpace(value)
	if parsed, err := url.Parse(trimmed); err == nil && parsed.User != nil {
		if parsed.User.Username() != "" {
			return true
		}
		if _, ok := parsed.User.Password(); ok {
			return true
		}
	}
	return embeddedCredentials.MatchString(trimmed)
}

func redactString(key, value string) string {
	if isProtectedSecret(value) {
		return value
	}
	if sensitiveStorageKey.MatchString(key) {
		return redactedSecret
	}
	if (strings.EqualFold(key, "dsn") || strings.EqualFold(key, "url")) && hasEmbeddedCredentials(value) {
		return redactedSecret
	}
	return value
}

func redactJSONValue(value any, key string) any {
	switch typed := value.(type) {
	case map[string]any:
		secretValue := false
		if kind, ok := typed["type"].(string); ok && strings.EqualFold(kind, "secret") {
			secretValue = true
		}
		for _, nameKey := range []string{"key", "name", "header"} {
			if name, ok := typed[nameKey].(string); ok && sensitiveStorageKey.MatchString(name) {
				secretValue = true
			}
		}
		result := make(map[string]any, len(typed))
		for childKey, child := range typed {
			if secretValue && strings.EqualFold(childKey, "value") {
				if text, ok := child.(string); ok && !isProtectedSecret(text) {
					result[childKey] = redactedSecret
					continue
				}
			}
			result[childKey] = redactJSONValue(child, childKey)
		}
		return result
	case []any:
		result := make([]any, len(typed))
		for index, child := range typed {
			result[index] = redactJSONValue(child, key)
		}
		return result
	case string:
		return redactString(key, typed)
	default:
		return value
	}
}

// RedactValueForExport removes plaintext credentials from an arbitrary stored
// JSON value while preserving encrypted vault: references. Stored data itself
// is not mutated; redaction applies only to shareable exports and snapshots.
func RedactValueForExport(raw []byte) string {
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return redactString("", string(raw))
	}
	redacted := redactJSONValue(value, "")
	encoded, err := json.Marshal(redacted)
	if err != nil {
		return redactedSecret
	}
	return string(encoded)
}
