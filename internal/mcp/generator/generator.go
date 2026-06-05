package generator

import (
	"bytes"
	"embed"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"text/template"
)

//go:embed templates/*
var templateFS embed.FS

type ToolDef struct {
	Name            string
	Description     string
	Method          string
	OriginalURL     string
	URLTemplate     string
	InputSchemaJSON string
	RequiredJSON    string
	HasBody         bool
	BodyTemplate    string
	AuthHeader      string
}

type EnvVar struct {
	Name         string
	DefaultValue string
	Description  string
}

type ServerSpec struct {
	ServerName string
	Tools      []ToolDef
	EnvVars    []EnvVar
}

type GenerateInput struct {
	ServerName string       `json:"serverName"`
	Requests   []RawRequest `json:"requests"`
}

type RawRequest struct {
	Name        string      `json:"name"`
	Description string      `json:"description"`
	Method      string      `json:"method"`
	URL         string      `json:"url"`
	Headers     []RawHeader `json:"headers"`
	Auth        RawAuth     `json:"auth"`
	Body        RawBody     `json:"body"`
}

type RawHeader struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

type RawAuth struct {
	Type  string `json:"type"`
	Token string `json:"token"`
	Key   string `json:"key"`
	Value string `json:"value"`
}

type RawBody struct {
	Mode string `json:"mode"`
	Raw  string `json:"raw"`
}

var (
	slugRe      = regexp.MustCompile(`[^a-zA-Z0-9_]+`)
	pathParamRe = regexp.MustCompile(`\{(\w+)\}|:(\w+)`)
)

func Generate(inputJSON, outputDir string) error {
	var input GenerateInput
	if err := json.Unmarshal([]byte(inputJSON), &input); err != nil {
		return fmt.Errorf("invalid input JSON: %w", err)
	}
	if strings.TrimSpace(outputDir) == "" {
		return fmt.Errorf("output directory is required")
	}
	if input.ServerName == "" {
		input.ServerName = "adomnia-api-server"
	}

	spec := buildSpec(input)
	if len(spec.Tools) == 0 {
		return fmt.Errorf("no requests selected")
	}
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return fmt.Errorf("create output dir: %w", err)
	}
	return renderAll(spec, outputDir)
}

func buildSpec(input GenerateInput) ServerSpec {
	spec := ServerSpec{ServerName: slugify(input.ServerName)}
	seen := map[string]int{}
	envVars := map[string]EnvVar{}

	for _, req := range input.Requests {
		tool := buildTool(req, seen, envVars)
		spec.Tools = append(spec.Tools, tool)
	}

	names := make([]string, 0, len(envVars))
	for name := range envVars {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		spec.EnvVars = append(spec.EnvVars, envVars[name])
	}
	return spec
}

func buildTool(req RawRequest, seen map[string]int, envVars map[string]EnvVar) ToolDef {
	name := slugify(req.Name)
	if name == "" || name == "tool" {
		name = slugify(req.Method + "_" + req.URL)
	}
	seen[name]++
	if seen[name] > 1 {
		name = fmt.Sprintf("%s_%d", name, seen[name])
	}

	description := req.Description
	if description == "" {
		description = fmt.Sprintf("%s %s", strings.ToUpper(req.Method), req.URL)
	}

	properties := map[string]map[string]string{}
	required := []string{}
	urlTemplate := pathParamRe.ReplaceAllStringFunc(req.URL, func(match string) string {
		name := strings.Trim(strings.Trim(match, "{}"), ":")
		properties[name] = map[string]string{"type": "string", "description": "Path parameter"}
		required = append(required, name)
		return "${a." + name + "}"
	})

	hasBody, bodyTemplate := bodyTemplateFromRequest(req, properties)
	propsJSON, _ := json.Marshal(properties)
	requiredJSON, _ := json.Marshal(required)

	return ToolDef{
		Name:            name,
		Description:     jsString(description),
		Method:          strings.ToUpper(req.Method),
		OriginalURL:     req.URL,
		URLTemplate:     fmt.Sprintf("`%s`", urlTemplate),
		InputSchemaJSON: string(propsJSON),
		RequiredJSON:    string(requiredJSON),
		HasBody:         hasBody,
		BodyTemplate:    bodyTemplate,
		AuthHeader:      authHeader(req, envVars),
	}
}

func bodyTemplateFromRequest(req RawRequest, properties map[string]map[string]string) (bool, string) {
	raw := strings.TrimSpace(req.Body.Raw)
	if raw == "" || strings.EqualFold(req.Body.Mode, "none") {
		return false, "{}"
	}

	var body map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &body); err != nil {
		properties["body"] = map[string]string{"type": "string", "description": "Raw request body"}
		return true, "a.body"
	}

	keys := make([]string, 0, len(body))
	for key := range body {
		keys = append(keys, key)
		properties[key] = map[string]string{"type": "string", "description": "Body field"}
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, fmt.Sprintf("%q: a.%s", key, key))
	}
	return true, "{ " + strings.Join(parts, ", ") + " }"
}

func authHeader(req RawRequest, envVars map[string]EnvVar) string {
	switch strings.ToLower(req.Auth.Type) {
	case "bearer":
		envVars["BEARER_TOKEN"] = EnvVar{Name: "BEARER_TOKEN", Description: "Bearer token for API authentication"}
		return `"Authorization": ` + "`Bearer ${process.env.BEARER_TOKEN ?? \"\"}`"
	case "apikey":
		header := strings.TrimSpace(req.Auth.Key)
		if header == "" {
			header = "X-API-Key"
		}
		envVars["API_KEY"] = EnvVar{Name: "API_KEY", Description: "API key for API authentication"}
		return fmt.Sprintf("%q: ", header) + "`${process.env.API_KEY ?? \"\"}`"
	default:
		return ""
	}
}

func renderAll(spec ServerSpec, outputDir string) error {
	files := []struct {
		templateName string
		outputName   string
	}{
		{"templates/index.ts.tmpl", "index.ts"},
		{"templates/package.json.tmpl", "package.json"},
		{"templates/env.example.tmpl", ".env.example"},
		{"templates/README.md.tmpl", "README.md"},
	}

	for _, file := range files {
		raw, err := templateFS.ReadFile(file.templateName)
		if err != nil {
			return fmt.Errorf("read template %s: %w", file.templateName, err)
		}
		tmpl, err := template.New(file.templateName).Parse(string(raw))
		if err != nil {
			return fmt.Errorf("parse template %s: %w", file.templateName, err)
		}
		var buf bytes.Buffer
		if err := tmpl.Execute(&buf, spec); err != nil {
			return fmt.Errorf("execute template %s: %w", file.templateName, err)
		}
		if err := os.WriteFile(filepath.Join(outputDir, file.outputName), buf.Bytes(), 0644); err != nil {
			return fmt.Errorf("write %s: %w", file.outputName, err)
		}
	}
	return nil
}

func slugify(value string) string {
	value = strings.TrimSpace(value)
	value = slugRe.ReplaceAllString(value, "_")
	value = strings.Trim(value, "_")
	if value == "" {
		return "tool"
	}
	return strings.ToLower(value)
}

func jsString(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, `"`, `\"`)
	value = strings.ReplaceAll(value, "\n", " ")
	return value
}
