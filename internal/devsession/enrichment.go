package devsession

import (
	"net/url"
	"sort"
	"strings"
)

// RuntimeComponent is a route, source file, datasource or broker topic that the
// running service actually exercised, with its call frequency and health.
type RuntimeComponent struct {
	Key    string `json:"key"`
	Kind   string `json:"kind"` // "route" | "file" | "datasource" | "topic"
	Calls  int    `json:"calls"`
	AvgMs  int64  `json:"avgMs,omitempty"`
	MaxMs  int64  `json:"maxMs,omitempty"`
	Errors int    `json:"errors,omitempty"`
}

// RuntimeEdge is a dynamic, runtime-only connection: a route that hit a source
// file, ran a query against a datasource or produced a broker message.
type RuntimeEdge struct {
	From  string `json:"from"` // route key
	To    string `json:"to"`   // component key
	Kind  string `json:"kind"` // "hit" | "query" | "message"
	Count int    `json:"count"`
}

// RuntimeEnrichment overlays the live session telemetry on the static picture:
// which components ran, how often, how slow, with what errors, and which
// static dependencies never appeared at runtime.
type RuntimeEnrichment struct {
	Service       string             `json:"service"`
	GoSessionID   string             `json:"goSessionId"`
	Components    []RuntimeComponent `json:"components"`
	Edges         []RuntimeEdge      `json:"edges"`
	UsedFunctions []string           `json:"usedFunctions"`
	UnusedModules []string           `json:"unusedModules"`
	TotalRequests int                `json:"totalRequests"`
	TotalErrors   int                `json:"totalErrors"`
}

// RuntimeEnrichment aggregates the live telemetry of a gO project's sessions.
func (m *Manager) RuntimeEnrichment(goSessionID string) RuntimeEnrichment {
	m.mu.Lock()
	sessionIDs := map[string]bool{}
	var sessions []Session
	for _, id := range m.order {
		if session := m.sessions[id]; session.GoSessionID == goSessionID {
			sessions = append(sessions, cloneSession(session))
			sessionIDs[session.ID] = true
		}
	}
	var runs []RequestRun
	for _, id := range m.runOrder {
		if run := m.runs[id]; sessionIDs[run.SessionID] {
			runs = append(runs, cloneRun(run))
		}
	}
	var queries []Query
	for _, query := range m.queries {
		if sessionIDs[query.SessionID] {
			queries = append(queries, query)
		}
	}
	var messages []Message
	for _, message := range m.messages {
		if sessionIDs[message.SessionID] {
			messages = append(messages, message)
		}
	}
	m.mu.Unlock()

	service := ""
	if len(sessions) > 0 {
		service = sessions[0].Service
	}
	return buildRuntimeEnrichment(goSessionID, service, runs, queries, messages)
}

