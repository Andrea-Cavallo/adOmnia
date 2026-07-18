package oascontract

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"adomnia/internal/httpexec"
	"adomnia/internal/requestcontract"
	"gopkg.in/yaml.v3"
)

type Validator struct{ spec map[string]any }

func New(raw string) (*Validator, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	var spec map[string]any
	trimmed := strings.TrimSpace(raw)
	if strings.HasPrefix(trimmed, "{") {
		decoder := json.NewDecoder(bytes.NewBufferString(raw))
		decoder.UseNumber()
		if err := decoder.Decode(&spec); err != nil {
			return nil, fmt.Errorf("parse collection OpenAPI document: %w", err)
		}
	} else if err := yaml.Unmarshal([]byte(raw), &spec); err != nil {
		return nil, fmt.Errorf("parse collection OpenAPI document: %w", err)
	}
	return &Validator{spec: spec}, nil
}

func (v *Validator) Validate(req requestcontract.Request, response httpexec.HTTPExecResponse) string {
	if v == nil {
		return ""
	}
	path := req.OpenAPIPath
	paths := object(v.spec["paths"])
	if path == "" {
		path = matchPath(paths, req.URL)
	}
	operation := object(object(paths[path])[strings.ToLower(req.Method)])
	if operation == nil {
		return fmt.Sprintf("contract: no OpenAPI operation for %s %s", strings.ToUpper(req.Method), path)
	}
	responses := object(operation["responses"])
	status := strconv.Itoa(response.Status)
	responseDoc := object(responses[status])
	if responseDoc == nil {
		responseDoc = object(responses[status[:1]+"XX"])
	}
	if responseDoc == nil {
		responseDoc = object(responses["default"])
	}
	if responseDoc == nil {
		return fmt.Sprintf("contract: response status %d is not documented", response.Status)
	}
	content := object(responseDoc["content"])
	if len(content) == 0 {
		return ""
	}
	mediaType, media := selectMedia(content, response.ContentType)
	if media == nil {
		return fmt.Sprintf("contract: content type %q is not documented", response.ContentType)
	}
	schema := object(media["schema"])
	if schema == nil || !strings.Contains(strings.ToLower(mediaType), "json") {
		return ""
	}
	var value any
	if err := json.Unmarshal([]byte(response.Body), &value); err != nil {
		return fmt.Sprintf("contract: response body is not valid JSON: %v", err)
	}
	if err := v.validateSchema(schema, value, "$", 0); err != nil {
		return "contract: " + err.Error()
	}
	return ""
}

func (v *Validator) validateSchema(schema map[string]any, value any, path string, depth int) error {
	if depth > 30 {
		return fmt.Errorf("schema nesting exceeds limit at %s", path)
	}
	if ref, _ := schema["$ref"].(string); strings.HasPrefix(ref, "#/components/schemas/") {
		name := strings.TrimPrefix(ref, "#/components/schemas/")
		schema = object(object(object(v.spec["components"])["schemas"])[name])
		if schema == nil {
			return fmt.Errorf("unresolved schema reference %s", ref)
		}
	}
	typeName, _ := schema["type"].(string)
	switch typeName {
	case "object":
		objectValue, ok := value.(map[string]any)
		if !ok {
			return fmt.Errorf("%s must be an object", path)
		}
		for _, key := range stringSlice(schema["required"]) {
			if _, ok := objectValue[key]; !ok {
				return fmt.Errorf("%s.%s is required", path, key)
			}
		}
		for key, child := range object(schema["properties"]) {
			if childValue, ok := objectValue[key]; ok {
				if err := v.validateSchema(object(child), childValue, path+"."+key, depth+1); err != nil {
					return err
				}
			}
		}
	case "array":
		items, ok := value.([]any)
		if !ok {
			return fmt.Errorf("%s must be an array", path)
		}
		itemSchema := object(schema["items"])
		for index, item := range items {
			if err := v.validateSchema(itemSchema, item, fmt.Sprintf("%s[%d]", path, index), depth+1); err != nil {
				return err
			}
		}
	case "string":
		if _, ok := value.(string); !ok {
			return fmt.Errorf("%s must be a string", path)
		}
	case "number", "integer":
		if _, ok := value.(float64); !ok {
			return fmt.Errorf("%s must be a number", path)
		}
	case "boolean":
		if _, ok := value.(bool); !ok {
			return fmt.Errorf("%s must be a boolean", path)
		}
	}
	return nil
}

func object(value any) map[string]any { typed, _ := value.(map[string]any); return typed }
func stringSlice(value any) []string {
	raw, _ := value.([]any)
	out := []string{}
	for _, item := range raw {
		if text, ok := item.(string); ok {
			out = append(out, text)
		}
	}
	return out
}
func selectMedia(content map[string]any, actual string) (string, map[string]any) {
	actual = strings.ToLower(strings.Split(actual, ";")[0])
	if media := object(content[actual]); media != nil {
		return actual, media
	}
	for key, raw := range content {
		if strings.HasSuffix(strings.ToLower(key), "+json") && strings.Contains(actual, "json") {
			return key, object(raw)
		}
	}
	return "", nil
}
func matchPath(paths map[string]any, rawURL string) string {
	for path := range paths {
		if strings.Contains(rawURL, strings.TrimSuffix(path, "/")) {
			return path
		}
	}
	return ""
}
