// Package apicontract confronta l'API che il codice espone con il suo contratto OpenAPI e con
// l'API di un'altra revisione. Il modello è neutro: un adapter di linguaggio lo produce dal codice.
package apicontract

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

// Field è un campo JSON di un corpo; Ref è il nome dello schema annidato, se c'è.
type Field struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Ref      string `json:"ref,omitempty"`
	Required bool   `json:"required,omitzero"`
}

// Body è il corpo di una richiesta o risposta.
type Body struct {
	Schema string  `json:"schema,omitempty"`
	Array  bool    `json:"array,omitzero"`
	Fields []Field `json:"fields,omitempty"`
}

// Operation è una route: METHOD /path con i corpi riconosciuti.
type Operation struct {
	Method   string `json:"method"`
	Path     string `json:"path"`
	Request  *Body  `json:"request,omitempty"`
	Response *Body  `json:"response,omitempty"`
	File     string `json:"file,omitempty"`
	Line     int    `json:"line,omitzero"`
}

// Key è l'identità di un'operazione: metodo e path con i parametri normalizzati.
func (o Operation) Key() string {
	return strings.ToUpper(o.Method) + " " + normalizePath(o.Path)
}

var pathParam = regexp.MustCompile(`\{[^}]*\}|:[A-Za-z_]\w*`)

func normalizePath(path string) string {
	path = pathParam.ReplaceAllString(path, "{}")
	if trimmed := strings.TrimRight(path, "/"); trimmed != "" {
		return trimmed
	}
	return "/"
}

// Issue è una differenza fra codice e contratto o fra due revisioni.
type Issue struct {
	Kind      string `json:"kind"` // undocumented | unimplemented | field-missing-in-contract | field-missing-in-code | type-mismatch | required-mismatch | removed-operation | added-operation | removed-field | added-field | type-changed | became-required
	Operation string `json:"operation"`
	Side      string `json:"side,omitempty"` // request | response
	Field     string `json:"field,omitempty"`
	Message   string `json:"message"`
	Breaking  bool   `json:"breaking,omitzero"`
	File      string `json:"file,omitempty"`
	Line      int    `json:"line,omitzero"`
}

// --- OpenAPI -------------------------------------------------------------------------------

// Contract è un documento OpenAPI 3 o Swagger 2 ridotto a operazioni e corpi.
type Contract struct {
	File       string
	Operations map[string]Operation
}

var contractNames = regexp.MustCompile(`(?i)^(openapi|swagger|api)([._-][\w.-]*)?\.(ya?ml|json)$`)

// FindContract cerca il primo file OpenAPI del progetto (fino a 3 livelli, senza vendor e simili).
func FindContract(root string) string {
	found := ""
	_ = filepath.WalkDir(root, func(full string, entry os.DirEntry, err error) error {
		if err != nil || found != "" {
			return nil
		}
		rel, _ := filepath.Rel(root, full)
		rel = filepath.ToSlash(rel)
		if entry.IsDir() {
			if rel != "." && (strings.HasPrefix(entry.Name(), ".") || entry.Name() == "vendor" || entry.Name() == "node_modules" || strings.Count(rel, "/") >= 3) {
				return filepath.SkipDir
			}
			return nil
		}
		if contractNames.MatchString(entry.Name()) {
			if data, err := os.ReadFile(full); err == nil && (strings.Contains(string(data), "openapi") || strings.Contains(string(data), "swagger")) && strings.Contains(string(data), "paths") {
				found = rel
			}
		}
		return nil
	})
	return found
}

// ParseContract legge YAML o JSON (JSON è YAML valido).
func ParseContract(file string, data []byte) (Contract, error) {
	var document map[string]any
	if err := yaml.Unmarshal(data, &document); err != nil {
		return Contract{}, fmt.Errorf("%s: %w", file, err)
	}
	contract := Contract{File: file, Operations: map[string]Operation{}}
	schemas := map[string]any{}
	if components, ok := document["components"].(map[string]any); ok {
		if found, ok := components["schemas"].(map[string]any); ok {
			schemas = found
		}
	}
	if definitions, ok := document["definitions"].(map[string]any); ok { // Swagger 2
		schemas = definitions
	}
	paths, _ := document["paths"].(map[string]any)
	for path, raw := range paths {
		item, _ := raw.(map[string]any)
		for method, rawOperation := range item {
			upper := strings.ToUpper(method)
			if !isMethod(upper) {
				continue
			}
			operation := Operation{Method: upper, Path: path}
			spec, _ := rawOperation.(map[string]any)
			operation.Request = requestBody(spec, schemas)
			operation.Response = responseBody(spec, schemas)
			contract.Operations[operation.Key()] = operation
		}
	}
	return contract, nil
}

