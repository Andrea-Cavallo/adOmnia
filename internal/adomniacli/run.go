package adomniacli

import (
	"bufio"
	"encoding/json"
	"encoding/xml"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"adomnia/internal/collectionfs"
	"adomnia/internal/collectionresolve"
	"adomnia/internal/httpexec"
	"adomnia/internal/oascontract"
	"adomnia/internal/requestcontract"
)

type RunSummary struct {
	Collection      string            `json:"collection"`
	VariableSources map[string]string `json:"variableSources,omitempty"`
	Total           int               `json:"total"`
	Passed          int               `json:"passed"`
	Failed          int               `json:"failed"`
	Skipped         int               `json:"skipped"`
	Results         []RequestResult   `json:"results"`
}

type RequestResult struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Method   string `json:"method"`
	URL      string `json:"url"`
	Status   int    `json:"status,omitempty"`
	Duration int64  `json:"durationMs,omitempty"`
	Outcome  string `json:"outcome"`
	Message  string `json:"message,omitempty"`
}

type envVarFlags map[string]string

func Run(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		return 0
	}
	if args[0] == "lint" {
		return Lint(args[1:], stdout, stderr)
	}
	if args[0] != "run" {
		return 0
	}
	fs := flag.NewFlagSet("adomnia run", flag.ContinueOnError)
	fs.SetOutput(stderr)
	reporter := fs.String("reporter", "cli", "reporter: cli or json")
	outPath := fs.String("out", "", "write reporter output to file")
	bail := fs.Bool("bail", false, "stop on first failed request")
	envName := fs.String("env", "", "environment name loaded from environments/<name>.json")
	folderFilter := fs.String("folder", "", "run only requests under a folder name, id, or slash path")
	envVars := envVarFlags{}
	fs.Var(envVars, "env-var", "override environment variable KEY=VALUE")
	flagArgs, folder := splitRunArgs(args[1:])
	if err := fs.Parse(flagArgs); err != nil {
		return 2
	}
	if strings.TrimSpace(folder) == "" {
		fmt.Fprintln(stderr, "usage: adomnia run <collection-folder> [--folder name] [--env name] [--env-var KEY=VALUE] [--reporter cli|json|junit] [--out file] [--bail]")
		return 2
	}

	collection, err := collectionfs.ImportCollection(folder)
	if err != nil {
		fmt.Fprintf(stderr, "adomnia run: %v\n", err)
		return 2
	}
	vars, err := loadDotEnvVars(folder)
	if err != nil {
		fmt.Fprintf(stderr, "adomnia run: %v\n", err)
		return 2
	}
	variableSources := make(map[string]string, len(vars))
	for key := range vars {
		variableSources[key] = ".env"
	}
	environmentVars, err := loadEnvironmentVars(folder, *envName)
	if err != nil {
		fmt.Fprintf(stderr, "adomnia run: %v\n", err)
		return 2
	}
	for key, value := range environmentVars {
		vars[key] = value
		variableSources[key] = "environment:" + *envName
	}
	for key, value := range envVars {
		vars[key] = value
		variableSources[key] = "cli"
	}
	summary := executeCollection(collection, *bail, vars, variableSources, *folderFilter)
	rendered, err := renderSummary(summary, *reporter)
	if err != nil {
		fmt.Fprintf(stderr, "adomnia run: %v\n", err)
		return 2
	}
	if *outPath != "" {
		if err := os.WriteFile(*outPath, rendered, 0644); err != nil {
			fmt.Fprintf(stderr, "adomnia run: write report: %v\n", err)
			return 2
		}
	} else {
		_, _ = stdout.Write(rendered)
	}
	if summary.Failed > 0 {
		return 1
	}
	return 0
}

