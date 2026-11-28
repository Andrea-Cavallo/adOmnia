package loadtest

import (
	"crypto/sha256"
	"encoding/hex"
	"regexp"
	"runtime"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
)

// Manifest is the conditions a run was made in: two runs with the same ScenarioHash tested
// the same thing, and the rest says whether they can be compared.
type Manifest struct {
	AppVersion   string            `json:"appVersion"`
	Commit       string            `json:"commit,omitempty"`
	ScenarioHash string            `json:"scenarioHash"`
	DatasetHash  string            `json:"datasetHash,omitempty"`
	DatasetRows  int               `json:"datasetRows,omitzero"`
	Seed         uint64            `json:"seed"`
	Target       string            `json:"target"` // request | flow | grpc
	TargetLabel  string            `json:"targetLabel"`
	OS           string            `json:"os"`
	Arch         string            `json:"arch"`
	CPUs         int               `json:"cpus"`
	GoVersion    string            `json:"goVersion"`
	Vars         map[string]string `json:"vars,omitempty"` // secrets as ***
	// Saturated: the generator started iterations late (scheduler p99 > 10 ms), so its own
	// delay is in the latencies and the run is not reliable.
	Saturated bool `json:"saturated,omitzero"`
}

// Build information of the binary, set by main (app) and the CLI.
var (
	BuildVersion = "dev"
	BuildCommit  = ""
)

var secretName = regexp.MustCompile(`(?i)secret|token|pass(word|wd|phrase)?|api[-_]?key|auth|cookie|session|credential|private|signature`)

// maskVars keeps the variable names and hides every value that could be a secret.
func maskVars(vars map[string]string) map[string]string {
	if len(vars) == 0 {
		return nil
	}
	out := make(map[string]string, len(vars))
	for k, v := range vars {
		if secretName.MatchString(k) || strings.HasPrefix(v, "vault:") || len(v) > 64 {
			v = "***"
		}
		out[k] = v
	}
	return out
}

// scenarioHash identifies what was tested: target, workload and gates. Values that change
// from run to run (resolved auth headers, environment, data rows) are left out.
func scenarioHash(s Scenario) string {
	shape := struct {
		Name     string   `json:"name"`
		Method   string   `json:"method,omitempty"`
		URL      string   `json:"url,omitempty"`
		Body     string   `json:"body,omitempty"`
		Graph    *Graph   `json:"graph,omitempty"`
		Mode     string   `json:"datasetMode,omitempty"`
		Grpc     []string `json:"grpc,omitempty"`
		Payload  string   `json:"payload,omitempty"`
		Workload Workload `json:"workload"`
		Gates    *Gates   `json:"gates,omitempty"`
	}{Name: s.Name, Workload: s.Workload, Gates: s.Gates}
	shape.Workload.Seed = 0 // the seed is recorded on its own
	switch {
	case s.Request != nil:
		shape.Method, shape.URL, shape.Body = s.Request.Method, s.Request.URL, s.Request.Body
	case s.Flow != nil:
		shape.Graph, shape.Mode = &s.Flow.Graph, s.Flow.DatasetMode
	case s.Grpc != nil:
		shape.Grpc, shape.Payload = []string{s.Grpc.Address, s.Grpc.Service, s.Grpc.Method}, string(s.Grpc.Payload)
	}
	return hashJSON(shape)
}

func hashJSON(v any) string {
	data, err := jsonutil.Marshal(v) // sorted keys
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func newManifest(s Scenario) *Manifest {
	m := &Manifest{
		AppVersion: BuildVersion, Commit: BuildCommit, ScenarioHash: scenarioHash(s), Seed: s.Workload.Seed,
		OS: runtime.GOOS, Arch: runtime.GOARCH, CPUs: runtime.NumCPU(), GoVersion: runtime.Version(),
	}
	switch {
	case s.Request != nil:
		m.Target, m.TargetLabel = "request", s.Request.Method+" "+s.Request.URL
	case s.Flow != nil:
		m.Target, m.TargetLabel = "flow", s.Flow.Name
		m.Vars = maskVars(s.Flow.Vars)
		if n := len(s.Flow.Dataset); n > 0 {
			m.DatasetHash, m.DatasetRows = hashJSON(s.Flow.Dataset), n
		}
	case s.Grpc != nil:
		m.Target, m.TargetLabel = "grpc", s.Grpc.Service+"/"+s.Grpc.Method
	}
	if m.TargetLabel == "" || m.TargetLabel == " " {
		m.TargetLabel = s.Name
	}
	return m
}
