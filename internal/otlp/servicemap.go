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
	PID         int   `json:"pid,omitempty"`
	ListenPorts []int `json:"listenPorts,omitempty"`
	Connections int   `json:"connections,omitempty"`
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
	// PeerPorts are the remote ports the calls go to; ActiveConnections the caller's
	// established TCP connections to them (or to the callee's ports) right now.
	PeerPorts         []int `json:"peerPorts,omitempty"`
	ActiveConnections int   `json:"activeConnections,omitempty"`
}

type ServiceMap struct {
	Nodes []MapNode `json:"nodes"`
	Edges []MapEdge `json:"edges"`
	// WindowMs is the time span the rates refer to.
	WindowMs float64 `json:"windowMs"`
	// ConnectionsMeasured is true when the connection counts come from the machine.
	ConnectionsMeasured bool `json:"connectionsMeasured,omitempty"`
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
	addNode := func(node MapNode) {
		if existing, ok := nodes[node.ID]; ok {
			node.PID, node.ListenPorts = existing.PID, existing.ListenPorts
		}
		nodes[node.ID] = node
	}
	peerPorts := map[*MapEdge]map[int]bool{}
	retry := map[string]bool{}
	addCall := func(from, to, kind string, span Span) *MapEdge {
		key := from + "\x00" + to + "\x00" + kind
		data := edges[key]
		if data == nil {
			data = &edgeData{edge: MapEdge{From: from, To: to, Kind: kind}}
			edges[key] = data
		}
		data.edge.Calls++
		if port, _ := strconv.Atoi(firstAttr(span.Attributes, "server.port", "net.peer.port")); port > 0 {
			if peerPorts[&data.edge] == nil {
				peerPorts[&data.edge] = map[int]bool{}
			}
			peerPorts[&data.edge][port] = true
		}
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
			node := nodes[service]
			if span.PID > 0 {
				node.PID = span.PID
			}
			if span.Kind == "server" {
				if port, _ := strconv.Atoi(firstAttr(span.Attributes, "server.port", "net.host.port")); port > 0 && !slices.Contains(node.ListenPorts, port) {
					node.ListenPorts = append(node.ListenPorts, port)
				}
			}
			nodes[service] = node
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
		for port := range peerPorts[&data.edge] {
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
