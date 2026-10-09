package otlp

import (
	"net/url"
	"sort"
	"strconv"
)

// MapNode is a service, a datastore, a topic or an external endpoint seen in the traces.
type MapNode struct {
	ID    string `json:"id"`
	Kind  string `json:"kind"` // service | database | topic | external
	Label string `json:"label"`
	// System is the db/messaging system (postgresql, redis, kafka…) when known.
	System string `json:"system,omitempty"`
}

// MapEdge aggregates the calls observed from one node to another.
type MapEdge struct {
	From   string `json:"from"`
	To     string `json:"to"`
	Kind   string `json:"kind"` // http | rpc | db | messaging
	Calls  int    `json:"calls"`
	Errors int    `json:"errors"`
	// Retries counts calls that repeat an earlier attempt (see isRetry).
	Retries    int     `json:"retries"`
	P50Ms      float64 `json:"p50Ms"`
	P95Ms      float64 `json:"p95Ms"`
	RatePerMin float64 `json:"ratePerMin"`
	// A sample trace and the code that makes the call, to jump from the map.
	SampleTraceID string `json:"sampleTraceId,omitempty"`
	ErrorTraceID  string `json:"errorTraceId,omitempty"`
	SourceFile    string `json:"sourceFile,omitempty"`
	SourceLine    int    `json:"sourceLine,omitempty"`
	// The handler that answers the call, from the server span of the callee.
	HandlerFile string `json:"handlerFile,omitempty"`
	HandlerLine int    `json:"handlerLine,omitempty"`
	// Consumer side of a topic: the group and the brokers it reads from, to ask for its lag.
	Group   string `json:"group,omitempty"`
	Brokers string `json:"brokers,omitempty"`
}

type ServiceMap struct {
	Nodes []MapNode `json:"nodes"`
	Edges []MapEdge `json:"edges"`
	// WindowMs is the time span the rates refer to.
	WindowMs float64 `json:"windowMs"`
}

func firstAttr(attrs map[string]string, keys ...string) string {
	for _, key := range keys {
		if value := attrs[key]; value != "" {
			return value
		}
	}
	return ""
}

// externalHost names the peer of an outgoing call that no received span answered.
func externalHost(attrs map[string]string) string {
	if host := firstAttr(attrs, "server.address", "net.peer.name", "peer.service", "http.host"); host != "" {
		if port := firstAttr(attrs, "server.port", "net.peer.port"); port != "" {
			return host + ":" + port
		}
		return host
	}
	if raw := firstAttr(attrs, "url.full", "http.url"); raw != "" {
		if parsed, err := url.Parse(raw); err == nil && parsed.Host != "" {
			return parsed.Host
		}
	}
	return "external"
}