// buildRuntimeEnrichment is pure: it turns raw telemetry into the report.
func buildRuntimeEnrichment(goSessionID, service string, runs []RequestRun, queries []Query, messages []Message) RuntimeEnrichment {
	enrichment := RuntimeEnrichment{
		GoSessionID: goSessionID, Service: service,
		Components: []RuntimeComponent{}, Edges: []RuntimeEdge{}, UsedFunctions: []string{},
	}

	routes := map[string]*RuntimeComponent{}
	routeSumMs := map[string]int64{}
	runRoute := map[string]string{}
	files := map[string]bool{}
	datasources := map[string]bool{}
	topics := map[string]bool{}
	functions := map[string]bool{}
	edges := map[string]*RuntimeEdge{}

	for _, run := range runs {
		route := routeKey(run.Method, run.URL)
		runRoute[run.ID] = route
		enrichment.TotalRequests++
		component := routes[route]
		if component == nil {
			component = &RuntimeComponent{Key: route, Kind: "route"}
			routes[route] = component
		}
		component.Calls++
		routeSumMs[route] += run.DurationMs
		if run.DurationMs > component.MaxMs {
			component.MaxMs = run.DurationMs
		}
		if run.Status >= 400 || run.Error != "" || run.State == RunError {
			component.Errors++
			enrichment.TotalErrors++
		}
		for _, hit := range run.Hits {
			file := hitKey(&hit.Frame)
			if file != "" {
				files[file] = true
				addEdge(edges, route, file, "hit")
			}
			if hit.Function != "" {
				functions[hit.Function] = true
			}
		}
	}

	for _, query := range queries {
		if query.Datasource == "" {
			continue
		}
		datasources[query.Datasource] = true
		if route, ok := runRoute[query.RequestRunID]; ok {
			addEdge(edges, route, query.Datasource, "query")
		}
	}
	for _, message := range messages {
		topic := message.Broker + "/" + message.Topic
		topics[topic] = true
		if route, ok := runRoute[message.RequestRunID]; ok {
			addEdge(edges, route, topic, "message")
		}
	}

	for key, component := range routes {
		if component.Calls > 0 {
			component.AvgMs = routeSumMs[key] / int64(component.Calls)
		}
		enrichment.Components = append(enrichment.Components, *component)
	}
	for key := range files {
		enrichment.Components = append(enrichment.Components, RuntimeComponent{Key: key, Kind: "file"})
	}
	for key := range datasources {
		enrichment.Components = append(enrichment.Components, RuntimeComponent{Key: key, Kind: "datasource"})
	}
	for key := range topics {
		enrichment.Components = append(enrichment.Components, RuntimeComponent{Key: key, Kind: "topic"})
	}
	for key := range functions {
		enrichment.UsedFunctions = append(enrichment.UsedFunctions, key)
	}
	for _, edge := range edges {
		enrichment.Edges = append(enrichment.Edges, *edge)
	}

	sortComponents(enrichment.Components)
	sort.Strings(enrichment.UsedFunctions)
	sortEdges(enrichment.Edges)
	return enrichment
}

// MarkUnusedModules flags the static modules whose packages never appeared in
// the runtime evidence (a breakpoint's fully-qualified function name is a
// reliable proof that the module's code actually ran).
func MarkUnusedModules(enrichment *RuntimeEnrichment, staticModules []string) {
	used := map[string]bool{}
	for _, function := range enrichment.UsedFunctions {
		for _, module := range staticModules {
			if module != "" && strings.HasPrefix(function, module) {
				used[module] = true
			}
		}
	}
	unused := make([]string, 0, len(staticModules))
	for _, module := range staticModules {
		if !used[module] {
			unused = append(unused, module)
		}
	}
	sort.Strings(unused)
	enrichment.UnusedModules = unused
}

func routeKey(method, rawURL string) string {
	path := rawURL
	if parsed, err := url.Parse(rawURL); err == nil && parsed.Path != "" {
		path = parsed.Path
	}
	return strings.ToUpper(strings.TrimSpace(method)) + " " + path
}

func hitKey(frame *Frame) string {
	if frame.RelativePath != "" {
		return frame.RelativePath
	}
	return frame.File
}

func addEdge(edges map[string]*RuntimeEdge, from, to, kind string) {
	key := from + "\x00" + to + "\x00" + kind
	if edge := edges[key]; edge != nil {
		edge.Count++
		return
	}
	edges[key] = &RuntimeEdge{From: from, To: to, Kind: kind, Count: 1}
}

func sortComponents(components []RuntimeComponent) {
	sort.SliceStable(components, func(left, right int) bool {
		if components[left].Kind != components[right].Kind {
			return kindOrder(components[left].Kind) < kindOrder(components[right].Kind)
		}
		return components[left].Key < components[right].Key
	})
}

func sortEdges(edges []RuntimeEdge) {
	sort.SliceStable(edges, func(left, right int) bool {
		if edges[left].From != edges[right].From {
			return edges[left].From < edges[right].From
		}
		if edges[left].To != edges[right].To {
			return edges[left].To < edges[right].To
		}
		return edges[left].Kind < edges[right].Kind
	})
}

func kindOrder(kind string) int {
	switch kind {
	case "route":
		return 0
	case "file":
		return 1
	case "datasource":
		return 2
	case "topic":
		return 3
	}
	return 4
}
