package main

import (
	"encoding/csv"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

var (
	runEnv        string
	runReport     string
	runDelay      int
	runStopFail   bool
	runTimeout    int
	runIterations int
	runContract   string
	runData       string
)

var runCmd = &cobra.Command{
	Use:   "run <collection.adomnia>",
	Short: "Run a collection headless with assertions and contract testing",
	Long:  "Execute all requests in a collection sequentially, evaluate assertions, run contract tests against OpenAPI specs, and generate reports.",
	Args:  cobra.ExactArgs(1),
	RunE:  runCollection,
}

func init() {
	runCmd.Flags().StringVarP(&runEnv, "env", "e", "", "Environment name to use for variable substitution")
	runCmd.Flags().StringVarP(&runReport, "report", "r", "", "Output report file (.xml=JUnit, .json=JSON, .md=Markdown)")
	runCmd.Flags().IntVarP(&runDelay, "delay", "d", 0, "Delay between requests in milliseconds")
	runCmd.Flags().BoolVar(&runStopFail, "stop-on-fail", false, "Stop execution on first failure")
	runCmd.Flags().IntVarP(&runTimeout, "timeout", "t", 30000, "Request timeout in milliseconds")
	runCmd.Flags().IntVarP(&runIterations, "iterations", "n", 1, "Number of iterations")
	runCmd.Flags().StringVarP(&runContract, "contract", "c", "", "OpenAPI spec file for contract testing (.json or .yaml)")
	runCmd.Flags().StringVar(&runData, "data", "", "Dataset file for variable substitution (.csv or .json)")
}

type collectionFile struct {
	Format       string        `json:"format"`
	Version      string        `json:"version"`
	Collections  []collection  `json:"collections"`
	Environments []environment `json:"environments"`
}

type collection struct {
	ID           string     `json:"id"`
	Name         string     `json:"name"`
	Children     []treeNode `json:"children"`
	OpenapiSpec  string     `json:"_openapiSpec,omitempty"`
}

type treeNode struct {
	ID           string        `json:"id"`
	Name         string        `json:"name"`
	Type         string        `json:"type"`
	Method       string        `json:"method"`
	URL          string        `json:"url"`
	Headers      []kvEntry     `json:"headers"`
	Params       []kvEntry     `json:"params"`
	Bodies       []bodyDef     `json:"bodies"`
	ActiveBodyIdx int          `json:"activeBodyIdx"`
	Auth         authDef       `json:"auth"`
	Scripts      scriptsDef    `json:"scripts"`
	Assertions   []assertionDef `json:"assertions,omitempty"`
	OpenapiPath  string        `json:"_openapiPath,omitempty"`
	Children     []treeNode    `json:"children"`
}

type kvEntry struct {
	ID      string `json:"id"`
	Key     string `json:"key"`
	Value   string `json:"value"`
	Enabled bool   `json:"enabled"`
}

type bodyDef struct {
	ID   string `json:"id"`
	Type string `json:"type"`
	Raw  string `json:"raw"`
	Lang string `json:"lang"`
}

type authDef struct {
	Type     string `json:"type"`
	Token    string `json:"token"`
	Username string `json:"username"`
	Password string `json:"password"`
}

type scriptsDef struct {
	Pre  string `json:"pre"`
	Post string `json:"post"`
	Tests string `json:"tests"`
}

type assertionDef struct {
	ID         string `json:"id"`
	Enabled    bool   `json:"enabled"`
	Target     string `json:"target"`
	Operator   string `json:"operator"`
	Path       string `json:"path,omitempty"`
	HeaderName string `json:"headerName,omitempty"`
	Expected   string `json:"expected,omitempty"`
	Type       string `json:"type,omitempty"`
}

type environment struct {
	ID      string    `json:"id"`
	Name    string    `json:"name"`
	Vars []kvEntry    `json:"variables"`
}

type runResult struct {
	Name        string   `json:"name"`
	Method      string   `json:"method"`
	URL         string   `json:"url"`
	Status      int      `json:"status"`
	DurationMs  float64  `json:"durationMs"`
	Passed      bool     `json:"passed"`
	Error       string   `json:"error,omitempty"`
	Assertions  int      `json:"assertions"`
	Failed      int      `json:"failed"`
	ContractErrors []string `json:"contractErrors,omitempty"`
}

type assertionResult struct {
	passed  bool
	message string
}

func runCollection(cmd *cobra.Command, args []string) error {
	data, err := os.ReadFile(args[0])
	if err != nil {
		return fmt.Errorf("failed to read file: %w", err)
	}

	var file collectionFile
	if err := json.Unmarshal(data, &file); err != nil {
		return fmt.Errorf("failed to parse collection: %w", err)
	}

	vars := make(map[string]string)
	if runEnv != "" {
		for _, env := range file.Environments {
			if strings.EqualFold(env.Name, runEnv) {
				for _, v := range env.Vars {
					if v.Enabled && v.Key != "" {
						vars[v.Key] = v.Value
					}
				}
				break
			}
		}
	}

	// Dataset support
	var dataset []map[string]string
	if runData != "" {
		dataset, err = loadDataset(runData)
		if err != nil {
			return fmt.Errorf("failed to load dataset: %w", err)
		}
		fmt.Printf("Loaded dataset with %d rows\n", len(dataset))
	}
	if len(dataset) == 0 {
		dataset = []map[string]string{nil}
	}

	// OpenAPI contract spec loading
	var contractSpec map[string]interface{}
	if runContract != "" {
		contractSpec, err = loadOpenAPISpec(runContract)
		if err != nil {
			return fmt.Errorf("failed to load OpenAPI spec: %w", err)
		}
		fmt.Printf("Loaded OpenAPI spec for contract testing\n")
	}

	requests := flattenRequests(file.Collections)
	if len(requests) == 0 {
		fmt.Println("No requests found in collection.")
		return nil
	}

	// Use collection-level OpenAPI spec if set
	collectionOASpec := findCollectionOpenAPISpec(file.Collections)

	fmt.Printf("Running %d requests across %d environments x%d iterations...\n", len(requests), len(dataset), runIterations)

	var allResults []runResult
	totalPassed, totalFailed := 0, 0
	startTime := time.Now()
	client := &http.Client{Timeout: time.Duration(runTimeout) * time.Millisecond}

	for iter := 0; iter < runIterations; iter++ {
		if runIterations > 1 {
			fmt.Printf("\n--- Iteration %d/%d ---\n", iter+1, runIterations)
		}

		for di, dsRow := range dataset {
			if len(dataset) > 1 {
				fmt.Printf("  [dataset row %d/%d]\n", di+1, len(dataset))
			}

			mergedVars := mergeMaps(vars, dsRow)

			for i, req := range requests {
				url := substVarsSimple(req.URL, mergedVars)
				method := req.Method
				if method == "" {
					method = "GET"
				}

				var bodyReader io.Reader
				if len(req.Bodies) > 0 {
					idx := req.ActiveBodyIdx
					if idx >= len(req.Bodies) {
						idx = 0
					}
					body := req.Bodies[idx]
					if body.Type == "raw" && body.Raw != "" {
						bodyReader = strings.NewReader(substVarsSimple(body.Raw, mergedVars))
					}
				}

				httpReq, err := http.NewRequest(method, url, bodyReader)
				if err != nil {
					result := runResult{Name: req.Name, Method: method, URL: url, Passed: false, Error: err.Error()}
					allResults = append(allResults, result)
					totalFailed++
					printResultCLI(i+1, len(requests), result)
					if runStopFail {
						return finishRun(allResults, totalPassed, totalFailed, startTime)
					}
					continue
				}

				for _, h := range req.Headers {
					if h.Enabled && h.Key != "" {
						httpReq.Header.Set(substVarsSimple(h.Key, mergedVars), substVarsSimple(h.Value, mergedVars))
					}
				}
				applyAuth(httpReq, req.Auth, mergedVars)

				t0 := time.Now()
				resp, err := client.Do(httpReq)
				durationMs := float64(time.Since(t0).Microseconds()) / 1000.0

				if err != nil {
					result := runResult{Name: req.Name, Method: method, URL: url, DurationMs: durationMs, Passed: false, Error: err.Error()}
					allResults = append(allResults, result)
					totalFailed++
					printResultCLI(i+1, len(requests), result)
					if runStopFail {
						return finishRun(allResults, totalPassed, totalFailed, startTime)
					}
					continue
				}

				bodyBytes, _ := io.ReadAll(resp.Body)
				resp.Body.Close()
				bodyStr := string(bodyBytes)

				passed := resp.StatusCode >= 200 && resp.StatusCode < 400

				// Evaluate assertions
				totalAssertions := 0
				failedAssertions := 0
				for _, a := range req.Assertions {
					if !a.Enabled {
						continue
					}
					totalAssertions++
					ar := evaluateAssertion(a, resp.StatusCode, int(durationMs), resp.Header, bodyStr)
					if !ar.passed {
						failedAssertions++
						passed = false
					}
				}

				// Contract testing
				var contractErrors []string
				oaSpec := contractSpec
				if oaSpec == nil && collectionOASpec != nil {
					oaSpec = collectionOASpec
				}
				if oaSpec != nil && req.OpenapiPath != "" {
					contractErrors = validateContractResponse(oaSpec, req.OpenapiPath, method, resp.StatusCode, resp.Header, bodyStr)
					if len(contractErrors) > 0 {
						passed = false
					}
				}

				result := runResult{
					Name:        req.Name,
					Method:      method,
					URL:         url,
					Status:      resp.StatusCode,
					DurationMs:  durationMs,
					Passed:      passed,
					Assertions:  totalAssertions,
					Failed:      failedAssertions,
					ContractErrors: contractErrors,
				}
				allResults = append(allResults, result)
				if passed {
					totalPassed++
				} else {
					totalFailed++
				}
				printResultCLI(i+1, len(requests), result)

				if !passed && runStopFail {
					fmt.Println("\nStopped: request failed and --stop-on-fail is set")
					return finishRun(allResults, totalPassed, totalFailed, startTime)
				}

				if runDelay > 0 && i < len(requests)-1 {
					time.Sleep(time.Duration(runDelay) * time.Millisecond)
				}
			}
		}
	}

	return finishRun(allResults, totalPassed, totalFailed, startTime)
}

func finishRun(results []runResult, passed, failed int, startTime time.Time) error {
	totalTime := time.Since(startTime)
	fmt.Printf("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")
	fmt.Printf("Results: %d passed, %d failed, %d total in %.2fs\n", passed, failed, len(results), totalTime.Seconds())

	if runReport != "" {
		if err := writeReport(results, totalTime); err != nil {
			return fmt.Errorf("failed to write report: %w", err)
		}
		fmt.Printf("Report saved to: %s\n", runReport)
	}

	if failed > 0 {
		os.Exit(1)
	}
	return nil
}

func printResultCLI(idx, total int, r runResult) {
	status := "✓"
	if !r.Passed {
		status = "✗"
	}
	statusStr := fmt.Sprintf("%d", r.Status)
	if r.Status == 0 {
		statusStr = "ERR"
	}
	extra := ""
	if r.Failed > 0 {
		extra = fmt.Sprintf(" [%d/%d assertions]", r.Assertions-r.Failed, r.Assertions)
	}
	if len(r.ContractErrors) > 0 {
		extra += fmt.Sprintf(" [%d contract errors]", len(r.ContractErrors))
	}
	fmt.Printf("  [%d/%d] %s %s %s → %s (%.0fms)%s\n", idx, total, status, r.Method, truncate(r.URL, 50), statusStr, r.DurationMs, extra)
}

// ─── Dataset loading ──────────────────────────────────────────

func loadDataset(path string) ([]map[string]string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if strings.HasSuffix(path, ".csv") {
		return parseCSVDataset(string(data))
	}
	return parseJSONDataset(data)
}

func parseCSVDataset(text string) ([]map[string]string, error) {
	reader := csv.NewReader(strings.NewReader(text))
	records, err := reader.ReadAll()
	if err != nil || len(records) < 2 {
		return nil, fmt.Errorf("CSV must have header + at least 1 row")
	}
	headers := records[0]
	var result []map[string]string
	for _, row := range records[1:] {
		m := make(map[string]string)
		for i, h := range headers {
			if i < len(row) {
				m[h] = row[i]
			}
		}
		result = append(result, m)
	}
	return result, nil
}

func parseJSONDataset(data []byte) ([]map[string]string, error) {
	var raw []map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}
	var result []map[string]string
	for _, item := range raw {
		m := make(map[string]string)
		for k, v := range item {
			m[k] = fmt.Sprintf("%v", v)
		}
		result = append(result, m)
	}
	return result, nil
}

