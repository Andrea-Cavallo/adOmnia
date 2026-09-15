package adomniacli

import (
	"crypto/rand"
	"encoding/csv"
	"encoding/json"
	"encoding/xml"
	"flag"
	"fmt"
	"io"
	"math"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"adomnia/internal/httpexec"
	"adomnia/internal/requestcontract"
)

type stressStage struct {
	Label     string  `json:"label"`
	DurationS float64 `json:"durationS"`
	TargetVUs int     `json:"targetVus"`
	RampS     float64 `json:"rampS"`
	Measure   bool    `json:"measure"`
}

type stressConfig struct {
	VUs         int           `json:"vus"`
	RampUpS     float64       `json:"rampUpS"`
	Mode        string        `json:"mode"`
	Iterations  int64         `json:"iterations"`
	DurationS   float64       `json:"durationS"`
	ThinkTimeMs int           `json:"thinkTimeMs"`
	WarmupS     float64       `json:"warmupS"`
	Stages      []stressStage `json:"stages"`
	DatasetMode string        `json:"datasetMode"`
	ApdexTMs    float64       `json:"apdexTMs"`
	MinApdex    float64       `json:"minApdex"`
	MaxP95Ms    float64       `json:"maxP95Ms"`
	MaxErrorPct float64       `json:"maxErrorPct"`
	MinRPS      float64       `json:"minRps"`
}

type stressMapping struct{ Name, Source, Path, Fallback string }
type stressCondition struct{ Source, Path, Operator, Value string }
type stressNodeConfig struct {
	Request        *requestcontract.Request `json:"request"`
	ExpectedStatus string                   `json:"expectedStatus"`
	StopOnFailure  bool                     `json:"stopOnFailure"`
	RetryCount     int                      `json:"retryCount"`
	DelayMs        int                      `json:"delayMs"`
	Extractions    []stressMapping          `json:"extractions"`
	Condition      *stressCondition         `json:"condition"`
	EndState       string                   `json:"endState"`
}
type stressNode struct {
	ID, Type, Label string
	Config          stressNodeConfig `json:"config"`
}
type stressEdge struct{ Source, Target, Branch string }
type stressGraph struct {
	Nodes    []stressNode `json:"nodes"`
	Edges    []stressEdge `json:"edges"`
	Settings struct {
		MaxSteps        int  `json:"maxSteps"`
		FailOnHTTPError bool `json:"failOnHttpError"`
	} `json:"settings"`
}
type stressPlan struct {
	Format   string       `json:"format"`
	Version  int          `json:"version"`
	FlowName string       `json:"flowName"`
	Graph    stressGraph  `json:"graph"`
	Config   stressConfig `json:"config"`
}

type stressObservation struct {
	Step      string
	LatencyMs int64
	Status    int
	Failed    bool
	Error     string
}
type stressStats struct {
	Requests         int            `json:"requests"`
	Errors           int            `json:"errors"`
	Excluded         int            `json:"excludedRequests"`
	Iterations       int64          `json:"iterations"`
	FailedIterations int64          `json:"failedIterations"`
	ElapsedMs        int64          `json:"elapsedMs"`
	RPS              float64        `json:"rps"`
	P50              int64          `json:"p50"`
	P95              int64          `json:"p95"`
	P99              int64          `json:"p99"`
	Apdex            float64        `json:"apdex"`
	ApdexTMs         float64        `json:"apdexTMs"`
	Statuses         map[string]int `json:"statuses"`
	GateFailures     []string       `json:"gateFailures,omitempty"`
}
type stressCLIResult struct {
	Format     string      `json:"format"`
	Version    int         `json:"version"`
	FlowName   string      `json:"flowName"`
	StartedAt  string      `json:"startedAt"`
	FinishedAt string      `json:"finishedAt"`
	Stats      stressStats `json:"stats"`
}

