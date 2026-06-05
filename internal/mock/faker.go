package mock

import (
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"strings"
	"sync"
	"time"
)

var (
	fakerMu = sync.Mutex{}
	fakerR  = rand.New(rand.NewSource(time.Now().UnixNano()))
)

var firstNames = []string{"Alice", "Bob", "Carol", "David", "Eve", "Frank", "Grace", "Hank", "Iris", "Jack"}
var lastNames = []string{"Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Wilson", "Taylor"}
var words = []string{"apple", "banana", "cherry", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet"}
var tlds = []string{"com", "org", "net", "io", "dev"}

const maxSchemaDepth = 5

func GenerateFromSchema(schema map[string]interface{}) (string, error) {
	fakerMu.Lock()
	defer fakerMu.Unlock()

	value, err := generateSchemaValue(schema, 0)
	if err != nil {
		return "", err
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func generateSchemaValue(schema map[string]interface{}, depth int) (interface{}, error) {
	if depth > maxSchemaDepth {
		return nil, nil
	}
	if values, ok := schema["enum"].([]interface{}); ok && len(values) > 0 {
		return values[fakerR.Intn(len(values))], nil
	}
	if value, ok := schema["const"]; ok {
		return value, nil
	}

	switch schemaType(schema) {
	case "object":
		return generateSchemaObject(schema, depth)
	case "array":
		return generateSchemaArray(schema, depth)
	case "integer":
		return fakeNumber(schema, true), nil
	case "number":
		return fakeNumber(schema, false), nil
	case "boolean":
		return fakerR.Intn(2) == 1, nil
	case "null":
		return nil, nil
	case "string":
		return fakeString(schema), nil
	default:
		if _, ok := schema["properties"]; ok {
			return generateSchemaObject(schema, depth)
		}
		if _, ok := schema["items"]; ok {
			return generateSchemaArray(schema, depth)
		}
		return fakeString(schema), nil
	}
}

func schemaType(schema map[string]interface{}) string {
	switch raw := schema["type"].(type) {
	case string:
		return raw
	case []interface{}:
		for _, item := range raw {
			if value, ok := item.(string); ok && value != "null" {
				return value
			}
		}
	}
	return ""
}

func generateSchemaObject(schema map[string]interface{}, depth int) (interface{}, error) {
	props, _ := schema["properties"].(map[string]interface{})
	required := requiredSet(schema)
	obj := map[string]interface{}{}

	for key, rawProp := range props {
		prop, ok := rawProp.(map[string]interface{})
		if !ok {
			continue
		}
		if required[key] || fakerR.Intn(2) == 0 {
			value, err := generateSchemaValue(prop, depth+1)
			if err != nil {
				return nil, err
			}
			obj[key] = value
		}
	}
	return obj, nil
}

func requiredSet(schema map[string]interface{}) map[string]bool {
	required := map[string]bool{}
	if items, ok := schema["required"].([]interface{}); ok {
		for _, item := range items {
			if key, ok := item.(string); ok {
				required[key] = true
			}
		}
	}
	return required
}

func generateSchemaArray(schema map[string]interface{}, depth int) (interface{}, error) {
	items, _ := schema["items"].(map[string]interface{})
	minItems := intValue(schema["minItems"], 2)
	maxItems := intValue(schema["maxItems"], 4)
	if minItems > maxItems {
		minItems, maxItems = maxItems, minItems
	}
	if maxItems < 0 {
		maxItems = 0
	}
	count := minItems
	if maxItems > minItems {
		count += fakerR.Intn(maxItems - minItems + 1)
	}

	result := make([]interface{}, 0, count)
	for i := 0; i < count; i++ {
		if items == nil {
			result = append(result, fakeString(map[string]interface{}{}))
			continue
		}
		value, err := generateSchemaValue(items, depth+1)
		if err != nil {
			return nil, err
		}
		result = append(result, value)
	}
	return result, nil
}

func fakeString(schema map[string]interface{}) string {
	switch strings.ToLower(stringValue(schema["format"])) {
	case "email":
		return fakeEmail()
	case "uuid":
		return fakeUUID()
	case "date", "date-time":
		return time.Now().Add(-time.Duration(fakerR.Intn(365*24)) * time.Hour).UTC().Format(time.RFC3339)
	case "uri", "url":
		return fmt.Sprintf("https://example.%s/%s/%d", randChoice(tlds), randChoice(words), fakerR.Intn(1000))
	case "name":
		return randChoice(firstNames) + " " + randChoice(lastNames)
	}

	minLen := intValue(schema["minLength"], 3)
	maxLen := intValue(schema["maxLength"], 20)
	if minLen > maxLen {
		minLen, maxLen = maxLen, minLen
	}
	if minLen < 1 {
		minLen = 1
	}
	length := minLen
	if maxLen > minLen {
		length += fakerR.Intn(maxLen - minLen + 1)
	}
	base := randChoice(words)
	for len(base) < length {
		base += randChoice(words)
	}
	return base[:length]
}

func fakeNumber(schema map[string]interface{}, integer bool) interface{} {
	min := numberValue(schema["minimum"], 0)
	max := numberValue(schema["maximum"], 1000)
	if min > max {
		min, max = max, min
	}
	value := min + fakerR.Float64()*(max-min)
	if integer {
		return int64(math.Round(value))
	}
	return math.Round(value*100) / 100
}

func fakeEmail() string {
	return fmt.Sprintf("%s.%s@example.%s", strings.ToLower(randChoice(firstNames)), strings.ToLower(randChoice(lastNames)), randChoice(tlds))
}

func fakeUUID() string {
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		fakerR.Uint32(),
		fakerR.Uint32()&0xffff,
		(fakerR.Uint32()&0x0fff)|0x4000,
		(fakerR.Uint32()&0x3fff)|0x8000,
		fakerR.Uint64()&0xffffffffffff,
	)
}

func randChoice[T any](items []T) T {
	return items[fakerR.Intn(len(items))]
}

func stringValue(value interface{}) string {
	text, _ := value.(string)
	return text
}

func intValue(value interface{}, fallback int) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	default:
		return fallback
	}
}

func numberValue(value interface{}, fallback float64) float64 {
	switch typed := value.(type) {
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case float64:
		return typed
	default:
		return fallback
	}
}