func isMethod(method string) bool {
	switch method {
	case "GET", "PUT", "POST", "DELETE", "PATCH", "HEAD", "OPTIONS", "TRACE", "QUERY":
		return true
	}
	return false
}

func requestBody(spec map[string]any, schemas map[string]any) *Body {
	if body, ok := spec["requestBody"].(map[string]any); ok { // OpenAPI 3
		return mediaBody(body, schemas)
	}
	parameters, _ := spec["parameters"].([]any) // Swagger 2: parametro "in: body"
	for _, raw := range parameters {
		if parameter, ok := raw.(map[string]any); ok && parameter["in"] == "body" {
			return schemaBody(parameter["schema"], schemas)
		}
	}
	return nil
}

func responseBody(spec map[string]any, schemas map[string]any) *Body {
	responses, _ := spec["responses"].(map[string]any)
	codes := make([]string, 0, len(responses))
	for code := range responses {
		if strings.HasPrefix(code, "2") {
			codes = append(codes, code)
		}
	}
	sort.Strings(codes)
	for _, code := range codes {
		response, _ := responses[code].(map[string]any)
		if body := mediaBody(response, schemas); body != nil {
			return body
		}
		if schema, ok := response["schema"]; ok { // Swagger 2
			return schemaBody(schema, schemas)
		}
	}
	return nil
}

func mediaBody(holder map[string]any, schemas map[string]any) *Body {
	content, _ := holder["content"].(map[string]any)
	for media, raw := range content {
		if strings.Contains(media, "json") {
			if spec, ok := raw.(map[string]any); ok {
				return schemaBody(spec["schema"], schemas)
			}
		}
	}
	return nil
}

func refName(schema map[string]any) string {
	ref, _ := schema["$ref"].(string)
	return ref[strings.LastIndex(ref, "/")+1:]
}

func schemaBody(raw any, schemas map[string]any) *Body {
	schema, ok := raw.(map[string]any)
	if !ok {
		return nil
	}
	body := &Body{}
	if schema["type"] == "array" {
		body.Array = true
		schema, _ = schema["items"].(map[string]any)
	}
	if name := refName(schema); name != "" {
		body.Schema = name
		schema, _ = schemas[name].(map[string]any)
	}
	body.Fields = schemaFields(schema)
	return body
}

func schemaFields(schema map[string]any) []Field {
	properties, _ := schema["properties"].(map[string]any)
	required := map[string]bool{}
	if list, ok := schema["required"].([]any); ok {
		for _, name := range list {
			if text, ok := name.(string); ok {
				required[text] = true
			}
		}
	}
	fields := make([]Field, 0, len(properties))
	for name, raw := range properties {
		property, _ := raw.(map[string]any)
		field := Field{Name: name, Required: required[name]}
		field.Type, _ = property["type"].(string)
		if ref := refName(property); ref != "" {
			field.Type, field.Ref = "object", ref
		}
		fields = append(fields, field)
	}
	sort.Slice(fields, func(i, j int) bool { return fields[i].Name < fields[j].Name })
	return fields
}

// --- Confronti -----------------------------------------------------------------------------

// CompareWithContract: route non documentate, operazioni documentate non implementate, campi
// dei DTO diversi dagli schemi (mancanti, tipo, obbligatorietà).
func CompareWithContract(code []Operation, contract Contract) []Issue {
	issues := []Issue{}
	implemented := map[string]bool{}
	for _, operation := range code {
		key := operation.Key()
		documented, ok := contract.Operations[key]
		if !ok && strings.HasPrefix(key, "ANY ") {
			for other, candidate := range contract.Operations {
				if strings.HasSuffix(other, strings.TrimPrefix(key, "ANY")) {
					documented, ok = candidate, true
					implemented[other] = true
				}
			}
		}
		if !ok {
			issues = append(issues, Issue{Kind: "undocumented", Operation: key, Message: key + " is served by the code but missing from " + contract.File, File: operation.File, Line: operation.Line})
			continue
		}
		implemented[key] = true
		for _, side := range []struct {
			name       string
			code, spec *Body
		}{{"request", operation.Request, documented.Request}, {"response", operation.Response, documented.Response}} {
			if side.code == nil || side.spec == nil {
				continue
			}
			issues = append(issues, compareFields(key, side.name, side.code.Fields, side.spec.Fields, operation)...)
		}
	}
	keys := make([]string, 0, len(contract.Operations))
	for key := range contract.Operations {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		if !implemented[key] {
			issues = append(issues, Issue{Kind: "unimplemented", Operation: key, Message: key + " is documented in " + contract.File + " but no handler serves it"})
		}
	}
	return issues
}