func Stress(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("adomnia stress", flag.ContinueOnError)
	fs.SetOutput(stderr)
	reporter := fs.String("reporter", "cli", "reporter: cli, json or junit")
	outPath := fs.String("out", "", "write report to file")
	datasetPath := fs.String("dataset", "", "CSV dataset with variable names in the header")
	envVars := envVarFlags{}
	fs.Var(envVars, "env-var", "override variable KEY=VALUE")
	flagArgs, planPath := splitStressArgs(args)
	if err := fs.Parse(flagArgs); err != nil {
		return 2
	}
	if planPath == "" {
		fmt.Fprintln(stderr, "usage: adomnia stress <flow.stress.json> [--dataset data.csv] [--env-var KEY=VALUE] [--reporter cli|json|junit] [--out file]")
		return 2
	}
	data, err := os.ReadFile(planPath)
	if err != nil {
		fmt.Fprintf(stderr, "adomnia stress: %v\n", err)
		return 2
	}
	var plan stressPlan
	if err := json.Unmarshal(data, &plan); err != nil || plan.Format != "adomnia-flow-stress-plan" || plan.Version != 1 {
		fmt.Fprintln(stderr, "adomnia stress: invalid or unsupported stress plan")
		return 2
	}
	rows, err := readStressDataset(*datasetPath)
	if err != nil {
		fmt.Fprintf(stderr, "adomnia stress: %v\n", err)
		return 2
	}
	result, err := executeStressPlan(plan, envVars, rows)
	if err != nil {
		fmt.Fprintf(stderr, "adomnia stress: %v\n", err)
		return 2
	}
	rendered, err := renderStressResult(result, *reporter)
	if err != nil {
		fmt.Fprintf(stderr, "adomnia stress: %v\n", err)
		return 2
	}
	if *outPath != "" {
		if err := os.WriteFile(*outPath, rendered, 0644); err != nil {
			fmt.Fprintf(stderr, "adomnia stress: write report: %v\n", err)
			return 2
		}
	} else {
		_, _ = stdout.Write(rendered)
	}
	if result.Stats.Errors > 0 || len(result.Stats.GateFailures) > 0 {
		return 1
	}
	return 0
}

func splitStressArgs(args []string) ([]string, string) {
	flags := []string{}
	path := ""
	for i := 0; i < len(args); i++ {
		arg := args[i]
		takesValue := arg == "--reporter" || arg == "-reporter" || arg == "--out" || arg == "-out" || arg == "--dataset" || arg == "-dataset" || arg == "--env-var" || arg == "-env-var"
		if strings.HasPrefix(arg, "-") {
			flags = append(flags, arg)
			if takesValue && i+1 < len(args) {
				i++
				flags = append(flags, args[i])
			}
		} else if path == "" {
			path = arg
		}
	}
	return flags, path
}

