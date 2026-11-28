package loadtest

import (
	"context"
	"encoding/json/v2"
	"errors"
	"fmt"
	"maps"
	"strconv"
	"strings"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/headless"
	"github.com/Andrea-Cavallo/adOmnia/internal/httpexec"
	"github.com/Andrea-Cavallo/adOmnia/internal/requestcontract"
)

// Flow is a Flow Builder graph run by every VU, with the variables and data it starts from.
// Its JSON is the graph the Flow Builder writes (and the CI plan exports).
type Flow struct {
	Name        string              `json:"name,omitempty"`
	Graph       Graph               `json:"graph"`
	Vars        map[string]string   `json:"vars,omitempty"` // environment, vault already resolved
	Dataset     []map[string]string `json:"dataset,omitempty"`
	DatasetMode string              `json:"datasetMode,omitempty"` // shared (default) | per-vu | random
	Transport   *Transport          `json:"transport,omitempty"`
}

// Transport carries the app's request settings onto every step (the CLI has none).
type Transport struct {
	SkipTLSVerify        bool                    `json:"skipTlsVerify,omitzero"`
	ClientCertPEM        string                  `json:"clientCertPem,omitempty"`
	ClientCertPassphrase string                  `json:"clientCertPassphrase,omitempty"`
	HostsMap             []httpexec.HostMapEntry `json:"hostsMap,omitempty"`
}

type Graph struct {
	Nodes    []Node `json:"nodes"`
	Edges    []Edge `json:"edges"`
	Settings struct {
		MaxSteps int `json:"maxSteps,omitzero"`
	} `json:"settings"`
}

type Node struct {
	ID     string     `json:"id"`
	Type   string     `json:"type"` // start | request | condition | extract | end
	Label  string     `json:"label"`
	Config NodeConfig `json:"config"`
}

type NodeConfig struct {
	Request        *requestcontract.Request `json:"request,omitempty"`
	ExpectedStatus string                   `json:"expectedStatus,omitempty"`
	RetryCount     int                      `json:"retryCount,omitzero"`
	DelayMs        int                      `json:"delayMs,omitzero"`
	Extractions    []Mapping                `json:"extractions,omitempty"`
	Condition      *Condition               `json:"condition,omitempty"`
	EndState       string                   `json:"endState,omitempty"`
}

type Mapping struct {
	Name     string `json:"name"`
	Source   string `json:"source"` // status | header | body | expression
	Path     string `json:"path"`
	Fallback string `json:"fallback"`
}

type Condition struct {
	Source   string `json:"source"` // status | variable | header | body
	Path     string `json:"path"`
	Operator string `json:"operator"`
	Value    string `json:"value"`
}

type Edge struct {
	Source string `json:"source"`
	Target string `json:"target"`
	Branch string `json:"branch"` // next | success | error | true | false | else
}

const defaultMaxSteps = 80

// validate rejects a graph that cannot run, before any VU starts.
func (f *Flow) validate() error {
	g := f.Graph
	if len(g.Nodes) == 0 {
		return errors.New("the flow has no nodes")
	}
	known := make(map[string]bool, len(g.Nodes))
	requests := 0
	for i, n := range g.Nodes {
		if strings.TrimSpace(n.ID) == "" || strings.TrimSpace(n.Type) == "" {
			return fmt.Errorf("node %d has no id or type", i+1)
		}
		if known[n.ID] {
			return fmt.Errorf("duplicate node id %q", n.ID)
		}
		switch n.Type {
		case "start", "condition", "extract", "end":
		case "request":
			requests++
		default:
			return fmt.Errorf("node %q has unsupported type %q", n.ID, n.Type)
		}
		known[n.ID] = true
	}
	for _, e := range g.Edges {
		if !known[e.Source] || !known[e.Target] {
			return fmt.Errorf("edge %q -> %q references an unknown node", e.Source, e.Target)
		}
	}
	if requests == 0 {
		return errors.New("the flow has no request step")
	}
	if g.entry() == "" {
		return errors.New("the flow has no entry point: add a start node")
	}
	switch f.DatasetMode {
	case "", "shared", "per-vu", "random":
	default:
		return fmt.Errorf("unknown dataset mode %q", f.DatasetMode)
	}
	return nil
}

// entry is the start node, or else the first node nothing points to.
func (g Graph) entry() string {
	for _, n := range g.Nodes {
		if n.Type == "start" {
			return n.ID
		}
	}
	incoming := map[string]bool{}
	for _, e := range g.Edges {
		incoming[e.Target] = true
	}
	for _, n := range g.Nodes {
		if !incoming[n.ID] {
			return n.ID
		}
	}
	return ""
}