// ─── OpenAPI contract validation ──────────────────────────────

func loadOpenAPISpec(path string) (map[string]interface{}, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var spec map[string]interface{}
	text := string(data)
	if strings.TrimSpace(text)[0] == '{' {
		if err := json.Unmarshal(data, &spec); err != nil {
			return nil, fmt.Errorf("invalid JSON: %w", err)
		}
	} else {
		spec = basicYAMLToMap(text)
	}
	if _, ok := spec["openapi"]; !ok {
		return nil, fmt.Errorf("not a valid OpenAPI spec (missing 'openapi' field)")
	}
	return spec, nil
}

func basicYAMLToMap(yaml string) map[string]interface{} {
	lines := strings.Split(yaml, "\n")
	root := make(map[string]interface{})
	type stackFrame struct {
		obj    map[string]interface{}
		indent int
	}
	stack := []stackFrame{{obj: root, indent: -1}}
	var currentArray *[]interface{}

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		indent := len(line) - len(strings.TrimLeft(line, " "))

		for len(stack) > 1 && indent <= stack[len(stack)-1].indent {
			stack = stack[:len(stack)-1]
		}
		if currentArray != nil && indent <= stack[len(stack)-1].indent {
			currentArray = nil
		}

		current := stack[len(stack)-1].obj

		if strings.HasPrefix(trimmed, "- ") {
			value := strings.TrimPrefix(trimmed, "- ")
			if currentArray == nil {
				arr := make([]interface{}, 0)
				key := ""
				for k := range current {
					key = k
					break
				}
				if existingArr, ok := current[key].([]interface{}); ok {
					arr = existingArr
				}
				parsed := parseYAMLValue(value)
				arr = append(arr, parsed)
				current[key] = arr
				currentArray = &arr
			}
			continue
		}

		colonIdx := strings.Index(trimmed, ":")
		if colonIdx == -1 {
			continue
		}
		key := strings.TrimSpace(trimmed[:colonIdx])
		value := strings.TrimSpace(trimmed[colonIdx+1:])

		if value == "" || value == "|" || value == ">" {
			newObj := make(map[string]interface{})
			current[key] = newObj
			stack = append(stack, stackFrame{obj: newObj, indent: indent})
		} else {
			current[key] = parseYAMLValue(value)
		}
	}
	return root
}