func readStressDataset(path string) ([]map[string]string, error) {
	if strings.TrimSpace(path) == "" {
		return nil, nil
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	records, err := csv.NewReader(f).ReadAll()
	if err != nil {
		return nil, fmt.Errorf("read dataset: %w", err)
	}
	if len(records) < 2 {
		return nil, fmt.Errorf("dataset needs a header and at least one row")
	}
	headers := records[0]
	rows := make([]map[string]string, 0, len(records)-1)
	for _, record := range records[1:] {
		row := map[string]string{}
		for i, key := range headers {
			if strings.TrimSpace(key) == "" {
				return nil, fmt.Errorf("dataset header cannot be empty")
			}
			if i < len(record) {
				row[key] = record[i]
			}
		}
		rows = append(rows, row)
	}
	return rows, nil
}

func executeStressPlan(plan stressPlan, baseVars map[string]string, dataset []map[string]string) (stressCLIResult, error) {
	if len(plan.Graph.Nodes) == 0 {
		return stressCLIResult{}, fmt.Errorf("flow has no nodes")
	}
	cfg := plan.Config
	if cfg.VUs < 1 || cfg.VUs > 200 {
		return stressCLIResult{}, fmt.Errorf("virtual users must be between 1 and 200")
	}
	if cfg.Mode == "iterations" && cfg.Iterations < 1 {
		return stressCLIResult{}, fmt.Errorf("iterations must be at least 1")
	}
	if cfg.ApdexTMs <= 0 {
		cfg.ApdexTMs = 500
	}
	started := time.Now()
	deadline := time.Time{}
	peak := cfg.VUs
	if cfg.Mode == "duration" {
		deadline = started.Add(time.Duration(cfg.DurationS * float64(time.Second)))
	}
	if cfg.Mode == "stages" {
		total := 0.0
		peak = 0
		for _, stage := range cfg.Stages {
			if stage.DurationS <= 0 || stage.TargetVUs < 0 || stage.TargetVUs > 200 || stage.RampS < 0 || stage.RampS > stage.DurationS {
				return stressCLIResult{}, fmt.Errorf("invalid stage %q", stage.Label)
			}
			total += stage.DurationS
			if stage.TargetVUs > peak {
				peak = stage.TargetVUs
			}
		}
		deadline = started.Add(time.Duration(total * float64(time.Second)))
	}
	var claimed atomic.Int64
	var iterationCount atomic.Int64
	var failedIterations atomic.Int64
	observations := []stressObservation{}
	excluded := 0
	var mutex sync.Mutex
	worker := func(vu int) {
		if cfg.Mode != "stages" && cfg.RampUpS > 0 {
			time.Sleep(time.Duration(float64(vu) / float64(cfg.VUs) * cfg.RampUpS * float64(time.Second)))
		}
		for {
			elapsed := time.Since(started)
			if !deadline.IsZero() && time.Now().After(deadline) {
				return
			}
			if cfg.Mode == "stages" && vu >= stressTargetAt(cfg.Stages, elapsed.Seconds()) {
				time.Sleep(25 * time.Millisecond)
				continue
			}
			iteration := claimed.Add(1) - 1
			if cfg.Mode == "iterations" && iteration >= cfg.Iterations {
				return
			}
			vars := map[string]string{}
			for key, value := range baseVars {
				vars[key] = value
			}
			if len(dataset) > 0 {
				index := int(iteration % int64(len(dataset)))
				if cfg.DatasetMode == "per-vu" {
					index = vu % len(dataset)
				} else if cfg.DatasetMode == "random" {
					index = int((iteration*1103515245 + int64(vu)*2654435761 + 12345) % int64(len(dataset)))
				}
				for key, value := range dataset[index] {
					vars[key] = value
				}
			}
			vars["__vu"] = strconv.Itoa(vu + 1)
			vars["__iteration"] = strconv.FormatInt(iteration+1, 10)
			vars["__timestamp"] = strconv.FormatInt(time.Now().UnixMilli(), 10)
			vars["__uuid"] = stressUUID()
			items, failed := executeStressFlow(plan.Graph, vars, fmt.Sprintf("stress-%d-%d", vu, iteration))
			measured := stressMeasuredAt(cfg, time.Since(started).Seconds())
			mutex.Lock()
			if measured {
				observations = append(observations, items...)
				iterationCount.Add(1)
				if failed {
					failedIterations.Add(1)
				}
			} else {
				excluded += len(items)
			}
			mutex.Unlock()
			if cfg.ThinkTimeMs > 0 {
				time.Sleep(time.Duration(cfg.ThinkTimeMs) * time.Millisecond)
			}
		}
	}
	var wait sync.WaitGroup
	for vu := 0; vu < peak; vu++ {
		wait.Add(1)
		go func(id int) { defer wait.Done(); worker(id) }(vu)
	}
	wait.Wait()
	finished := time.Now()
	measuredMs := measuredDuration(cfg, finished.Sub(started).Seconds()) * 1000
	stats := summarizeStress(observations, excluded, iterationCount.Load(), failedIterations.Load(), finished.Sub(started).Milliseconds(), measuredMs, cfg)
	return stressCLIResult{Format: "adomnia-flow-stress-result", Version: 1, FlowName: plan.FlowName, StartedAt: started.UTC().Format(time.RFC3339Nano), FinishedAt: finished.UTC().Format(time.RFC3339Nano), Stats: stats}, nil
}

func stressUUID() string {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", value[0:4], value[4:6], value[6:8], value[8:10], value[10:16])
}

func stressTargetAt(stages []stressStage, elapsed float64) int {
	offset := 0.0
	previous := 0
	for _, stage := range stages {
		if elapsed < offset+stage.DurationS {
			within := elapsed - offset
			if stage.RampS > 0 && within < stage.RampS {
				return int(math.Round(float64(previous) + (float64(stage.TargetVUs-previous) * within / stage.RampS)))
			}
			return stage.TargetVUs
		}
		offset += stage.DurationS
		previous = stage.TargetVUs
	}
	return 0
}
func stressMeasuredAt(cfg stressConfig, elapsed float64) bool {
	if cfg.Mode != "stages" {
		return elapsed >= cfg.WarmupS
	}
	offset := 0.0
	for _, stage := range cfg.Stages {
		if elapsed < offset+stage.DurationS {
			return stage.Measure
		}
		offset += stage.DurationS
	}
	return false
}
func measuredDuration(cfg stressConfig, elapsed float64) float64 {
	if cfg.Mode != "stages" {
		return math.Max(0, elapsed-cfg.WarmupS)
	}
	offset, total := 0.0, 0.0
	for _, stage := range cfg.Stages {
		if stage.Measure {
			total += math.Max(0, math.Min(stage.DurationS, elapsed-offset))
		}
		offset += stage.DurationS
	}
	return total
}

func executeStressFlow(graph stressGraph, vars map[string]string, jarID string) ([]stressObservation, bool) {
	defer httpexec.ClearCookieJar(jarID)
	nodes := map[string]stressNode{}
	incoming := map[string]int{}
	for _, node := range graph.Nodes {
		nodes[node.ID] = node
	}
	for _, edge := range graph.Edges {
		incoming[edge.Target]++
	}
	current := ""
	for _, node := range graph.Nodes {
		if node.Type == "start" {
			current = node.ID
			break
		}
	}
	if current == "" {
		for _, node := range graph.Nodes {
			if incoming[node.ID] == 0 {
				current = node.ID
				break
			}
		}
	}
	maxSteps := graph.Settings.MaxSteps
	if maxSteps <= 0 {
		maxSteps = 80
	}
	observations := []stressObservation{}
	failedFlow := false
	var last httpexec.HTTPExecResponse
	for step := 0; step < maxSteps && current != ""; step++ {
		node := nodes[current]
		branch := "next"
		switch node.Type {
		case "end":
			return observations, failedFlow || node.Config.EndState == "failed"
		case "request":
			if node.Config.DelayMs > 0 {
				time.Sleep(time.Duration(node.Config.DelayMs) * time.Millisecond)
			}
			var observation stressObservation
			var ok bool
			for attempt := 0; attempt <= node.Config.RetryCount; attempt++ {
				observation, last, ok = executeStressRequest(node, vars, jarID)
				if ok {
					break
				}
			}
			observations = append(observations, observation)
			if !ok {
				failedFlow = true
				branch = "error"
			} else {
				branch = "success"
				applyStressMappings(node.Config.Extractions, last, vars)
			}
		case "condition":
			if evaluateStressCondition(node.Config.Condition, last, vars) {
				branch = "true"
			} else {
				branch = "false"
			}
		}
		current = stressNext(graph.Edges, current, branch)
	}
	return observations, failedFlow
}

func executeStressRequest(node stressNode, vars map[string]string, jarID string) (stressObservation, httpexec.HTTPExecResponse, bool) {
	observation := stressObservation{Step: node.Label}
	if node.Config.Request == nil {
		observation.Failed = true
		observation.Error = "missing request"
		return observation, httpexec.HTTPExecResponse{}, false
	}
	req := *node.Config.Request
	if _, err := runHeadlessScript(req.Scripts.Pre, vars, nil); err != nil {
		observation.Failed = true
		observation.Error = err.Error()
		return observation, httpexec.HTTPExecResponse{}, false
	}
	prepared, err := prepareHeadlessAuth(req, vars)
	if err != nil {
		observation.Failed = true
		observation.Error = err.Error()
		return observation, httpexec.HTTPExecResponse{}, false
	}
	payload, skip, err := requestcontract.BuildHTTPPayload(prepared, requestcontract.Options{Vars: vars, DefaultTime: 30000})
	if err != nil || skip != "" {
		observation.Failed = true
		observation.Error = skip
		if err != nil {
			observation.Error = err.Error()
		}
		return observation, httpexec.HTTPExecResponse{}, false
	}
	payload.CookieJarID = jarID
	payload.ID = fmt.Sprintf("%s-%d", payload.ID, time.Now().UnixNano())
	started := time.Now()
	raw := httpexec.Execute(mustJSON(payload))
	observation.LatencyMs = time.Since(started).Milliseconds()
	var response httpexec.HTTPExecResponse
	if err := json.Unmarshal([]byte(raw), &response); err != nil {
		observation.Failed = true
		observation.Error = err.Error()
		return observation, response, false
	}
	observation.Status = response.Status
	if response.Ms > 0 {
		observation.LatencyMs = response.Ms
	}
	if response.Error != nil {
		observation.Failed = true
		observation.Error = response.Error.Message
		return observation, response, false
	}
	if !stressExpectedStatus(node.Config.ExpectedStatus, response.Status) {
		observation.Failed = true
		observation.Error = fmt.Sprintf("expected %s, got HTTP %d", node.Config.ExpectedStatus, response.Status)
		return observation, response, false
	}
	if _, err := runHeadlessScript(req.Scripts.Post, vars, &response); err != nil {
		observation.Failed = true
		observation.Error = err.Error()
		return observation, response, false
	}
	if _, err := runHeadlessScript(req.Scripts.Tests, vars, &response); err != nil {
		observation.Failed = true
		observation.Error = err.Error()
		return observation, response, false
	}
	if message := requestcontract.EvaluateAssertions(req.Assertions, response); message != "" {
		observation.Failed = true
		observation.Error = message
		return observation, response, false
	}
	return observation, response, true
}

func stressExpectedStatus(expected string, status int) bool {
	expected = strings.TrimSpace(strings.ToLower(expected))
	if expected == "" || expected == "2xx" {
		return status >= 200 && status < 300
	}
	if strings.HasSuffix(expected, "xx") && len(expected) == 3 {
		digit, _ := strconv.Atoi(expected[:1])
		return status/100 == digit
	}
	value, err := strconv.Atoi(expected)
	return err == nil && status == value
}
func stressNext(edges []stressEdge, source, branch string) string {
	for _, edge := range edges {
		if edge.Source == source && edge.Branch == branch {
			return edge.Target
		}
	}
	for _, edge := range edges {
		if edge.Source == source && (edge.Branch == "next" || edge.Branch == "else") {
			return edge.Target
		}
	}
	return ""
}

func applyStressMappings(mappings []stressMapping, response httpexec.HTTPExecResponse, vars map[string]string) {
	for _, mapping := range mappings {
		value := mapping.Fallback
		switch mapping.Source {
		case "status":
			value = strconv.Itoa(response.Status)
		case "header":
			for key, item := range response.Headers {
				if strings.EqualFold(key, mapping.Path) {
					value = item
					break
				}
			}
		case "body", "expression":
			if item, ok := stressJSONPath(response.Body, mapping.Path); ok {
				value = fmt.Sprint(item)
			}
		}
		if mapping.Name != "" {
			vars[mapping.Name] = value
		}
	}
}
func stressJSONPath(body, path string) (any, bool) {
	var value any
	if json.Unmarshal([]byte(body), &value) != nil {
		return nil, false
	}
	path = strings.TrimPrefix(strings.TrimPrefix(strings.TrimSpace(path), "$"), ".")
	if path == "" {
		return value, true
	}
	for _, part := range strings.Split(path, ".") {
		object, ok := value.(map[string]any)
		if !ok {
			return nil, false
		}
		value, ok = object[part]
		if !ok {
			return nil, false
		}
	}
	return value, true
}
func evaluateStressCondition(condition *stressCondition, response httpexec.HTTPExecResponse, vars map[string]string) bool {
	if condition == nil {
		return false
	}
	actual := ""
	switch condition.Source {
	case "status":
		actual = strconv.Itoa(response.Status)
	case "variable":
		actual = vars[condition.Path]
	case "header":
		for key, value := range response.Headers {
			if strings.EqualFold(key, condition.Path) {
				actual = value
			}
		}
	default:
		if value, ok := stressJSONPath(response.Body, condition.Path); ok {
			actual = fmt.Sprint(value)
		}
	}
	switch condition.Operator {
	case "exists":
		return actual != ""
	case "not_exists":
		return actual == ""
	case "neq":
		return actual != condition.Value
	case "contains":
		return strings.Contains(actual, condition.Value)
	case "gt", "lt", "gte", "lte":
		left, leftErr := strconv.ParseFloat(actual, 64)
		right, rightErr := strconv.ParseFloat(condition.Value, 64)
		if leftErr != nil || rightErr != nil {
			return false
		}
		switch condition.Operator {
		case "gt":
			return left > right
		case "lt":
			return left < right
		case "gte":
			return left >= right
		default:
			return left <= right
		}
	default:
		return actual == condition.Value
	}
}

func summarizeStress(items []stressObservation, excluded int, iterations, failedIterations, elapsedMs int64, measuredMs float64, cfg stressConfig) stressStats {
	latencies := make([]int64, 0, len(items))
	statuses := map[string]int{}
	errors := 0
	for _, item := range items {
		latencies = append(latencies, item.LatencyMs)
		key := strconv.Itoa(item.Status)
		if item.Status == 0 {
			key = "ERR"
		}
		statuses[key]++
		if item.Failed {
			errors++
		}
	}
	sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })
	percentile := func(p float64) int64 {
		if len(latencies) == 0 {
			return 0
		}
		index := int(math.Ceil(p*float64(len(latencies)))) - 1
		if index < 0 {
			index = 0
		}
		return latencies[index]
	}
	satisfied, tolerated := 0, 0
	for _, latency := range latencies {
		if float64(latency) <= cfg.ApdexTMs {
			satisfied++
		} else if float64(latency) <= cfg.ApdexTMs*4 {
			tolerated++
		}
	}
	apdex := 0.0
	if len(items) > 0 {
		apdex = math.Round(((float64(satisfied)+float64(tolerated)/2)/float64(len(items)))*1000) / 1000
	}
	stats := stressStats{Requests: len(items), Errors: errors, Excluded: excluded, Iterations: iterations, FailedIterations: failedIterations, ElapsedMs: elapsedMs, P50: percentile(.50), P95: percentile(.95), P99: percentile(.99), Apdex: apdex, ApdexTMs: cfg.ApdexTMs, Statuses: statuses}
	if measuredMs > 0 {
		stats.RPS = math.Round((float64(len(items))/(measuredMs/1000))*10) / 10
	}
	errorPct := 0.0
	if len(items) > 0 {
		errorPct = float64(errors) / float64(len(items)) * 100
	}
	if cfg.MaxP95Ms > 0 && float64(stats.P95) > cfg.MaxP95Ms {
		stats.GateFailures = append(stats.GateFailures, fmt.Sprintf("p95 %dms exceeds %.0fms", stats.P95, cfg.MaxP95Ms))
	}
	if errorPct > cfg.MaxErrorPct {
		stats.GateFailures = append(stats.GateFailures, fmt.Sprintf("error rate %.1f%% exceeds %.1f%%", errorPct, cfg.MaxErrorPct))
	}
	if cfg.MinRPS > 0 && stats.RPS < cfg.MinRPS {
		stats.GateFailures = append(stats.GateFailures, fmt.Sprintf("throughput %.1f req/s is below %.1f", stats.RPS, cfg.MinRPS))
	}
	if cfg.MinApdex > 0 && stats.Apdex < cfg.MinApdex {
		stats.GateFailures = append(stats.GateFailures, fmt.Sprintf("APDEX %.3f is below %.3f", stats.Apdex, cfg.MinApdex))
	}
	return stats
}

