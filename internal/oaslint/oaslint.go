package oaslint

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

type Severity string

const (
	SeverityError Severity = "error"
	SeverityWarn  Severity = "warn"
	SeverityInfo  Severity = "info"
)

type Finding struct {
	RuleID      string   `json:"ruleId"`
	Severity    Severity `json:"severity"`
	Message     string   `json:"message"`
	Path        string   `json:"path,omitempty"`
	Method      string   `json:"method,omitempty"`
	OperationID string   `json:"operationId,omitempty"`
	Location    string   `json:"location,omitempty"`
}

type RuleOverride struct {
	Severity Severity
	Enabled  *bool
}

type Ruleset struct {
	Rules map[string]RuleOverride
}

type Options struct {
	Ruleset Ruleset
}

type ruleDefinition struct {
	ID       string
	Severity Severity
}

var defaultRules = []ruleDefinition{
	{ID: "operation-id-required", Severity: SeverityError},
	{ID: "operation-summary-required", Severity: SeverityWarn},
	{ID: "response-2xx-required", Severity: SeverityError},
	{ID: "response-error-required", Severity: SeverityWarn},
	{ID: "operation-security-required", Severity: SeverityWarn},
	{ID: "operation-tags-required", Severity: SeverityWarn},
	{ID: "path-naming-coherent", Severity: SeverityWarn},
	{ID: "operation-id-unique", Severity: SeverityError},
	{ID: "json-response-schema-required", Severity: SeverityWarn},
}

var (
	httpMethods       = []string{"get", "put", "post", "delete", "options", "head", "patch", "trace"}
	httpMethodSet     = map[string]bool{"get": true, "put": true, "post": true, "delete": true, "options": true, "head": true, "patch": true, "trace": true}
	staticPathSegment = regexp.MustCompile(`^[a-z0-9._-]+$`)
)

func LintJSON(raw []byte, opts Options) ([]Finding, error) {
	var spec map[string]any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(&spec); err != nil {
		return nil, fmt.Errorf("parse OpenAPI JSON: %w", err)
	}
	return LintSpec(spec, opts), nil
}

func LintYAML(raw []byte, opts Options) ([]Finding, error) {
	var spec map[string]any
	if err := yaml.Unmarshal(raw, &spec); err != nil {
		return nil, fmt.Errorf("parse OpenAPI YAML: %w", err)
	}
	return LintSpec(spec, opts), nil
}

func LintSpec(spec map[string]any, opts Options) []Finding {
	if spec == nil {
		return nil
	}

	activeRules := buildRuleIndex(opts.Ruleset)
	findings := []Finding{}
	operationIDs := map[string]operationRef{}
	securityExpected := hasMap(spec, "security") || hasSecuritySchemes(spec)

	paths := asMap(spec["paths"])
	pathKeys := sortedKeys(paths)
	for _, path := range pathKeys {
		pathItem := asMap(paths[path])
		if pathItem == nil {
			continue
		}
		if ruleEnabled(activeRules, "path-naming-coherent") {
			if msg := validatePathName(path); msg != "" {
				findings = append(findings, finding(activeRules, "path-naming-coherent", path, "", "", msg, "paths."+path))
			}
		}
		for _, method := range httpMethods {
			operation := asMap(pathItem[method])
			if operation == nil {
				continue
			}
			location := "paths." + path + "." + method
			operationID := strings.TrimSpace(asString(operation["operationId"]))
			methodUpper := strings.ToUpper(method)

			if operationID == "" {
				findings = appendIfEnabled(findings, activeRules, "operation-id-required", path, methodUpper, "", "operationId is required for stable SDKs, tests, and diffs.", location+".operationId")
			} else if previous, ok := operationIDs[operationID]; ok {
				msg := fmt.Sprintf("operationId %q is already used by %s %s.", operationID, previous.Method, previous.Path)
				findings = appendIfEnabled(findings, activeRules, "operation-id-unique", path, methodUpper, operationID, msg, location+".operationId")
			} else {
				operationIDs[operationID] = operationRef{Path: path, Method: methodUpper}
			}

			if strings.TrimSpace(asString(operation["summary"])) == "" && strings.TrimSpace(asString(operation["description"])) == "" {
				findings = appendIfEnabled(findings, activeRules, "operation-summary-required", path, methodUpper, operationID, "Add a summary or description so the operation is understandable in generated clients and docs.", location)
			}
			if tags := asStringSlice(operation["tags"]); len(tags) == 0 {
				findings = appendIfEnabled(findings, activeRules, "operation-tags-required", path, methodUpper, operationID, "Add at least one tag to keep the API catalog navigable.", location+".tags")
			}
			if securityExpected && !hasSecurity(operation) && !hasSecurity(pathItem) && !hasSecurity(spec) {
				findings = appendIfEnabled(findings, activeRules, "operation-security-required", path, methodUpper, operationID, "Security schemes exist but this operation has no root, path, or operation security requirement.", location+".security")
			}

			responses := asMap(operation["responses"])
			if !hasResponseClass(responses, "2") {
				findings = appendIfEnabled(findings, activeRules, "response-2xx-required", path, methodUpper, operationID, "Document at least one successful 2xx response.", location+".responses")
			}
			if !hasErrorResponse(responses) {
				findings = appendIfEnabled(findings, activeRules, "response-error-required", path, methodUpper, operationID, "Document a 4xx, 5xx, or default error response.", location+".responses")
			}
			findings = append(findings, lintJSONResponseSchemas(activeRules, responses, path, methodUpper, operationID, location+".responses")...)
		}
	}

	sortFindings(findings)
	return findings
}

