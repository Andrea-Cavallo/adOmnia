package adomniacli

import (
	"context"
	"encoding/csv"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"encoding/xml"
	"errors"
	"flag"
	"fmt"
	"io"
	"math"
	"os"
	"os/signal"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/headless"
	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
	"github.com/Andrea-Cavallo/adOmnia/internal/loadtest"
)

// adomnia stress runs a Flow Builder CI plan on the load testing engine (internal/loadtest),
// the same engine the app's Stress dock uses, and reports it for a terminal or a CI job.

type stressErrorGroup struct {
	Code    string   `json:"code,omitempty"`
	Message string   `json:"message"`
	Count   int      `json:"count"`
	Status  int      `json:"status,omitempty"`
	Steps   []string `json:"steps,omitempty"`
}

type stressStats struct {
	Requests         int                `json:"requests"`
	Errors           int                `json:"errors"`
	Excluded         int                `json:"excludedRequests"`
	Iterations       int64              `json:"iterations"`
	FailedIterations int64              `json:"failedIterations"`
	Dropped          int                `json:"droppedIterations,omitzero"`
	ElapsedMs        int64              `json:"elapsedMs"`
	RPS              float64            `json:"rps"`
	P50              int64              `json:"p50"`
	P95              int64              `json:"p95"`
	P99              int64              `json:"p99"`
	Apdex            float64            `json:"apdex"`
	ApdexTMs         float64            `json:"apdexTMs"`
	Statuses         map[string]int     `json:"statuses"`
	ErrorGroups      []stressErrorGroup `json:"errorGroups,omitempty"`
	GateFailures     []string           `json:"gateFailures,omitempty"`
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
	var plan loadtest.Plan
	if err := json.Unmarshal(data, &plan); err != nil || plan.Format != loadtest.PlanFormat || plan.Version != 1 {
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

// executeStressPlan runs the plan; Ctrl+C stops it and reports what was measured.
func executeStressPlan(plan loadtest.Plan, baseVars map[string]string, dataset []map[string]string) (stressCLIResult, error) {
	vars, err := headless.ResolveVaultVars(baseVars)
	if err != nil {
		return stressCLIResult{}, err
	}
	scenario, err := plan.Scenario(loadtest.FlowInput{Vars: vars, Dataset: dataset})
	if err != nil {
		return stressCLIResult{}, err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	res, err := loadtest.Run(ctx, scenario, nil)
	if err != nil {
		return stressCLIResult{}, err
	}
	if res.Successful+res.Failed == 0 {
		// A plan with no reachable request would otherwise pass its gates over nothing.
		return stressCLIResult{}, errors.New("flow executed no request: no reachable start node or request step")
	}
	return stressCLIResult{Format: "adomnia-flow-stress-result", Version: 1, FlowName: plan.FlowName, StartedAt: res.StartedAt, FinishedAt: res.EndedAt, Stats: stressStatsOf(res)}, nil
}

// stressStatsOf keeps the CLI report's shape (integer ms, "ERR" for no response).
func stressStatsOf(r loadtest.Result) stressStats {
	statuses := map[string]int{}
	for _, step := range r.Steps {
		for code, n := range step.StatusCodes {
			statuses[code] += n
		}
	}
	groups := make([]stressErrorGroup, 0, len(r.ErrorGroups))
	for _, g := range r.ErrorGroups {
		groups = append(groups, stressErrorGroup{Code: g.Code, Message: g.Message, Count: g.Count, Status: g.Status, Steps: g.Steps})
	}
	stats := stressStats{
		Requests: r.Successful + r.Failed, Errors: r.Failed, Excluded: r.WarmupSkipped,
		Iterations: int64(r.Iterations), FailedIterations: int64(r.FailedIterations), Dropped: r.DroppedIterations,
		ElapsedMs: int64(math.Round(r.TotalTimeMs)), RPS: math.Round(r.Throughput*10) / 10,
		P50: int64(math.Round(r.P50Ms)), P95: int64(math.Round(r.P95Ms)), P99: int64(math.Round(r.P99Ms)),
		Statuses: statuses, ErrorGroups: groups, GateFailures: r.GateFailures,
	}
	if r.Apdex != nil {
		stats.Apdex, stats.ApdexTMs = r.Apdex.Score, r.Apdex.ThresholdMs
	}
	return stats
}

func renderStressResult(result stressCLIResult, reporter string) ([]byte, error) {
	switch reporter {
	case "json":
		data, err := jsonutil.Marshal(result, jsontext.WithIndent("  "))
		return append(data, '\n'), err
	case "junit":
		return renderStressJUnit(result)
	case "cli", "":
		var b strings.Builder
		fmt.Fprintf(&b, "adOmnia stress: %s\n", result.FlowName)
		fmt.Fprintf(&b, "requests: %d, errors: %d, p95: %dms, p99: %dms, rps: %.1f, APDEX: %.3f\n", result.Stats.Requests, result.Stats.Errors, result.Stats.P95, result.Stats.P99, result.Stats.RPS, result.Stats.Apdex)
		if result.Stats.Dropped > 0 {
			fmt.Fprintf(&b, "dropped: %d iterations could not start (every VU of the pool was busy)\n", result.Stats.Dropped)
		}
		for _, group := range result.Stats.ErrorGroups {
			fmt.Fprintf(&b, "error ×%d: %s\n", group.Count, group.Message)
		}
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
