package otlp

import (
	"net/url"
	"slices"
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
	// Services only: the process (process.pid, or the owner of a port its server spans
	// listen on), those ports, and its established TCP connections now.
	PID         int   `json:"pid,omitzero"`
	ListenPorts []int `json:"listenPorts,omitempty"`
	Connections int   `json:"connections,omitzero"`
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
	SourceLine    int    `json:"sourceLine,omitzero"`
	// The handler that answers the call, from the server span of the callee.
	HandlerFile string `json:"handlerFile,omitempty"`
	HandlerLine int    `json:"handlerLine,omitzero"`
	// Consumer side of a topic: the group and the brokers it reads from, to ask for its lag.
	Group   string `json:"group,omitempty"`
	Brokers string `json:"brokers,omitempty"`
	// PeerPorts are the remote ports the calls go to; ActiveConnections the caller's
	// established TCP connections to them (or to the callee's ports) right now.
	PeerPorts         []int `json:"peerPorts,omitempty"`
	ActiveConnections int   `json:"activeConnections,omitzero"`
}

type ServiceMap struct {
	Nodes []MapNode `json:"nodes"`
	Edges []MapEdge `json:"edges"`
	// WindowMs is the time span the rates refer to.
	WindowMs float64 `json:"windowMs"`
	// ConnectionsMeasured is true when the connection counts come from the machine.
	ConnectionsMeasured bool `json:"connectionsMeasured,omitzero"`
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
	b := &mapBuilder{
		nodes:     map[string]MapNode{},
		edges:     map[string]*mapEdgeData{},
		peerPorts: map[*MapEdge]map[int]bool{},
		retry:     map[string]bool{},
	}
	s.mu.RLock()
	for _, spans := range s.traces {
		b.addTrace(spans)
	}
	s.mu.RUnlock()
	return b.result()
}

type mapEdgeData struct {
	edge      MapEdge
	durations []float64
}

// mapBuilder accumulates nodes, edges and the observed time window while the traces are walked.
type mapBuilder struct {
	nodes            map[string]MapNode
	edges            map[string]*mapEdgeData
	peerPorts        map[*MapEdge]map[int]bool
	retry            map[string]bool
	minStart, maxEnd float64
}

func (b *mapBuilder) addNode(node MapNode) {
	if existing, ok := b.nodes[node.ID]; ok {
		node.PID, node.ListenPorts = existing.PID, existing.ListenPorts
	}
	b.nodes[node.ID] = node
}