func (g Graph) next(source, branch string) string {
	for _, e := range g.Edges {
		if e.Source == source && e.Branch == branch {
			return e.Target
		}
	}
	for _, e := range g.Edges {
		if e.Source == source && (e.Branch == "next" || e.Branch == "else") {
			return e.Target
		}
	}
	return ""
}

// flowTarget runs the graph once per iteration with its own variables and cookie jar.
type flowTarget struct {
	flow  *Flow
	nodes map[string]Node
	pool  *httpexec.Pool
	seed  uint64
}

func newFlowTarget(f *Flow, pool *httpexec.Pool, seed uint64) *flowTarget {
	nodes := make(map[string]Node, len(f.Graph.Nodes))
	for _, n := range f.Graph.Nodes {
		nodes[n.ID] = n
	}
	return &flowTarget{flow: f, nodes: nodes, pool: pool, seed: seed}
}

func (t *flowTarget) iterate(ctx context.Context, vu, iteration int) ([]sample, bool) {
	vars := t.vars(vu, iteration)
	jarID := fmt.Sprintf("loadtest-%p-%d-%d", t, vu, iteration)
	defer httpexec.ClearCookieJar(jarID)

	maxSteps := t.flow.Graph.Settings.MaxSteps
	if maxSteps <= 0 {
		maxSteps = defaultMaxSteps
	}
	var (
		samples []sample
		failed  bool
		last    httpexec.HTTPExecResponse
	)
	current := t.flow.Graph.entry()
	for step := 0; step < maxSteps && current != "" && ctx.Err() == nil; step++ {
		node := t.nodes[current]
		branch := "next"
		switch node.Type {
		case "end":
			return samples, failed || node.Config.EndState == "failed"
		case "request":
			s, resp := t.request(ctx, node, vars, jarID)
			samples = append(samples, s)
			if s.canceled {
				return samples, failed
			}
			if s.ok() {
				branch, last = "success", resp
				applyMappings(node.Config.Extractions, resp, vars)
			} else {
				failed, branch = true, "error"
			}
		case "condition":
			branch = "false"
			if evaluateCondition(node.Config.Condition, last, vars) {
				branch = "true"
			}
		case "extract":
			// A recorded script step: it only materialises variables.
			applyMappings(node.Config.Extractions, last, vars)
		}
		current = t.flow.Graph.next(current, branch)
	}
	return samples, failed
}

// request runs one step with its retries; only the last attempt is a sample.
func (t *flowTarget) request(ctx context.Context, node Node, vars map[string]string, jarID string) (sample, httpexec.HTTPExecResponse) {
	name := node.Label
	if name == "" {
		name = node.ID
	}
	if node.Config.Request == nil {
		return sample{stepID: node.ID, step: name, started: time.Now(), errCode: "FAILED", errMsg: "the step has no request"}, httpexec.HTTPExecResponse{}
	}
	if node.Config.DelayMs > 0 && !sleepCtx(ctx, time.Duration(node.Config.DelayMs)*time.Millisecond) {
		return sample{stepID: node.ID, step: name, canceled: true}, httpexec.HTTPExecResponse{}
	}
	var (
		s    sample
		resp httpexec.HTTPExecResponse
	)
	for attempt := 0; attempt <= node.Config.RetryCount; attempt++ {
		s, resp = t.attempt(ctx, name, node, vars, jarID)
		if s.ok() || s.canceled {
			break
		}
	}
	return s, resp
}

func (t *flowTarget) attempt(ctx context.Context, name string, node Node, vars map[string]string, jarID string) (sample, httpexec.HTTPExecResponse) {
	started := time.Now()
	expected := node.Config.ExpectedStatus
	out := headless.Execute(ctx, *node.Config.Request, vars, headless.Options{
		JarID:  jarID,
		Send:   t.pool.Execute,
		Adjust: t.adjust,
		Validate: func(resp httpexec.HTTPExecResponse) string {
			if expectedStatus(expected, resp.Status) {
				return ""
			}
			if strings.TrimSpace(expected) == "" {
				expected = "2xx"
			}
			return fmt.Sprintf("expected %s, got HTTP %d", expected, resp.Status)
		},
	})
	s := sample{stepID: node.ID, step: name, started: started, latency: out.Latency, status: out.Response.Status, bytes: int64(out.Response.Size), sent: out.Sent}
	switch {
	case out.Response.Error != nil:
		s.errCode, s.errMsg = out.Response.Error.Code, out.Response.Error.Message
		s.canceled = s.errCode == "CANCELED" && ctx.Err() != nil
	case out.Skipped != "":
		s.errCode, s.errMsg = "SKIPPED", out.Skipped
	case out.Error != "":
		s.errCode, s.errMsg = "FAILED", out.Error
		if s.status >= 400 && strings.HasPrefix(out.Error, "expected ") {
			s.errCode = "HTTP" // grouped as HTTP_4xx / HTTP_5xx
		}
	}
	if !s.sent {
		s.started = time.Now() // nothing went out: no latency, a point at the time of failure
	}
	return s, out.Response
}