func loadDotEnvVars(root string) (map[string]string, error) {
	vars := map[string]string{}
	path := filepath.Join(root, ".env")
	file, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return vars, nil
		}
		return nil, fmt.Errorf("read .env: %w", err)
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	lineNumber := 0
	for scanner.Scan() {
		lineNumber++
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
		key, value, ok := strings.Cut(line, "=")
		key = strings.TrimSpace(key)
		if !ok || key == "" {
			return nil, fmt.Errorf("decode .env line %d: expected KEY=VALUE", lineNumber)
		}
		value = strings.TrimSpace(value)
		if len(value) >= 2 && ((value[0] == '\'' && value[len(value)-1] == '\'') || (value[0] == '"' && value[len(value)-1] == '"')) {
			quote := value[0]
			value = value[1 : len(value)-1]
			if quote == '"' {
				value = strings.NewReplacer(`\n`, "\n", `\r`, "\r", `\t`, "\t", `\\`, `\`).Replace(value)
			}
		}
		vars[key] = value
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("read .env: %w", err)
	}
	return vars, nil
}

func splitRunArgs(args []string) ([]string, string) {
	flagArgs := []string{}
	folder := ""
	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch {
		case arg == "-bail" || arg == "--bail":
			flagArgs = append(flagArgs, arg)
		case arg == "-reporter" || arg == "--reporter" || arg == "-out" || arg == "--out" || arg == "-env" || arg == "--env" || arg == "-env-var" || arg == "--env-var" || arg == "-folder" || arg == "--folder":
			flagArgs = append(flagArgs, arg)
			if i+1 < len(args) {
				i++
				flagArgs = append(flagArgs, args[i])
			}
		case strings.HasPrefix(arg, "-reporter=") || strings.HasPrefix(arg, "--reporter=") || strings.HasPrefix(arg, "-out=") || strings.HasPrefix(arg, "--out=") || strings.HasPrefix(arg, "-env=") || strings.HasPrefix(arg, "--env=") || strings.HasPrefix(arg, "-env-var=") || strings.HasPrefix(arg, "--env-var=") || strings.HasPrefix(arg, "-folder=") || strings.HasPrefix(arg, "--folder="):
			flagArgs = append(flagArgs, arg)
		case folder == "":
			folder = arg
		default:
			flagArgs = append(flagArgs, arg)
		}
	}
	return flagArgs, folder
}

func (v envVarFlags) String() string {
	return ""
}

func (v envVarFlags) Set(value string) error {
	key, val, ok := strings.Cut(value, "=")
	if !ok || strings.TrimSpace(key) == "" {
		return fmt.Errorf("env-var must be KEY=VALUE")
	}
	v[strings.TrimSpace(key)] = val
	return nil
}

func executeCollection(collection collectionfs.Collection, bail bool, vars map[string]string, variableSources map[string]string, folderFilter string) RunSummary {
	resolved, err := collectionresolve.ResolveRequests(collection)
	summary := RunSummary{Collection: collection.Name, VariableSources: variableSources}
	if err != nil {
		summary.Total = 1
		summary.Failed = 1
		summary.Results = append(summary.Results, RequestResult{Outcome: "failed", Message: err.Error()})
		return summary
	}
	requests := filterRequests(resolved, folderFilter)
	contractValidator, contractErr := oascontract.New(collection.OpenAPISpec)
	if contractErr != nil {
		summary.Total = 1
		summary.Failed = 1
		summary.Results = append(summary.Results, RequestResult{Outcome: "failed", Message: contractErr.Error()})
		return summary
	}
	jarID := fmt.Sprintf("cli-%s-%d", collection.ID, time.Now().UnixNano())
	defer httpexec.ClearCookieJar(jarID)
	summary.Total = len(requests)
	for _, req := range requests {
		effectiveVars := mergeRunVars(req.Vars, vars)
		resolvedVars, vaultErr := resolveVaultVars(effectiveVars)
		var result RequestResult
		if vaultErr != nil {
			result = RequestResult{ID: req.Request.ID, Name: req.Request.Name, Method: strings.ToUpper(req.Request.Method), URL: req.Request.URL, Outcome: "failed", Message: vaultErr.Error()}
		} else {
			result = executeRequest(req.Request, resolvedVars, jarID, contractValidator)
			for key, value := range resolvedVars {
				vars[key] = value
			}
		}
		summary.Results = append(summary.Results, result)
		switch result.Outcome {
		case "passed":
			summary.Passed++
		case "failed":
			summary.Failed++
		default:
			summary.Skipped++
		}
		if bail && result.Outcome == "failed" {
			break
		}
	}
	return summary
}

func filterRequests(requests []collectionresolve.ResolvedRequest, folderFilter string) []collectionresolve.ResolvedRequest {
	needle := normalizeFolderFilter(folderFilter)
	if needle == "" {
		return requests
	}
	out := []collectionresolve.ResolvedRequest{}
	for _, req := range requests {
		candidates := []string{}
		for _, part := range req.FolderPath {
			candidates = append(candidates, normalizeFolderFilter(part))
		}
		pathParts := make([]string, 0, len(req.FolderPath))
		for index, part := range req.FolderPath {
			if index%2 == 0 {
				pathParts = append(pathParts, part)
			}
		}
		candidates = append(candidates, normalizeFolderFilter(strings.Join(pathParts, "/")))
		for _, candidate := range candidates {
			if candidate == needle {
				out = append(out, req)
				break
			}
		}
	}
	return out
}

func mergeRunVars(inherited map[string]string, overrides map[string]string) map[string]string {
	out := map[string]string{}
	for key, value := range inherited {
		out[key] = value
	}
	for key, value := range overrides {
		out[key] = value
	}
	return out
}

func normalizeFolderFilter(value string) string {
	return strings.ToLower(strings.Trim(strings.ReplaceAll(value, "\\", "/"), "/ "))
}

func executeRequest(req requestcontract.Request, vars map[string]string, jarID string, contractValidator *oascontract.Validator) RequestResult {
	result := RequestResult{ID: req.ID, Name: req.Name, Method: strings.ToUpper(req.Method), URL: req.URL}
	if _, err := runHeadlessScript(req.Scripts.Pre, vars, nil); err != nil {
		result.Outcome = "failed"
		result.Message = err.Error()
		return result
	}
	originalAuth := req.Auth
	prepared, err := prepareHeadlessAuth(req, vars)
	if err != nil {
		result.Outcome = "failed"
		result.Message = err.Error()
		return result
	}
	payload, skipReason, err := requestcontract.BuildHTTPPayload(prepared, requestcontract.Options{Vars: vars, DefaultTime: 30000})
	if skipReason != "" {
		result.Outcome = "skipped"
		result.Message = skipReason
		return result
	}
	if err != nil {
		result.Outcome = "failed"
		result.Message = err.Error()
		return result
	}
	if originalAuth.Type == "aws4" {
		if err := applyAWS4(&payload, originalAuth, vars, time.Now()); err != nil {
			result.Outcome = "failed"
			result.Message = err.Error()
			return result
		}
	}
	payload.CookieJarID = jarID
	start := time.Now()
	raw := httpexec.Execute(mustJSON(payload))
	result.Duration = time.Since(start).Milliseconds()
	var resp httpexec.HTTPExecResponse
	if err := json.Unmarshal([]byte(raw), &resp); err != nil {
		result.Outcome = "failed"
		result.Message = err.Error()
		return result
	}
	result.Status = resp.Status
	if resp.Error != nil {
		result.Outcome = "failed"
		result.Message = resp.Error.Message
		return result
	}
	if _, err := runHeadlessScript(req.Scripts.Post, vars, &resp); err != nil {
		result.Outcome = "failed"
		result.Message = err.Error()
		return result
	}
	if _, err := runHeadlessScript(req.Scripts.Tests, vars, &resp); err != nil {
		result.Outcome = "failed"
		result.Message = err.Error()
		return result
	}
	if message := contractValidator.Validate(req, resp); message != "" {
		result.Outcome = "failed"
		result.Message = message
		return result
	}
	if message := requestcontract.EvaluateAssertions(req.Assertions, resp); message != "" {
		result.Outcome = "failed"
		result.Message = message
		return result
	}
	result.Outcome = "passed"
	return result
}

func loadEnvironmentVars(root, envName string) (map[string]string, error) {
	vars := map[string]string{}
	if strings.TrimSpace(envName) == "" {
		return vars, nil
	}
	path := filepath.Join(root, "environments", envName+".json")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read environment %q: %w", envName, err)
	}
	var envelope struct {
		Variables []struct {
			Key     string `json:"key"`
			Value   string `json:"value"`
			Enabled bool   `json:"enabled"`
		} `json:"variables"`
	}
	if err := json.Unmarshal(data, &envelope); err == nil && len(envelope.Variables) > 0 {
		for _, item := range envelope.Variables {
			if item.Enabled && item.Key != "" {
				vars[item.Key] = item.Value
			}
		}
		return vars, nil
	}
	var flat map[string]string
	if err := json.Unmarshal(data, &flat); err != nil {
		return nil, fmt.Errorf("decode environment %q: %w", envName, err)
	}
	for key, value := range flat {
		vars[key] = value
	}
	return vars, nil
}

func renderSummary(summary RunSummary, reporter string) ([]byte, error) {
	switch reporter {
	case "json":
		data, err := json.MarshalIndent(summary, "", "  ")
		if err != nil {
			return nil, err
		}
		return append(data, '\n'), nil
	case "junit":
		return renderJUnit(summary)
	case "cli", "":
		var b strings.Builder
		fmt.Fprintf(&b, "adOmnia run: %s\n", summary.Collection)
		if len(summary.VariableSources) > 0 {
			keys := make([]string, 0, len(summary.VariableSources))
			for key := range summary.VariableSources {
				keys = append(keys, key)
			}
			sort.Strings(keys)
			for _, key := range keys {
				fmt.Fprintf(&b, "- variable %s (%s)\n", key, summary.VariableSources[key])
			}
		}
		for _, result := range summary.Results {
			fmt.Fprintf(&b, "- %s %s %s", result.Outcome, result.Method, result.Name)
			if result.Status != 0 {
				fmt.Fprintf(&b, " [%d]", result.Status)
			}
			if result.Message != "" {
				fmt.Fprintf(&b, " - %s", result.Message)
			}
			b.WriteByte('\n')
		}
		fmt.Fprintf(&b, "summary: %d passed, %d failed, %d skipped, %d total\n", summary.Passed, summary.Failed, summary.Skipped, summary.Total)
		return []byte(b.String()), nil
	default:
		return nil, fmt.Errorf("unknown reporter %q", reporter)
	}
}

type junitTestsuite struct {
	XMLName  xml.Name        `xml:"testsuite"`
	Name     string          `xml:"name,attr"`
	Tests    int             `xml:"tests,attr"`
	Failures int             `xml:"failures,attr"`
	Skipped  int             `xml:"skipped,attr"`
	Time     string          `xml:"time,attr"`
	Cases    []junitTestcase `xml:"testcase"`
}

type junitTestcase struct {
	Name      string        `xml:"name,attr"`
	Classname string        `xml:"classname,attr"`
	Time      string        `xml:"time,attr"`
	Failure   *junitFailure `xml:"failure,omitempty"`
	Skipped   *junitSkipped `xml:"skipped,omitempty"`
}

type junitFailure struct {
	Message string `xml:"message,attr"`
	Text    string `xml:",chardata"`
}

type junitSkipped struct {
	Message string `xml:"message,attr,omitempty"`
}

func renderJUnit(summary RunSummary) ([]byte, error) {
	suite := junitTestsuite{
		Name:     summary.Collection,
		Tests:    summary.Total,
		Failures: summary.Failed,
		Skipped:  summary.Skipped,
	}
	var totalMs int64
	for _, result := range summary.Results {
		totalMs += result.Duration
		testcase := junitTestcase{
			Name:      result.Name,
			Classname: summary.Collection,
			Time:      secondsString(result.Duration),
		}
		if result.Outcome == "failed" {
			testcase.Failure = &junitFailure{Message: result.Message, Text: fmt.Sprintf("%s %s returned status %d", result.Method, result.URL, result.Status)}
		}
		if result.Outcome == "skipped" {
			testcase.Skipped = &junitSkipped{Message: result.Message}
		}
		suite.Cases = append(suite.Cases, testcase)
	}
	suite.Time = secondsString(totalMs)
	data, err := xml.MarshalIndent(suite, "", "  ")
	if err != nil {
		return nil, err
	}
	return append([]byte(xml.Header), append(data, '\n')...), nil
}

func secondsString(ms int64) string {
	return fmt.Sprintf("%.3f", float64(ms)/1000)
}

func mustJSON(v any) string {
	data, _ := json.Marshal(v)
	return string(data)
}