func parseYAMLValue(val string) interface{} {
	val = strings.TrimSpace(val)
	if val == "true" { return true }
	if val == "false" { return false }
	if val == "null" || val == "~" { return nil }
	if i, err := strconv.Atoi(val); err == nil { return float64(i) }
	if f, err := strconv.ParseFloat(val, 64); err == nil { return f }
	if (strings.HasPrefix(val, "\"") && strings.HasSuffix(val, "\"")) ||
		(strings.HasPrefix(val, "'") && strings.HasSuffix(val, "'")) {
		return val[1 : len(val)-1]
	}
	return val
}

func findCollectionOpenAPISpec(cols []collection) map[string]interface{} {
	for _, c := range cols {
		if c.OpenapiSpec != "" {
			var spec map[string]interface{}
			text := c.OpenapiSpec
			if strings.TrimSpace(text)[0] == '{' {
				json.Unmarshal([]byte(text), &spec)
			} else {
				spec = basicYAMLToMap(text)
			}
			return spec
		}
		for _, n := range c.Children {
			if found := findCollectionOASpecInTree(n); found != nil {
				return found
			}
		}
	}
	return nil
}

func findCollectionOASpecInTree(n treeNode) map[string]interface{} {
	if n.OpenapiPath != "" {
		return nil
	}
	for _, child := range n.Children {
		if found := findCollectionOASpecInTree(child); found != nil {
			return found
		}
	}
	return nil
}

