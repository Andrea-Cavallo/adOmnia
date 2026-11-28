package loadtest

import (
	"errors"
	"fmt"
	"net/url"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/httpexec"
)

// Executors.
const (
	ExecutorVUs   = "vus"   // closed model: N virtual users repeat the request
	ExecutorProbe = "probe" // N single requests at once, or a fixed gap apart
)

// Limits of one run. They protect the machine running adOmnia, not the target.
const (
	MaxVUs          = 2000
	MaxProbeCount   = 2000
	MaxDurationS    = 24 * 60 * 60
	MaxGapMs        = 60_000
	maxThinkTimeMs  = 60_000
	maxTimelineSize = 20_000 // per-request points kept for the waterfall and the raw log
)

// Scenario is everything a run needs. It is the unit that LT-4 saves as a workspace file.
// The target is either one Request (resolved by the app: auth, cookies, TLS already applied)
// or a Flow (a graph whose steps the engine resolves headless, like `adomnia stress`).
type Scenario struct {
	Name     string                    `json:"name,omitempty"`
	Request  *httpexec.HTTPExecRequest `json:"request,omitempty"`
	Flow     *Flow                     `json:"flow,omitempty"`
	Workload Workload                  `json:"workload"`
	Gates    *Gates                    `json:"gates,omitempty"`
}

// Gates are the pass/fail rules of a run, evaluated on the measured requests.
type Gates struct {
	ApdexTMs    float64  `json:"apdexTMs,omitzero"`    // APDEX threshold T, default 500 ms
	MinApdex    float64  `json:"minApdex,omitzero"`    // 0 disables
	MaxP95Ms    float64  `json:"maxP95Ms,omitzero"`    // 0 disables
	MaxErrorPct *float64 `json:"maxErrorPct,omitzero"` // nil disables; 0 means no error tolerated
	MinRPS      float64  `json:"minRps,omitzero"`      // 0 disables
}

// Workload says how the requests are generated.
type Workload struct {
	Executor string `json:"executor"`

	// vus: constant VUs (with DurationS and/or Iterations) or Stages.
	VUs              int     `json:"vus,omitzero"`
	DurationS        float64 `json:"durationS,omitzero"`
	Iterations       int     `json:"iterations,omitzero"` // total across VUs; 0 = until time runs out
	Stages           []Stage `json:"stages,omitempty"`
	WarmupIterations int     `json:"warmupIterations,omitzero"` // the first N are sent but not measured
	WarmupS          float64 `json:"warmupS,omitzero"`          // without stages: the first S seconds are not measured
	ThinkTimeMs      int     `json:"thinkTimeMs,omitzero"`      // pause of a VU between iterations

	// probe
	Count int `json:"count,omitzero"`
	GapMs int `json:"gapMs,omitzero"`
}

// Stage moves from the previous stage's target (0 for the first) to TargetVUs: linearly over
// the whole stage, or — with RampS — over the first RampS seconds, then holds (0 = jump).
type Stage struct {
	Label      string   `json:"label,omitempty"`
	DurationS  float64  `json:"durationS"`
	TargetVUs  int      `json:"targetVUs"`
	RampS      *float64 `json:"rampS,omitempty"`
	Unmeasured bool     `json:"unmeasured,omitzero"` // warm-up or cool-down: sent, not measured
}

// Validate rejects a scenario that cannot run, with a reason the UI can show as is.
func (s Scenario) Validate() error {
	switch {
	case s.Request != nil && s.Flow != nil:
		return errors.New("a scenario targets a request or a flow, not both")
	case s.Flow != nil:
		if err := s.Flow.validate(); err != nil {
			return err
		}
	case s.Request != nil:
		if err := validateTarget(*s.Request); err != nil {
			return err
		}
	default:
		return errors.New("nothing to test: the scenario has no request and no flow")
	}
	w := s.Workload
	if w.ThinkTimeMs < 0 || w.ThinkTimeMs > maxThinkTimeMs {
		return fmt.Errorf("think time must be between 0 and %d ms", maxThinkTimeMs)
	}
	switch w.Executor {
	case ExecutorProbe:
		if w.Count < 1 || w.Count > MaxProbeCount {
			return fmt.Errorf("probe count must be between 1 and %d", MaxProbeCount)
		}
		if w.GapMs < 0 || w.GapMs > MaxGapMs {
			return fmt.Errorf("gap must be between 0 and %d ms", MaxGapMs)
		}
		return nil
	case ExecutorVUs:
		return validateVUs(w)
	default:
		return fmt.Errorf("unknown executor %q (use %q or %q)", w.Executor, ExecutorVUs, ExecutorProbe)
	}
}

func validateTarget(req httpexec.HTTPExecRequest) error {
	raw := strings.TrimSpace(req.URL)
	if raw == "" {
		return errors.New("URL is empty")
	}
	if strings.Contains(raw, "{{") {
		return errors.New("the URL still contains an unresolved {{variable}}")
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return fmt.Errorf("%q is not an http(s) URL", raw)
	}
	return nil
}

func validateVUs(w Workload) error {
	if w.WarmupIterations < 0 {
		return errors.New("warm-up iterations cannot be negative")
	}
	if w.Iterations < 0 {
		return errors.New("iterations cannot be negative")
	}
	if w.WarmupS < 0 {
		return errors.New("warm-up cannot be negative")
	}
	if w.Iterations > 0 && w.WarmupIterations >= w.Iterations {
		return errors.New("warm-up must be smaller than the iterations, or nothing is measured")
	}
	if len(w.Stages) == 0 {
		if w.VUs < 1 || w.VUs > MaxVUs {
			return fmt.Errorf("virtual users must be between 1 and %d", MaxVUs)
		}
		if w.DurationS <= 0 && w.Iterations == 0 {
			return errors.New("set a duration, a number of iterations or stages")
		}
		if w.WarmupS < 0 || (w.DurationS > 0 && w.WarmupS >= w.DurationS) {
			return errors.New("the warm-up must be shorter than the duration, or nothing is measured")
		}
		if w.DurationS > MaxDurationS {
			return fmt.Errorf("duration cannot exceed %d s", MaxDurationS)
		}
		return nil
	}
	total := 0.0
	for i, st := range w.Stages {
		if st.DurationS <= 0 {
			return fmt.Errorf("stage %d: duration must be positive", i+1)
		}
		if st.TargetVUs < 0 || st.TargetVUs > MaxVUs {
			return fmt.Errorf("stage %d: target VUs must be between 0 and %d", i+1, MaxVUs)
		}
		if st.RampS != nil && (*st.RampS < 0 || *st.RampS > st.DurationS) {
			return fmt.Errorf("stage %d: the ramp must fit inside the stage", i+1)
		}
		total += st.DurationS
	}
	if total > MaxDurationS {
		return fmt.Errorf("stages cannot exceed %d s in total", MaxDurationS)
	}
	return nil
}
