package apicontract

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// EventShape è il tipo di un messaggio che una funzione produce o consuma su un topic.
type EventShape struct {
	Topic    string  `json:"topic"`
	Broker   string  `json:"broker"`
	Role     string  `json:"role"` // producer | consumer
	Function string  `json:"function"`
	Schema   string  `json:"schema,omitempty"`
	Fields   []Field `json:"fields,omitempty"`
	File     string  `json:"file,omitempty"`
	Line     int     `json:"line,omitempty"`
}

// EventSchema è uno schema dichiarato nel progetto (Avro .avsc o JSON Schema).
type EventSchema struct {
	Name   string  `json:"name"`
	File   string  `json:"file"`
	Fields []Field `json:"fields"`
}

func byTopic(shapes []EventShape) map[string][]EventShape {
	out := map[string][]EventShape{}
	for _, shape := range shapes {
		if len(shape.Fields) > 0 {
			out[shape.Broker+":"+shape.Topic] = append(out[shape.Broker+":"+shape.Topic], shape)
		}
	}
	return out
}

func sortedTopics(topics map[string][]EventShape) []string {
	keys := make([]string, 0, len(topics))
	for key := range topics {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

// CompareEvents: per ogni topic, i campi che un consumer si aspetta e nessun producer invia
// (missing), e i tipi diversi fra producer e consumer (type mismatch).
func CompareEvents(shapes []EventShape) []Issue {
	issues := []Issue{}
	topics := byTopic(shapes)
	for _, key := range sortedTopics(topics) {
		var producers, consumers []EventShape
		for _, shape := range topics[key] {
			if shape.Role == "producer" {
				producers = append(producers, shape)
			} else {
				consumers = append(consumers, shape)
			}
		}
		for _, producer := range producers {
			sent := map[string]Field{}
			for _, field := range producer.Fields {
				sent[field.Name] = field
			}
			for _, consumer := range consumers {
				for _, field := range consumer.Fields {
					was, ok := sent[field.Name]
					topic := strings.SplitN(key, ":", 2)[1]
					switch {
					case !ok:
						issues = append(issues, Issue{Kind: "event-missing-field", Operation: topic, Field: field.Name, Message: fmt.Sprintf("%s: %s reads field %q that %s never sends (it stays the zero value)", topic, consumer.Function, field.Name, producer.Function), File: consumer.File, Line: consumer.Line})
					case was.Type != "" && field.Type != "" && was.Type != field.Type:
						issues = append(issues, Issue{Kind: "event-type-mismatch", Operation: topic, Field: field.Name, Message: fmt.Sprintf("%s: field %q is %s in %s but %s in %s (decoding fails)", topic, field.Name, was.Type, producer.Function, field.Type, consumer.Function), Breaking: true, File: consumer.File, Line: consumer.Line})
					}
				}
			}
		}
	}
	return issues
}

// FindEventSchemas legge gli schemi Avro (.avsc) e JSON Schema (*.schema.json) del progetto.
func FindEventSchemas(root string) []EventSchema {
	var schemas []EventSchema
	_ = filepath.WalkDir(root, func(full string, entry os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		rel, _ := filepath.Rel(root, full)
		rel = filepath.ToSlash(rel)
		if entry.IsDir() {
			if rel != "." && (strings.HasPrefix(entry.Name(), ".") || entry.Name() == "vendor" || entry.Name() == "node_modules" || strings.Count(rel, "/") >= 4) {
				return filepath.SkipDir
			}
			return nil
		}
		name := strings.ToLower(entry.Name())
		if !strings.HasSuffix(name, ".avsc") && !strings.HasSuffix(name, ".schema.json") {
			return nil
		}
		data, err := os.ReadFile(full)
		if err != nil {
			return nil
		}
		var document map[string]any
		if json.Unmarshal(data, &document) != nil {
			return nil
		}
		if schema, ok := parseEventSchema(rel, document); ok {
			schemas = append(schemas, schema)
		}
		return nil
	})
	return schemas
}

func parseEventSchema(file string, document map[string]any) (EventSchema, bool) {
	if fields, ok := document["fields"].([]any); ok { // Avro record
		name, _ := document["name"].(string)
		schema := EventSchema{Name: name, File: file}
		for _, raw := range fields {
			field, _ := raw.(map[string]any)
			fieldName, _ := field["name"].(string)
			kind, optional := avroType(field["type"])
			schema.Fields = append(schema.Fields, Field{Name: fieldName, Type: kind, Required: !optional && field["default"] == nil})
		}
		return schema, true
	}
	if properties, ok := document["properties"].(map[string]any); ok { // JSON Schema
		name, _ := document["title"].(string)
		if name == "" {
			name = strings.TrimSuffix(filepath.Base(file), ".schema.json")
		}
		return EventSchema{Name: name, File: file, Fields: schemaFields(map[string]any{"properties": properties, "required": document["required"]})}, true
	}
	return EventSchema{}, false
}

// avroType riduce un tipo Avro ai tipi JSON usati dai DTO; ["null", T] è T opzionale.
func avroType(raw any) (string, bool) {
	switch value := raw.(type) {
	case string:
		switch value {
		case "int", "long":
			return "integer", false
		case "float", "double":
			return "number", false
		case "boolean":
			return "boolean", false
		case "string", "bytes":
			return "string", false
		case "null":
			return "", true
		}
		return "object", false
	case []any:
		kind, optional := "", false
		for _, member := range value {
			memberKind, isNull := avroType(member)
			if isNull {
				optional = true
			} else if kind == "" {
				kind = memberKind
			}
		}
		return kind, optional
	case map[string]any:
		switch value["type"] {
		case "array":
			return "array", false
		case "map", "record":
			return "object", false
		}
		if logical, _ := value["logicalType"].(string); logical != "" {
			kind, _ := avroType(value["type"])
			return kind, false
		}
		kind, _ := avroType(value["type"])
		return kind, false
	}
	return "", false
}

// CompareEventSchemas confronta il tipo Go di ogni evento con lo schema dichiarato che ha lo
// stesso nome dello struct o del topic.
func CompareEventSchemas(shapes []EventShape, schemas []EventSchema) []Issue {
	issues := []Issue{}
	find := func(shape EventShape) (EventSchema, bool) {
		for _, schema := range schemas {
			name := strings.ToLower(schema.Name)
			if name != "" && (name == strings.ToLower(shape.Schema) || name == strings.ToLower(shape.Topic) || strings.Contains(strings.ToLower(schema.File), strings.ToLower(shape.Topic))) {
				return schema, true
			}
		}
		return EventSchema{}, false
	}
	seen := map[string]bool{}
	for _, shape := range shapes {
		schema, ok := find(shape)
		if !ok || len(shape.Fields) == 0 || seen[shape.Function+schema.File] {
			continue
		}
		seen[shape.Function+schema.File] = true
		declared := map[string]Field{}
		for _, field := range schema.Fields {
			declared[field.Name] = field
		}
		present := map[string]bool{}
		for _, field := range shape.Fields {
			present[field.Name] = true
			want, ok := declared[field.Name]
			switch {
			case !ok:
				issues = append(issues, Issue{Kind: "schema-missing-field", Operation: shape.Topic, Field: field.Name, Message: fmt.Sprintf("%s: %s field %q is not in %s", shape.Topic, shape.Schema, field.Name, schema.File), File: shape.File, Line: shape.Line})
			case want.Type != "" && field.Type != "" && want.Type != field.Type:
				issues = append(issues, Issue{Kind: "schema-type-mismatch", Operation: shape.Topic, Field: field.Name, Message: fmt.Sprintf("%s: field %q is %s in Go but %s in %s", shape.Topic, field.Name, field.Type, want.Type, schema.File), Breaking: true, File: shape.File, Line: shape.Line})
			}
		}
		for _, field := range schema.Fields {
			if !present[field.Name] && field.Required {
				issues = append(issues, Issue{Kind: "schema-missing-in-code", Operation: shape.Topic, Field: field.Name, Message: fmt.Sprintf("%s: %s requires field %q that %s does not have", shape.Topic, schema.File, field.Name, shape.Schema), File: shape.File, Line: shape.Line})
			}
		}
	}
	return issues
}

// CompareEventRevisions: come sono cambiati i messaggi prodotti fra base e head. Togliere o
// cambiare tipo a un campo rompe i consumer non ancora aggiornati.
func CompareEventRevisions(base, head []EventShape) []Issue {
	issues := []Issue{}
	produced := func(shapes []EventShape) map[string]EventShape {
		out := map[string]EventShape{}
		for _, shape := range shapes {
			if shape.Role == "producer" && len(shape.Fields) > 0 {
				out[shape.Broker+":"+shape.Topic] = shape
			}
		}
		return out
	}
	before, after := produced(base), produced(head)
	keys := make([]string, 0, len(after))
	for key := range after {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		old, ok := before[key]
		if !ok {
			continue
		}
		for _, issue := range fieldChanges(after[key].Topic, "event", old.Fields, after[key].Fields, Operation{File: after[key].File, Line: after[key].Line}) {
			issue.Breaking = issue.Kind == "removed-field" || issue.Kind == "type-changed"
			issue.Message = strings.Replace(issue.Message, " event ", " message ", 1)
			issues = append(issues, issue)
		}
	}
	return issues
}