func validateContractResponse(
	spec map[string]interface{},
	oaPath string,
	method string,
	statusCode int,
	headers http.Header,
	bodyStr string,
) []string {
	var errors []string

	paths, _ := spec["paths"].(map[string]interface{})
	if paths == nil {
		return []string{"no paths in OpenAPI spec"}
	}
	pathEntry, _ := paths[oaPath].(map[string]interface{})
	if pathEntry == nil {
		return []string{fmt.Sprintf("path %q not found in spec", oaPath)}
	}
	op, _ := pathEntry[strings.ToLower(method)].(map[string]interface{})
	if op == nil {
		return []string{fmt.Sprintf("method %s not found for path %q", method, oaPath)}
	}

	responses, _ := op["responses"].(map[string]interface{})
	if responses == nil {
		return nil
	}

	statusKey := strconv.Itoa(statusCode)
	respEntry, ok := responses[statusKey].(map[string]interface{})
	if !ok {
		// Try pattern (2XX, 4XX, etc.)
		pattern := statusKey[:1] + "XX"
		respEntry, ok = responses[pattern].(map[string]interface{})
	}
	if !ok {
		respEntry, _ = responses["default"].(map[string]interface{})
	}
	if respEntry == nil {
		return nil
	}

	// Validate Content-Type
	expectedCT := getExpectedContentType(respEntry)
	if expectedCT != "" {
		responseCT := headers.Get("Content-Type")
		if responseCT != "" {
			responseCT = strings.Split(responseCT, ";")[0]
			expectedCT = strings.Split(expectedCT, ";")[0]
			if !strings.EqualFold(responseCT, expectedCT) {
				errors = append(errors, fmt.Sprintf("Content-Type mismatch: expected %q, got %q", expectedCT, responseCT))
			}
		}
	}

	// Basic body schema validation
	if schema := extractResponseSchema(respEntry); schema != nil && bodyStr != "" {
		var body interface{}
		if err := json.Unmarshal([]byte(bodyStr), &body); err == nil {
			bodyErrs := validateAgainstSchema(body, schema, "(root)")
			errors = append(errors, bodyErrs...)
		}
	}

	return errors
}