func RulesetFromJSON(raw []byte) (Ruleset, error) {
	var body struct {
		Rules map[string]RuleOverride `json:"rules"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return Ruleset{}, fmt.Errorf("parse ruleset: %w", err)
	}
	if body.Rules == nil {
		body.Rules = map[string]RuleOverride{}
	}
	return Ruleset{Rules: body.Rules}, nil
}

func (r *RuleOverride) UnmarshalJSON(raw []byte) error {
	var value string
	if err := json.Unmarshal(raw, &value); err == nil {
		return r.applyString(value)
	}
	var body struct {
		Severity string `json:"severity"`
		Enabled  *bool  `json:"enabled"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return err
	}
	r.Enabled = body.Enabled
	if body.Severity != "" {
		if err := r.applySeverity(body.Severity); err != nil {
			return err
		}
	}
	return nil
}

func HasErrors(findings []Finding) bool {
	for _, item := range findings {
		if item.Severity == SeverityError {
			return true
		}
	}
	return false
}

func FormatJSON(findings []Finding) ([]byte, error) {
	return json.MarshalIndent(struct {
		Findings  []Finding `json:"findings"`
		HasErrors bool      `json:"hasErrors"`
	}{Findings: findings, HasErrors: HasErrors(findings)}, "", "  ")
}

func FormatText(findings []Finding) string {
	if len(findings) == 0 {
		return "OpenAPI lint passed with no findings.\n"
	}
	var builder strings.Builder
	for _, item := range findings {
		target := item.Path
		if item.Method != "" {
			target = item.Method + " " + target
		}
		if target == "" {
			target = item.Location
		}
		fmt.Fprintf(&builder, "[%s] %s %s: %s\n", item.Severity, item.RuleID, target, item.Message)
	}
	return builder.String()
}

type operationRef struct {
	Path   string
	Method string
}

type ruleState struct {
	Severity Severity
	Enabled  bool
}

func buildRuleIndex(ruleset Ruleset) map[string]ruleState {
	index := map[string]ruleState{}
	for _, def := range defaultRules {
		index[def.ID] = ruleState{Severity: def.Severity, Enabled: true}
	}
	for id, override := range ruleset.Rules {
		state, ok := index[id]
		if !ok {
			continue
		}
		if override.Severity != "" {
			state.Severity = override.Severity
		}
		if override.Enabled != nil {
			state.Enabled = *override.Enabled
		}
		index[id] = state
	}
	return index
}

func (r *RuleOverride) applyString(value string) error {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "off" || value == "disabled" || value == "false" {
		enabled := false
		r.Enabled = &enabled
		return nil
	}
	enabled := true
	r.Enabled = &enabled
	return r.applySeverity(value)
}

