package loadtest

import (
	"errors"
	"fmt"
)

// PlanFormat is the CI plan the Flow Builder exports (Stress dock → CI plan) and
// `adomnia stress` reads. The app runs the very same plan, so both report alike.
const PlanFormat = "adomnia-flow-stress-plan"

// Plan is a flow with its Flow Stress configuration.
type Plan struct {
	Format   string       `json:"format"`
	Version  int          `json:"version"`
	FlowName string       `json:"flowName"`
	Graph    Graph        `json:"graph"`
	Config   StressConfig `json:"config"`
}

// StressConfig is the workload as the Flow Stress dock describes it.
type StressConfig struct {
	VUs         int           `json:"vus"`
	RampUpS     float64       `json:"rampUpS,omitzero"`
	Mode        string        `json:"mode"`         // iterations | duration | stages | rate
	RPS         float64       `json:"rps,omitzero"` // rate: iterations started per second; VUs is the pool
	Iterations  int           `json:"iterations,omitzero"`
	DurationS   float64       `json:"durationS,omitzero"`
	ThinkTimeMs int           `json:"thinkTimeMs,omitzero"`
	WarmupS     float64       `json:"warmupS,omitzero"`
	Stages      []StressStage `json:"stages,omitempty"`
	DatasetMode string        `json:"datasetMode,omitempty"`
	ApdexTMs    float64       `json:"apdexTMs,omitzero"`
	MinApdex    float64       `json:"minApdex,omitzero"`
	MaxP95Ms    float64       `json:"maxP95Ms,omitzero"`
	MaxErrorPct *float64      `json:"maxErrorPct,omitempty"` // absent = no error tolerated
	MinRPS      float64       `json:"minRps,omitzero"`
}

// StressStage holds TargetVUs after reaching it in RampS seconds.
type StressStage struct {
	Label     string  `json:"label"`
	DurationS float64 `json:"durationS"`
	TargetVUs int     `json:"targetVus"`
	RampS     float64 `json:"rampS"`
	Measure   bool    `json:"measure"`
}

// FlowInput is what the caller adds to a plan: variables, data rows and, in the app, the
// transport settings.
type FlowInput struct {
	Vars      map[string]string   `json:"vars,omitempty"`
	Dataset   []map[string]string `json:"dataset,omitempty"`
	Transport *Transport          `json:"transport,omitempty"`
}

// Scenario turns the plan into an engine scenario.
func (p Plan) Scenario(in FlowInput) (Scenario, error) {
	if p.Format != PlanFormat || p.Version != 1 {
		return Scenario{}, errors.New("invalid or unsupported stress plan")
	}
	w, err := p.Config.workload()
	if err != nil {
		return Scenario{}, err
	}
	maxErr := 0.0
	if p.Config.MaxErrorPct != nil {
		maxErr = *p.Config.MaxErrorPct
	}
	s := Scenario{
		Name:     p.FlowName,
		Flow:     &Flow{Name: p.FlowName, Graph: p.Graph, Vars: in.Vars, Dataset: in.Dataset, DatasetMode: p.Config.DatasetMode, Transport: in.Transport},
		Workload: w,
		Gates:    &Gates{ApdexTMs: p.Config.ApdexTMs, MinApdex: p.Config.MinApdex, MaxP95Ms: p.Config.MaxP95Ms, MaxErrorPct: &maxErr, MinRPS: p.Config.MinRPS},
	}
	return s, s.Validate()
}

// workload maps the three Flow Stress modes. A ramp-up outside stages starts the VUs one
// after the other over RampUpS seconds: a first stage that ramps, then holds.
func (c StressConfig) workload() (Workload, error) {
	w := Workload{Executor: ExecutorVUs, ThinkTimeMs: c.ThinkTimeMs, WarmupS: c.WarmupS}
	switch c.Mode {
	case "iterations":
		if c.Iterations < 1 {
			return w, errors.New("iterations must be at least 1")
		}
		w.Iterations = c.Iterations
		if c.RampUpS > 0 {
			// Hold until the iterations run out; the stage only shapes the ramp.
			w.Stages = []Stage{{DurationS: MaxDurationS, TargetVUs: c.VUs, RampS: new(c.RampUpS)}}
		} else {
			w.VUs = c.VUs
		}
	case "duration":
		if c.DurationS <= 0 {
			return w, errors.New("duration must be positive")
		}
		if c.RampUpS > 0 {
			w.Stages = []Stage{{DurationS: c.DurationS, TargetVUs: c.VUs, RampS: new(min(c.RampUpS, c.DurationS))}}
		} else {
			w.VUs, w.DurationS = c.VUs, c.DurationS
		}
	case "stages":
		if len(c.Stages) == 0 {
			return w, errors.New("a staged workload needs at least one stage")
		}
		peak := 0
		for _, st := range c.Stages {
			w.Stages = append(w.Stages, Stage{Label: st.Label, DurationS: st.DurationS, TargetVUs: st.TargetVUs, RampS: new(st.RampS), Unmeasured: !st.Measure})
			peak = max(peak, st.TargetVUs)
		}
		if peak < 1 {
			return w, errors.New("at least one stage must target one or more virtual users")
		}
	case "rate":
		// Open model: the flow starts RPS times a second from a pool of up to VUs.
		w = Workload{Executor: ExecutorArrivalRate, MaxVUs: c.VUs, WarmupS: c.WarmupS}
		if c.RampUpS > 0 {
			w.Stages = []Stage{{Label: "ramp", DurationS: c.RampUpS, TargetRPS: c.RPS}, {DurationS: c.DurationS, TargetRPS: c.RPS}}
			w.WarmupS = max(w.WarmupS, c.RampUpS) // the ramp is not measured, as in the other modes
		} else {
			w.RPS, w.DurationS = c.RPS, c.DurationS
		}
	default:
		return w, fmt.Errorf("unknown mode %q (use iterations, duration, stages or rate)", c.Mode)
	}
	return w, nil
}