func getExpectedContentType(respEntry map[string]interface{}) string {
	content, _ := respEntry["content"].(map[string]interface{})
	if content == nil {
		return ""
	}
	for ct := range content {
		return ct
	}
	return ""
}

func extractResponseSchema(respEntry map[string]interface{}) map[string]interface{} {
	content, _ := respEntry["content"].(map[string]interface{})
	if content == nil {
		return nil
	}
	for _, mediaType := range content {
		mt, _ := mediaType.(map[string]interface{})
		if mt == nil {
			continue
		}
		schema, _ := mt["schema"].(map[string]interface{})
		return schema
	}
	return nil
}

func validateAgainstSchema(value interface{}, schema map[string]interface{}, path string) []string {
	var errors []string

	// Handle nullable
	if nullable, _ := schema["nullable"].(bool); nullable && value == nil {
		return nil
	}

	schemaType, _ := schema["type"].(string)
	// Type can also be an array
	if typeArr, ok := schema["type"].([]interface{}); ok {
		for _, t := range typeArr {
			if ts, ok := t.(string); ok && ts == "null" && value == nil {
				return nil
			}
		}
	}

	if schemaType != "" && value != nil {
		switch schemaType {
		case "object":
			if _, ok := value.(map[string]interface{}); !ok {
				errors = append(errors, fmt.Sprintf("%s: expected object, got %T", path, value))
				return errors
			}
		case "array":
			if _, ok := value.([]interface{}); !ok {
				errors = append(errors, fmt.Sprintf("%s: expected array, got %T", path, value))
				return errors
			}
		case "string":
			if _, ok := value.(string); !ok {
				errors = append(errors, fmt.Sprintf("%s: expected string, got %T", path, value))
				return errors
			}
		case "number", "integer":
			if _, ok := value.(float64); !ok {
				errors = append(errors, fmt.Sprintf("%s: expected number, got %T", path, value))
				return errors
			}
		case "boolean":
			if _, ok := value.(bool); !ok {
				errors = append(errors, fmt.Sprintf("%s: expected boolean, got %T", path, value))
				return errors
			}
		}
	}

	// Validate required properties for objects
	if obj, ok := value.(map[string]interface{}); ok {
		if required, ok := schema["required"].([]interface{}); ok {
			for _, r := range required {
				key := fmt.Sprintf("%v", r)
				if _, exists := obj[key]; !exists {
					errors = append(errors, fmt.Sprintf("%s: missing required field %q", path, key))
				}
			}
		}

		if props, ok := schema["properties"].(map[string]interface{}); ok {
			for propName, propSchema := range props {
				if propVal, exists := obj[propName]; exists {
					if ps, ok := propSchema.(map[string]interface{}); ok {
						errors = append(errors, validateAgainstSchema(propVal, ps, path+"."+propName)...)
					}
				}
			}
		}
	}

	// Validate array items
	if arr, ok := value.([]interface{}); ok {
		if items, ok := schema["items"].(map[string]interface{}); ok {
			for i, item := range arr {
				errors = append(errors, validateAgainstSchema(item, items, fmt.Sprintf("%s[%d]", path, i))...)
			}
		}
	}

	// Enum validation
	if enumVals, ok := schema["enum"].([]interface{}); ok {
		found := false
		for _, ev := range enumVals {
			if fmt.Sprintf("%v", value) == fmt.Sprintf("%v", ev) {
				found = true
				break
			}
		}
		if !found {
			errors = append(errors, fmt.Sprintf("%s: value %q not in allowed enum values", path, fmt.Sprintf("%v", value)))
		}
	}

	return errors
}