func (r *RuleOverride) applySeverity(value string) error {
	severity := Severity(strings.ToLower(strings.TrimSpace(value)))
	switch severity {
	case SeverityError, SeverityWarn, SeverityInfo:
		r.Severity = severity
		return nil
	default:
		return fmt.Errorf("unsupported severity %q", value)
	}
}

func appendIfEnabled(findings []Finding, rules map[string]ruleState, ruleID, path, method, operationID, message, location string) []Finding {
	if !ruleEnabled(rules, ruleID) {
		return findings
	}
	return append(findings, finding(rules, ruleID, path, method, operationID, message, location))
}

func finding(rules map[string]ruleState, ruleID, path, method, operationID, message, location string) Finding {
	return Finding{
		RuleID:      ruleID,
		Severity:    rules[ruleID].Severity,
		Message:     message,
		Path:        path,
		Method:      method,
		OperationID: operationID,
		Location:    location,
	}
}

func ruleEnabled(rules map[string]ruleState, ruleID string) bool {
	state, ok := rules[ruleID]
	return ok && state.Enabled
}

func validatePathName(path string) string {
	if !strings.HasPrefix(path, "/") {
		return "Paths should start with /."
	}
	parts := strings.Split(strings.Trim(path, "/"), "/")
	for _, part := range parts {
		if part == "" || strings.HasPrefix(part, "{") && strings.HasSuffix(part, "}") {
			continue
		}
		if !staticPathSegment.MatchString(part) {
			return "Use lower-case, URL-safe static path segments; path parameters like {id} are allowed."
		}
	}
	return ""
}

func lintJSONResponseSchemas(rules map[string]ruleState, responses map[string]any, path, method, operationID, location string) []Finding {
	if !ruleEnabled(rules, "json-response-schema-required") || responses == nil {
		return nil
	}
	findings := []Finding{}
	for _, code := range sortedKeys(responses) {
		response := asMap(responses[code])
		if response == nil {
			continue
		}
		content := asMap(response["content"])
		for _, mediaType := range sortedKeys(content) {
			if !strings.Contains(strings.ToLower(mediaType), "json") {
				continue
			}
			media := asMap(content[mediaType])
			if media == nil || asMap(media["schema"]) == nil {
				msg := fmt.Sprintf("JSON response %s %s is missing a schema.", code, mediaType)
				findings = append(findings, finding(rules, "json-response-schema-required", path, method, operationID, msg, location+"."+code+".content."+mediaType+".schema"))
			}
		}
	}
	return findings
}

func hasResponseClass(responses map[string]any, prefix string) bool {
	for code := range responses {
		if strings.HasPrefix(code, prefix) {
			return true
		}
	}
	return false
}

func hasErrorResponse(responses map[string]any) bool {
	for code := range responses {
		if code == "default" || strings.HasPrefix(code, "4") || strings.HasPrefix(code, "5") {
			return true
		}
	}
	return false
}

func hasSecurity(value map[string]any) bool {
	_, ok := value["security"]
	return ok
}

func hasSecuritySchemes(spec map[string]any) bool {
	components := asMap(spec["components"])
	return len(asMap(components["securitySchemes"])) > 0
}

func hasMap(value map[string]any, key string) bool {
	return len(asMap(value[key])) > 0
}

func asMap(value any) map[string]any {
	switch typed := value.(type) {
	case map[string]any:
		return typed
	default:
		return nil
	}
}

func asString(value any) string {
	if typed, ok := value.(string); ok {
		return typed
	}
	return ""
}

func asStringSlice(value any) []string {
	raw, ok := value.([]any)
	if !ok {
		return nil
	}
	out := []string{}
	for _, item := range raw {
		text := strings.TrimSpace(asString(item))
		if text != "" {
			out = append(out, text)
		}
	}
	return out
}

func sortedKeys(values map[string]any) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func sortFindings(findings []Finding) {
	sort.SliceStable(findings, func(i, j int) bool {
		left := findings[i]
		right := findings[j]
		for _, compare := range []int{
			strings.Compare(left.Path, right.Path),
			strings.Compare(left.Method, right.Method),
			strings.Compare(left.RuleID, right.RuleID),
			strings.Compare(left.Location, right.Location),
			strings.Compare(left.Message, right.Message),
		} {
			if compare != 0 {
				return compare < 0
			}
		}
		return false
	})
}
