package loadtest

import (
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/grpc"
	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
	"github.com/Andrea-Cavallo/adOmnia/internal/requestcontract"
)

// ScenarioFormat is the versionable scenario file, `.adomnia/loadtests/<name>.loadtest.json`:
// the app saves it, Git shares it, `adomnia stress` runs it. It holds the request as written
// ({{variables}}, auth settings), never resolved values: secrets come from the environment.
const ScenarioFormat = "adomnia-loadtest"

// ScenarioDir is where a workspace keeps its scenario files.
const ScenarioDir = ".adomnia/loadtests"

// ScenarioFile is a saved scenario.
type ScenarioFile struct {
	Format   string         `json:"format"`
	Version  int            `json:"version"`
	Name     string         `json:"name"`
	Target   ScenarioTarget `json:"target"`
	Workload Workload       `json:"workload"`
	Gates    *Gates         `json:"gates,omitempty"`
	Data     *DataRef       `json:"data,omitempty"`
}

// ScenarioTarget is one request, a flow graph or a gRPC call.
type ScenarioTarget struct {
	Kind    string                   `json:"kind"` // request | flow | grpc
	Request *requestcontract.Request `json:"request,omitempty"`
	Graph   *Graph                   `json:"graph,omitempty"`
	Grpc    *grpc.CallRequest        `json:"grpc,omitempty"`
}

// DataRef points at the dataset, relative to the workspace (the CLI: to the scenario file).
type DataRef struct {
	File string `json:"file,omitempty"`
	Mode string `json:"mode,omitempty"` // shared | per-vu | random
}

var unsafeNameChars = regexp.MustCompile(`[^\w .-]+`)

// ScenarioFileName is the file a scenario is saved as: the name with every character that
// is not a letter, digit, space, dot, dash or underscore turned into "-". A name that is
// empty or climbs out of the folder ("..") is refused.
func ScenarioFileName(name string) (string, error) {
	clean := strings.Trim(unsafeNameChars.ReplaceAllString(strings.TrimSpace(name), "-"), " .-")
	if clean == "" || strings.Contains(clean, "..") || len(clean) > 80 {
		return "", errors.New("give the scenario a name (up to 80 letters, digits, spaces, dots, dashes or underscores)")
	}
	return clean + ".loadtest.json", nil
}

// ParseScenarioFile reads and checks a scenario file.
func ParseScenarioFile(data []byte) (ScenarioFile, error) {
	var f ScenarioFile
	if err := json.Unmarshal(data, &f); err != nil {
		return f, fmt.Errorf("invalid scenario file: %w", err)
	}
	if f.Format != ScenarioFormat || f.Version != 1 {
		return f, fmt.Errorf("not an %s v1 file", ScenarioFormat)
	}
	return f, f.check()
}

func (f ScenarioFile) check() error {
	switch f.Target.Kind {
	case "request":
		if f.Target.Request == nil {
			return errors.New("the scenario's target has no request")
		}
	case "flow":
		if f.Target.Graph == nil {
			return errors.New("the scenario's target has no flow graph")
		}
	case "grpc":
		if f.Target.Grpc == nil {
			return errors.New("the scenario's target has no gRPC call")
		}
	default:
		return fmt.Errorf("unknown target kind %q (use request, flow or grpc)", f.Target.Kind)
	}
	return nil
}

// Encode is the file's content: indented, stable key order, ready for Git.
func (f ScenarioFile) Encode() ([]byte, error) {
	f.Format, f.Version = ScenarioFormat, 1
	if err := f.check(); err != nil {
		return nil, err
	}
	data, err := jsonutil.Marshal(f, jsontext.WithIndent("  "))
	return append(data, '\n'), err
}

// Scenario makes the runnable scenario. A request target runs as a one-step flow, so it goes
// through the same headless pipeline as the CLI: variables, scripts, auth, assertions.
func (f ScenarioFile) Scenario(in FlowInput) (Scenario, error) {
	if err := f.check(); err != nil {
		return Scenario{}, err
	}
	s := Scenario{Name: f.Name, Workload: f.Workload, Gates: f.Gates}
	mode := ""
	if f.Data != nil {
		mode = f.Data.Mode
	}
	switch f.Target.Kind {
	case "grpc":
		call := *f.Target.Grpc
		s.Grpc = &call
	case "request":
		label := f.Target.Request.Name
		if label == "" {
			label = f.Target.Request.Method + " " + f.Target.Request.URL
		}
		graph := Graph{Nodes: []Node{{ID: "request", Type: "request", Label: label, Config: NodeConfig{Request: f.Target.Request}}}}
		s.Flow = &Flow{Name: f.Name, Graph: graph, Vars: in.Vars, Dataset: in.Dataset, DatasetMode: mode, Transport: in.Transport}
	default:
		s.Flow = &Flow{Name: f.Name, Graph: *f.Target.Graph, Vars: in.Vars, Dataset: in.Dataset, DatasetMode: mode, Transport: in.Transport}
	}
	return s, s.Validate()
}

// ScenarioFileOf turns a CI plan (the Flow Stress export) into a scenario file.
func ScenarioFileOf(p Plan) (ScenarioFile, error) {
	w, err := p.Config.workload()
	if err != nil {
		return ScenarioFile{}, err
	}
	maxErr := 0.0
	if p.Config.MaxErrorPct != nil {
		maxErr = *p.Config.MaxErrorPct
	}
	graph := p.Graph
	f := ScenarioFile{
		Format: ScenarioFormat, Version: 1, Name: p.FlowName,
		Target:   ScenarioTarget{Kind: "flow", Graph: &graph},
		Workload: w,
		Gates:    &Gates{ApdexTMs: p.Config.ApdexTMs, MinApdex: p.Config.MinApdex, MaxP95Ms: p.Config.MaxP95Ms, MaxErrorPct: &maxErr, MinRPS: p.Config.MinRPS},
	}
	if p.Config.DatasetMode != "" {
		f.Data = &DataRef{Mode: p.Config.DatasetMode}
	}
	return f, nil
}