// ─── Assertion evaluation ────────────────────────────────────

func evaluateAssertion(a assertionDef, statusCode int, durationMs int, headers http.Header, bodyStr string) assertionResult {
	switch a.Target {
	case "statusCode":
		expected, _ := strconv.Atoi(a.Expected)
		switch a.Operator {
		case "eq":
			passed := statusCode == expected
			return assertionResult{passed: passed}
		case "neq":
			passed := statusCode != expected
			return assertionResult{passed: passed}
		case "lt":
			passed := statusCode < expected
			return assertionResult{passed: passed}
		case "gt":
			passed := statusCode > expected
			return assertionResult{passed: passed}
		}

	case "responseTime":
		expected, _ := strconv.Atoi(a.Expected)
		switch a.Operator {
		case "lt":
			passed := durationMs < expected
			return assertionResult{passed: passed}
		case "lte":
			passed := durationMs <= expected
			return assertionResult{passed: passed}
		}

	case "header":
		val := headers.Get(a.HeaderName)
		switch a.Operator {
		case "exists":
			return assertionResult{passed: val != ""}
		case "eq":
			return assertionResult{passed: val == a.Expected}
		case "contains":
			return assertionResult{passed: strings.Contains(val, a.Expected)}
		}

	case "bodyText":
		switch a.Operator {
		case "contains":
			return assertionResult{passed: strings.Contains(bodyStr, a.Expected)}
		case "not_contains":
			return assertionResult{passed: !strings.Contains(bodyStr, a.Expected)}
		}

	case "jsonPath":
		var body interface{}
		if err := json.Unmarshal([]byte(bodyStr), &body); err == nil {
			val := resolveJSONPath(body, a.Path)
			switch a.Operator {
			case "exists":
				return assertionResult{passed: val != nil}
			case "eq":
				return assertionResult{passed: fmt.Sprintf("%v", val) == a.Expected}
			case "contains":
				return assertionResult{passed: strings.Contains(fmt.Sprintf("%v", val), a.Expected)}
			}
		}
	}

	return assertionResult{passed: true}
}