func (b *mapBuilder) addCall(from, to, kind string, span Span) *MapEdge {
	key := from + "\x00" + to + "\x00" + kind
	data := b.edges[key]
	if data == nil {
		data = &mapEdgeData{edge: MapEdge{From: from, To: to, Kind: kind}}
		b.edges[key] = data
	}
	data.edge.Calls++
	if port, _ := strconv.Atoi(firstAttr(span.Attributes, "server.port", "net.peer.port")); port > 0 {
		if b.peerPorts[&data.edge] == nil {
			b.peerPorts[&data.edge] = map[int]bool{}
		}
		b.peerPorts[&data.edge][port] = true
	}
	if b.retry[span.SpanID] {
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

// addTrace extends the time window with one trace and records the calls of its spans.
func (b *mapBuilder) addTrace(spans []Span) {
	children := map[string][]Span{}
	for _, span := range spans {
		children[span.ParentSpanID] = append(children[span.ParentSpanID], span)
		if b.minStart == 0 || span.StartMs < b.minStart {
			b.minStart = span.StartMs
		}
		if end := span.StartMs + span.DurationMs; end > b.maxEnd {
			b.maxEnd = end
		}
	}
	for id := range retryIDs(spans) {
		b.retry[id] = true
	}
	for _, span := range spans {
		b.addSpan(span, children)
	}
}

// addSpan registers the span's service and, by category, the call it makes.
func (b *mapBuilder) addSpan(span Span, children map[string][]Span) {
	service := "svc:" + span.Service
	b.addNode(MapNode{ID: service, Kind: "service", Label: span.Service})
	node := b.nodes[service]
	if span.PID > 0 {
		node.PID = span.PID
	}
	if span.Kind == "server" {
		if port, _ := strconv.Atoi(firstAttr(span.Attributes, "server.port", "net.host.port")); port > 0 && !slices.Contains(node.ListenPorts, port) {
			node.ListenPorts = append(node.ListenPorts, port)
		}
	}
	b.nodes[service] = node
	switch {
	case span.Category == "db":
		b.addDatabaseCall(service, span)
	case span.Category == "messaging":
		b.addMessagingCall(service, span)
	case span.Kind == "client" && (span.Category == "http" || span.Category == "rpc"):
		b.addClientCall(service, span, children[span.SpanID])
	}
}

func (b *mapBuilder) addDatabaseCall(service string, span Span) {
	system := firstAttr(span.Attributes, "db.system.name", "db.system")
	name := firstAttr(span.Attributes, "db.namespace", "db.name")
	label := system
	if name != "" {
		label = system + " · " + name
	}
	id := "db:" + label
	b.addNode(MapNode{ID: id, Kind: "database", Label: label, System: system})
	b.addCall(service, id, "db", span)
}

func (b *mapBuilder) addMessagingCall(service string, span Span) {
	system := span.Attributes["messaging.system"]
	topic := firstAttr(span.Attributes, "messaging.destination.name", "messaging.destination")
	if topic == "" {
		topic = system
	}
	id := "topic:" + topic
	b.addNode(MapNode{ID: id, Kind: "topic", Label: topic, System: system})
	if span.Kind != "consumer" {
		b.addCall(service, id, "messaging", span)
		return
	}
	edge := b.addCall(id, service, "messaging", span)
	if group := firstAttr(span.Attributes, "messaging.consumer.group.name", "messaging.kafka.consumer.group", "messaging.kafka.consumer_group"); group != "" && edge.Group == "" {
		edge.Group = group
	}
	if host := firstAttr(span.Attributes, "server.address", "net.peer.name"); host != "" && edge.Brokers == "" {
		if port := firstAttr(span.Attributes, "server.port", "net.peer.port"); port != "" {
			host += ":" + port
		}
		edge.Brokers = host
	}
}

// addClientCall links a client span to the other service that answered it, or to an external host.
func (b *mapBuilder) addClientCall(service string, span Span, children []Span) {
	answered := false
	for _, child := range children {
		if child.Kind == "server" && child.Service != span.Service {
			b.addNode(MapNode{ID: "svc:" + child.Service, Kind: "service", Label: child.Service})
			edge := b.addCall(service, "svc:"+child.Service, span.Category, span)
			if file := firstAttr(child.Attributes, "code.filepath", "code.file.path"); file != "" && edge.HandlerFile == "" {
				edge.HandlerFile = file
				edge.HandlerLine, _ = strconv.Atoi(firstAttr(child.Attributes, "code.lineno", "code.line.number"))
			}
			answered = true
		}
	}
	if !answered {
		host := externalHost(span.Attributes)
		b.addNode(MapNode{ID: "ext:" + host, Kind: "external", Label: host})
		b.addCall(service, "ext:"+host, span.Category, span)
	}
}

// result turns the accumulated data into the sorted, rate-annotated map.
func (b *mapBuilder) result() ServiceMap {
	window := b.maxEnd - b.minStart
	minutes := window / 60000
	if minutes < 1 {
		minutes = 1
	}
	out := ServiceMap{WindowMs: window, Nodes: []MapNode{}, Edges: []MapEdge{}}
	for _, node := range b.nodes {
		out.Nodes = append(out.Nodes, node)
	}
	for _, data := range b.edges {
		sort.Float64s(data.durations)
		data.edge.P50Ms, data.edge.P95Ms = percentile(data.durations, 50), percentile(data.durations, 95)
		data.edge.RatePerMin = float64(data.edge.Calls) / minutes
		for port := range b.peerPorts[&data.edge] {
			data.edge.PeerPorts = append(data.edge.PeerPorts, port)
		}
		sort.Ints(data.edge.PeerPorts)
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

// Listener is a listening TCP port and its owning process.
type Listener struct{ Port, PID int }

// Conn is an established TCP connection: the owning process and the remote port.
type Conn struct{ PID, RemotePort int }

// AnnotateConnections adds the live TCP picture to the map: each service's PID (process.pid
// or the owner of a port its server spans listen on), its established connections, and per
// edge the caller's connections to the callee's ports.
func AnnotateConnections(m *ServiceMap, conns []Conn, listeners []Listener) {
	byID := map[string]*MapNode{}
	for i := range m.Nodes {
		node := &m.Nodes[i]
		byID[node.ID] = node
		if node.Kind != "service" {
			continue
		}
		for _, port := range node.ListenPorts {
			for _, listener := range listeners {
				if node.PID == 0 && listener.Port == port && listener.PID > 0 {
					node.PID = listener.PID
				}
			}
		}
		for _, conn := range conns {
			if node.PID > 0 && conn.PID == node.PID {
				node.Connections++
			}
		}
	}
	for i := range m.Edges {
		edge := &m.Edges[i]
		caller, callee := byID[edge.From], byID[edge.To]
		if edge.Kind == "messaging" && caller != nil && caller.Kind == "topic" {
			caller, callee = callee, caller // consumer: the service connects to the brokers
		}
		if caller == nil || caller.PID == 0 {
			continue
		}
		ports := map[int]bool{}
		for _, port := range edge.PeerPorts {
			ports[port] = true
		}
		if callee != nil {
			for _, port := range callee.ListenPorts {
				ports[port] = true
			}
		}
		for _, conn := range conns {
			if conn.PID == caller.PID && ports[conn.RemotePort] {
				edge.ActiveConnections++
			}
		}
	}
	m.ConnectionsMeasured = true
}