// adjust puts the app's transport settings and a pooled-friendly id on every step.
func (t *flowTarget) adjust(p *httpexec.HTTPExecRequest) {
	p.ID = "" // no external cancel registration: the run's context cancels
	tr := t.flow.Transport
	if tr == nil {
		return
	}
	p.SkipTLSVerify = p.SkipTLSVerify || tr.SkipTLSVerify
	if p.ClientCertPEM == "" {
		p.ClientCertPEM, p.ClientCertPassphrase = tr.ClientCertPEM, tr.ClientCertPassphrase
	}
	if len(p.HostsMap) == 0 {
		p.HostsMap = tr.HostsMap
	}
}

// vars is the starting context of one iteration: environment, dataset row, built-ins.
func (t *flowTarget) vars(vu, iteration int) map[string]string {
	vars := maps.Clone(t.flow.Vars)
	if vars == nil {
		vars = map[string]string{}
	}
	rnd := iterationRand(t.seed, vu, iteration)
	if rows := t.flow.Dataset; len(rows) > 0 {
		index := iteration % len(rows)
		switch t.flow.DatasetMode {
		case "per-vu":
			index = vu % len(rows)
		case "random":
			index = rnd.IntN(len(rows))
		}
		maps.Copy(vars, rows[index])
	}
	vars["__vu"] = strconv.Itoa(vu + 1)
	vars["__iteration"] = strconv.Itoa(iteration + 1)
	vars["__timestamp"] = strconv.FormatInt(time.Now().UnixMilli(), 10)
	vars["__uuid"] = seededUUID(rnd)
	return vars
}

func expectedStatus(expected string, status int) bool {
	expected = strings.ToLower(strings.TrimSpace(expected))
	if expected == "" || expected == "2xx" {
		return status >= 200 && status < 300
	}
	if len(expected) == 3 && strings.HasSuffix(expected, "xx") {
		digit, err := strconv.Atoi(expected[:1])
		return err == nil && status/100 == digit
	}
	value, err := strconv.Atoi(expected)
	return err == nil && status == value
}

func applyMappings(mappings []Mapping, resp httpexec.HTTPExecResponse, vars map[string]string) {
	for _, m := range mappings {
		if m.Name == "" {
			continue
		}
		value := m.Fallback
		switch m.Source {
		case "status":
			value = strconv.Itoa(resp.Status)
		case "header":
			if v, ok := header(resp, m.Path); ok {
				value = v
			}
		case "body", "expression":
			if v, ok := jsonPath(resp.Body, m.Path); ok {
				value = fmt.Sprint(v)
			}
		}
		vars[m.Name] = value
	}
}

func header(resp httpexec.HTTPExecResponse, name string) (string, bool) {
	for k, v := range resp.Headers {
		if strings.EqualFold(k, name) {
			return v, true
		}
	}
	return "", false
}

// jsonPath reads a dotted path ($.a.b) from a JSON body.
func jsonPath(body, path string) (any, bool) {
	var value any
	if json.Unmarshal([]byte(body), &value) != nil {
		return nil, false
	}
	path = strings.TrimPrefix(strings.TrimPrefix(strings.TrimSpace(path), "$"), ".")
	if path == "" {
		return value, true
	}
	for part := range strings.SplitSeq(path, ".") {
		object, ok := value.(map[string]any)
		if !ok {
			return nil, false
		}
		if value, ok = object[part]; !ok {
			return nil, false
		}
	}
	return value, true
}

func evaluateCondition(c *Condition, resp httpexec.HTTPExecResponse, vars map[string]string) bool {
	if c == nil {
		return false
	}
	actual := ""
	switch c.Source {
	case "status":
		actual = strconv.Itoa(resp.Status)
	case "variable":
		actual = vars[c.Path]
	case "header":
		actual, _ = header(resp, c.Path)
	default:
		if v, ok := jsonPath(resp.Body, c.Path); ok {
			actual = fmt.Sprint(v)
		}
	}
	switch c.Operator {
	case "exists":
		return actual != ""
	case "not_exists":
		return actual == ""
	case "neq":
		return actual != c.Value
	case "contains":
		return strings.Contains(actual, c.Value)
	case "gt", "lt", "gte", "lte":
		return compareNumbers(c.Operator, actual, c.Value)
	default:
		return actual == c.Value
	}
}

func compareNumbers(op, left, right string) bool {
	l, errL := strconv.ParseFloat(left, 64)
	r, errR := strconv.ParseFloat(right, 64)
	if errL != nil || errR != nil {
		return false
	}
	switch op {
	case "gt":
		return l > r
	case "lt":
		return l < r
	case "gte":
		return l >= r
	default:
		return l <= r
	}
}