func resolveJSONPath(data interface{}, path string) interface{} {
	parts := strings.Split(strings.TrimPrefix(path, "$."), ".")
	current := data
	for _, part := range parts {
		if m, ok := current.(map[string]interface{}); ok {
			// Handle array indexing like items[0]
			bracketIdx := strings.Index(part, "[")
			if bracketIdx > 0 {
				key := part[:bracketIdx]
				idxStr := part[bracketIdx+1 : len(part)-1]
				arr, ok := m[key].([]interface{})
				if !ok { return nil }
				idx, err := strconv.Atoi(idxStr)
				if err != nil { return nil }
				if idx >= len(arr) { return nil }
				current = arr[idx]
			} else {
				var ok bool
				current, ok = m[part]
				if !ok { return nil }
			}
		} else if arr, ok := current.([]interface{}); ok {
			idx, err := strconv.Atoi(part)
			if err != nil || idx >= len(arr) { return nil }
			current = arr[idx]
		} else {
			return nil
		}
	}
	return current
}

// ─── Helpers ──────────────────────────────────────────────────

func flattenRequests(collections []collection) []treeNode {
	var result []treeNode
	for _, col := range collections {
		result = append(result, flattenTree(col.Children)...)
	}
	return result
}

func flattenTree(nodes []treeNode) []treeNode {
	var result []treeNode
	for _, n := range nodes {
		if n.Type == "folder" {
			result = append(result, flattenTree(n.Children)...)
		} else {
			result = append(result, n)
		}
	}
	return result
}

func substVarsSimple(s string, vars map[string]string) string {
	for k, v := range vars {
		s = strings.ReplaceAll(s, "{{"+k+"}}", v)
	}
	return s
}

func applyAuth(req *http.Request, auth authDef, vars map[string]string) {
	switch auth.Type {
	case "bearer":
		if auth.Token != "" {
			req.Header.Set("Authorization", "Bearer "+substVarsSimple(auth.Token, vars))
		}
	case "basic":
		req.SetBasicAuth(substVarsSimple(auth.Username, vars), substVarsSimple(auth.Password, vars))
	case "apikey":
		key := auth.Username
		if key == "" {
			key = "X-API-Key"
		}
		req.Header.Set(substVarsSimple(key, vars), substVarsSimple(auth.Token, vars))
	}
}

func mergeMaps(a, b map[string]string) map[string]string {
	result := make(map[string]string)
	for k, v := range a { result[k] = v }
	for k, v := range b { result[k] = v }
	return result
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max-3] + "..."
}

// ─── Report writing ──────────────────────────────────────────

func writeReport(results []runResult, totalTime time.Duration) error {
	if strings.HasSuffix(runReport, ".xml") {
		return writeJUnitReport(results, totalTime)
	}
	if strings.HasSuffix(runReport, ".md") {
		return writeMarkdownReport(results, totalTime)
	}
	return writeJSONReport(results, totalTime)
}

func writeJSONReport(results []runResult, totalTime time.Duration) error {
	passed, failed := 0, 0
	for _, r := range results {
		if r.Passed { passed++ } else { failed++ }
	}
	report := map[string]interface{}{
		"timestamp": time.Now().Format(time.RFC3339),
		"duration":  totalTime.Seconds(),
		"summary":   map[string]int{"total": len(results), "passed": passed, "failed": failed},
		"results":   results,
	}
	data, err := json.MarshalIndent(report, "", "  ")
	if err != nil { return err }
	return os.WriteFile(runReport, data, 0644)
}