func compareFields(operation, side string, code, spec []Field, at Operation) []Issue {
	var issues []Issue
	byName := map[string]Field{}
	for _, field := range spec {
		byName[field.Name] = field
	}
	seen := map[string]bool{}
	for _, field := range code {
		seen[field.Name] = true
		documented, ok := byName[field.Name]
		switch {
		case !ok:
			issues = append(issues, Issue{Kind: "field-missing-in-contract", Operation: operation, Side: side, Field: field.Name, Message: fmt.Sprintf("%s %s field %q is not in the contract", operation, side, field.Name), File: at.File, Line: at.Line})
		case documented.Type != "" && field.Type != "" && documented.Type != field.Type:
			issues = append(issues, Issue{Kind: "type-mismatch", Operation: operation, Side: side, Field: field.Name, Message: fmt.Sprintf("%s %s field %q is %s in the code, %s in the contract", operation, side, field.Name, field.Type, documented.Type), File: at.File, Line: at.Line})
		case side == "request" && documented.Required != field.Required:
			issues = append(issues, Issue{Kind: "required-mismatch", Operation: operation, Side: side, Field: field.Name, Message: fmt.Sprintf("%s request field %q is %s in the code, %s in the contract", operation, field.Name, requiredWord(field.Required), requiredWord(documented.Required)), File: at.File, Line: at.Line})
		}
	}
	for _, field := range spec {
		if !seen[field.Name] {
			issues = append(issues, Issue{Kind: "field-missing-in-code", Operation: operation, Side: side, Field: field.Name, Message: fmt.Sprintf("%s %s field %q is documented but the code has no such field", operation, side, field.Name), File: at.File, Line: at.Line})
		}
	}
	return issues
}

func requiredWord(required bool) string {
	if required {
		return "required"
	}
	return "optional"
}

// CompareRevisions: cosa è cambiato nell'API fra base e head, con le modifiche che rompono i client.
func CompareRevisions(base, head []Operation) []Issue {
	issues := []Issue{}
	before, after := index(base), index(head)
	for _, key := range sortedKeys(before) {
		if _, ok := after[key]; !ok {
			issues = append(issues, Issue{Kind: "removed-operation", Operation: key, Message: key + " was removed", Breaking: true})
		}
	}
	for _, key := range sortedKeys(after) {
		now := after[key]
		old, ok := before[key]
		if !ok {
			issues = append(issues, Issue{Kind: "added-operation", Operation: key, Message: key + " is new", File: now.File, Line: now.Line})
			continue
		}
		for _, side := range []struct {
			name     string
			old, now *Body
		}{{"request", old.Request, now.Request}, {"response", old.Response, now.Response}} {
			if side.old == nil || side.now == nil {
				continue
			}
			issues = append(issues, fieldChanges(key, side.name, side.old.Fields, side.now.Fields, now)...)
		}
	}
	return issues
}

func fieldChanges(operation, side string, old, now []Field, at Operation) []Issue {
	var issues []Issue
	previous := map[string]Field{}
	for _, field := range old {
		previous[field.Name] = field
	}
	current := map[string]Field{}
	for _, field := range now {
		current[field.Name] = field
		was, ok := previous[field.Name]
		switch {
		case !ok:
			// Un campo nuovo obbligatorio in richiesta rompe i client esistenti.
			issues = append(issues, Issue{Kind: "added-field", Operation: operation, Side: side, Field: field.Name, Message: fmt.Sprintf("%s %s gained field %q", operation, side, field.Name), Breaking: side == "request" && field.Required, File: at.File, Line: at.Line})
		case was.Type != field.Type:
			issues = append(issues, Issue{Kind: "type-changed", Operation: operation, Side: side, Field: field.Name, Message: fmt.Sprintf("%s %s field %q changed from %s to %s", operation, side, field.Name, was.Type, field.Type), Breaking: true, File: at.File, Line: at.Line})
		case side == "request" && field.Required && !was.Required:
			issues = append(issues, Issue{Kind: "became-required", Operation: operation, Side: side, Field: field.Name, Message: fmt.Sprintf("%s request field %q became required", operation, field.Name), Breaking: true, File: at.File, Line: at.Line})
		}
	}
	for _, field := range old {
		if _, ok := current[field.Name]; !ok {
			// Togliere un campo dalla risposta rompe chi lo legge; dalla richiesta, chi lo invia viene ignorato.
			issues = append(issues, Issue{Kind: "removed-field", Operation: operation, Side: side, Field: field.Name, Message: fmt.Sprintf("%s %s lost field %q", operation, side, field.Name), Breaking: side == "response", File: at.File, Line: at.Line})
		}
	}
	return issues
}

func index(operations []Operation) map[string]Operation {
	out := map[string]Operation{}
	for _, operation := range operations {
		out[operation.Key()] = operation
	}
	return out
}

func sortedKeys(operations map[string]Operation) []string {
	keys := make([]string, 0, len(operations))
	for key := range operations {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