func renderStressResult(result stressCLIResult, reporter string) ([]byte, error) {
	switch reporter {
	case "json":
		data, err := json.MarshalIndent(result, "", "  ")
		return append(data, '\n'), err
	case "junit":
		return renderStressJUnit(result)
	case "cli", "":
		var b strings.Builder
		fmt.Fprintf(&b, "adOmnia stress: %s\n", result.FlowName)
		fmt.Fprintf(&b, "requests: %d, errors: %d, p95: %dms, p99: %dms, rps: %.1f, APDEX: %.3f\n", result.Stats.Requests, result.Stats.Errors, result.Stats.P95, result.Stats.P99, result.Stats.RPS, result.Stats.Apdex)
		for _, failure := range result.Stats.GateFailures {
			fmt.Fprintf(&b, "FAIL: %s\n", failure)
		}
		if len(result.Stats.GateFailures) == 0 {
			b.WriteString("PASS: release gates\n")
		}
		return []byte(b.String()), nil
	default:
		return nil, fmt.Errorf("unknown reporter %q", reporter)
	}
}

type stressJUnitSuite struct {
	XMLName  xml.Name          `xml:"testsuite"`
	Name     string            `xml:"name,attr"`
	Tests    int               `xml:"tests,attr"`
	Failures int               `xml:"failures,attr"`
	Time     string            `xml:"time,attr"`
	Cases    []stressJUnitCase `xml:"testcase"`
}
type stressJUnitCase struct {
	Name      string        `xml:"name,attr"`
	Classname string        `xml:"classname,attr"`
	Failure   *junitFailure `xml:"failure,omitempty"`
}

func renderStressJUnit(result stressCLIResult) ([]byte, error) {
	failures := result.Stats.GateFailures
	cases := []stressJUnitCase{}
	if len(failures) == 0 {
		cases = append(cases, stressJUnitCase{Name: "release gates", Classname: "adomnia.flow-stress"})
	} else {
		for _, failure := range failures {
			cases = append(cases, stressJUnitCase{Name: failure, Classname: "adomnia.flow-stress", Failure: &junitFailure{Message: failure, Text: failure}})
		}
	}
	suite := stressJUnitSuite{Name: result.FlowName + " stress SLOs", Tests: len(cases), Failures: len(failures), Time: secondsString(result.Stats.ElapsedMs), Cases: cases}
	data, err := xml.MarshalIndent(suite, "", "  ")
	return append([]byte(xml.Header), append(data, '\n')...), err
}