func writeMarkdownReport(results []runResult, totalTime time.Duration) error {
	var b strings.Builder
	passed, failed := 0, 0
	for _, r := range results {
		if r.Passed { passed++ } else { failed++ }
	}

	b.WriteString("# adOmnia Collection Run Report\n\n")
	b.WriteString(fmt.Sprintf("**Duration:** %.2fs | **Total:** %d | **Passed:** %d | **Failed:** %d\n\n",
		totalTime.Seconds(), len(results), passed, failed))
	b.WriteString("| # | Method | URL | Status | Time | Assertions | Contract |\n")
	b.WriteString("|---|--------|-----|--------|------|------------|----------|\n")

	for i, r := range results {
		status := "✓"
		if !r.Passed { status = "✗" }
		assertStr := "-"
		if r.Assertions > 0 {
			assertStr = fmt.Sprintf("%d/%d", r.Assertions-r.Failed, r.Assertions)
		}
		contractStr := "-"
		if len(r.ContractErrors) > 0 {
			contractStr = fmt.Sprintf("%d errors", len(r.ContractErrors))
		}
		b.WriteString(fmt.Sprintf("| %d | %s | %s | %d | %.0fms | %s | %s | %s\n",
			i+1, r.Method, truncate(r.URL, 40), r.Status, r.DurationMs, status, assertStr, contractStr))
	}

	return os.WriteFile(runReport, []byte(b.String()), 0644)
}

type junitTestSuites struct {
	XMLName   xml.Name         `xml:"testsuites"`
	Name      string           `xml:"name,attr"`
	Tests     int              `xml:"tests,attr"`
	Failures  int              `xml:"failures,attr"`
	Time      float64          `xml:"time,attr"`
	TestSuite []junitTestSuite `xml:"testsuite"`
}

type junitTestSuite struct {
	Name     string          `xml:"name,attr"`
	Tests    int             `xml:"tests,attr"`
	Failures int             `xml:"failures,attr"`
	Time     float64         `xml:"time,attr"`
	TestCase []junitTestCase `xml:"testcase"`
}

type junitTestCase struct {
	Name    string        `xml:"name,attr"`
	Time    float64       `xml:"time,attr"`
	Failure *junitFailure `xml:"failure,omitempty"`
}

type junitFailure struct {
	Message string `xml:"message,attr"`
	Text    string `xml:",chardata"`
}

func writeJUnitReport(results []runResult, totalTime time.Duration) error {
	passed, failed := 0, 0
	var cases []junitTestCase
	for _, r := range results {
		tc := junitTestCase{
			Name: fmt.Sprintf("%s %s", r.Method, r.URL),
			Time: r.DurationMs / 1000.0,
		}
		if !r.Passed {
			msg := fmt.Sprintf("Status %d", r.Status)
			if r.Error != "" { msg = r.Error }
			if r.Failed > 0 { msg += fmt.Sprintf(" | %d/%d assertions failed", r.Failed, r.Assertions) }
			if len(r.ContractErrors) > 0 { msg += fmt.Sprintf(" | contract: %v", r.ContractErrors) }
			tc.Failure = &junitFailure{Message: msg}
			failed++
		} else {
			passed++
		}
		cases = append(cases, tc)
	}

	suites := junitTestSuites{
		Name:     "adOmnia Collection Run",
		Tests:    len(results),
		Failures: failed,
		Time:     totalTime.Seconds(),
		TestSuite: []junitTestSuite{{
			Name:     "Collection",
			Tests:    len(results),
			Failures: failed,
			Time:     totalTime.Seconds(),
			TestCase: cases,
		}},
	}

	data, err := xml.MarshalIndent(suites, "", "  ")
	if err != nil { return err }
	return os.WriteFile(runReport, []byte(xml.Header+string(data)), 0644)
}