// ServiceMap derives who calls whom from the stored spans: cross-service parent/child for
// HTTP and RPC, db.* attributes for datastores, messaging.* for topics.
func (s *Store) ServiceMap() ServiceMap {
	type edgeData struct {
		edge      MapEdge
		durations []float64
	}
	nodes := map[string]MapNode{}
	edges := map[string]*edgeData{}
	minStart, maxEnd := 0.0, 0.0
	addNode := func(node MapNode) { nodes[node.ID] = node }
	retry := map[string]bool{}
	addCall := func(from, to, kind string, span Span) *MapEdge {
		key := from + "\x00" + to + "\x00" + kind
		data := edges[key]
		if data == nil {
			data = &edgeData{edge: MapEdge{From: from, To: to, Kind: kind}}
			edges[key] = data
		}
		data.edge.Calls++
		if retry[span.SpanID] {
			data.edge.Retries++
		}
		data.durations = append(data.durations, span.DurationMs)
		if data.edge.SampleTraceID == "" {
			data.edge.SampleTraceID = span.TraceID
		}
		if span.StatusCode == "ERROR" {
			data.edge.Errors++
			data.edge.ErrorTraceID = span.TraceID
		}
		if data.edge.SourceFile == "" {
			if file := firstAttr(span.Attributes, "code.filepath", "code.file.path"); file != "" {
				data.edge.SourceFile = file
				data.edge.SourceLine, _ = strconv.Atoi(firstAttr(span.Attributes, "code.lineno", "code.line.number"))
			}
		}
		return &data.edge
	}

	s.mu.RLock()
	for _, spans := range s.traces {
		children := map[string][]Span{}
		for _, span := range spans {
			children[span.ParentSpanID] = append(children[span.ParentSpanID], span)
			if minStart == 0 || span.StartMs < minStart {
				minStart = span.StartMs
			}
			if end := span.StartMs + span.DurationMs; end > maxEnd {
				maxEnd = end
			}
		}
		for id := range retryIDs(spans) {
			retry[id] = true
		}
		for _, span := range spans {
			service := "svc:" + span.Service
			addNode(MapNode{ID: service, Kind: "service", Label: span.Service})
			switch {
			case span.Category == "db":
				system := firstAttr(span.Attributes, "db.system.name", "db.system")
				name := firstAttr(span.Attributes, "db.namespace", "db.name")
				label := system
				if name != "" {
					label = system + " · " + name
				}
				id := "db:" + label
				addNode(MapNode{ID: id, Kind: "database", Label: label, System: system})
				addCall(service, id, "db", span)
			case span.Category == "messaging":
				system := span.Attributes["messaging.system"]
				topic := firstAttr(span.Attributes, "messaging.destination.name", "messaging.destination")
				if topic == "" {
					topic = system
				}
				id := "topic:" + topic
				addNode(MapNode{ID: id, Kind: "topic", Label: topic, System: system})
				if span.Kind == "consumer" {
					edge := addCall(id, service, "messaging", span)
					if group := firstAttr(span.Attributes, "messaging.consumer.group.name", "messaging.kafka.consumer.group", "messaging.kafka.consumer_group"); group != "" && edge.Group == "" {
						edge.Group = group
					}
					if host := firstAttr(span.Attributes, "server.address", "net.peer.name"); host != "" && edge.Brokers == "" {
						if port := firstAttr(span.Attributes, "server.port", "net.peer.port"); port != "" {
							host += ":" + port
						}
						edge.Brokers = host
					}
				} else {
					addCall(service, id, "messaging", span)
				}
			case span.Kind == "client" && (span.Category == "http" || span.Category == "rpc"):
				answered := false
				for _, child := range children[span.SpanID] {
					if child.Kind == "server" && child.Service != span.Service {
						addNode(MapNode{ID: "svc:" + child.Service, Kind: "service", Label: child.Service})
						edge := addCall(service, "svc:"+child.Service, span.Category, span)
						if file := firstAttr(child.Attributes, "code.filepath", "code.file.path"); file != "" && edge.HandlerFile == "" {
							edge.HandlerFile = file
							edge.HandlerLine, _ = strconv.Atoi(firstAttr(child.Attributes, "code.lineno", "code.line.number"))
						}
						answered = true
					}
				}
				if !answered {
					host := externalHost(span.Attributes)
					addNode(MapNode{ID: "ext:" + host, Kind: "external", Label: host})
					addCall(service, "ext:"+host, span.Category, span)
				}
			}
		}
	}
	s.mu.RUnlock()

	window := maxEnd - minStart
	minutes := window / 60000
	if minutes < 1 {
		minutes = 1
	}
	out := ServiceMap{WindowMs: window, Nodes: []MapNode{}, Edges: []MapEdge{}}
	for _, node := range nodes {
		out.Nodes = append(out.Nodes, node)
	}
	for _, data := range edges {
		sort.Float64s(data.durations)
		data.edge.P50Ms, data.edge.P95Ms = percentile(data.durations, 50), percentile(data.durations, 95)
		data.edge.RatePerMin = float64(data.edge.Calls) / minutes
		out.Edges = append(out.Edges, data.edge)
	}
	sort.Slice(out.Nodes, func(i, j int) bool { return out.Nodes[i].ID < out.Nodes[j].ID })
	sort.Slice(out.Edges, func(i, j int) bool {
		if out.Edges[i].From != out.Edges[j].From {
			return out.Edges[i].From < out.Edges[j].From
		}
		return out.Edges[i].To < out.Edges[j].To
	})
	return out
}

// retryIDs returns the client/producer spans that repeat an earlier attempt: the
// semconv resend counter, or the same operation started again under the same parent.
// ponytail: sibling heuristic, a loop that legitimately calls the same endpoint twice counts too.
func retryIDs(spans []Span) map[string]bool {
	out := map[string]bool{}
	type key struct{ parent, service, kind, name string }
	first := map[key]Span{}
	for _, span := range spans {
		if span.Kind != "client" && span.Kind != "producer" {
			continue
		}
		if n, _ := strconv.Atoi(firstAttr(span.Attributes, "http.request.resend_count", "http.resend_count")); n > 0 {
			out[span.SpanID] = true
			continue
		}
		k := key{span.ParentSpanID, span.Service, span.Kind, span.Name}
		if earlier, ok := first[k]; ok {
			if span.StartMs >= earlier.StartMs {
				out[span.SpanID] = true
			} else {
				out[earlier.SpanID] = true
				first[k] = span
			}
			continue
		}
		first[k] = span
	}
	return out
}
