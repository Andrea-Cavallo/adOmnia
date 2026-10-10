package devcontext

import (
	"reflect"

	"adomnia/internal/plugins"
)

// AdapterHints carries the detection knowledge plugins teach to the built-in
// detectors, keyed by Go module path. A framework adapter teaches handler
// parameter types and route registration methods, a broker adapter teaches a
// protocol and its topic-bearing methods, a database adapter teaches query
// methods. When empty, the detectors behave exactly as before.
type AdapterHints struct {
	Frameworks map[string]FrameworkHint
	Brokers    map[string]BrokerHint
	Databases  map[string]DatabaseHint
}

// FrameworkHint teaches handler and route detection for one framework.
type FrameworkHint struct {
	HandlerTypes []string // parameter types that mark a handler, e.g. "*iris.Context"
	RouteMethods []string // registration methods taking (path, handler), e.g. "Get"
}

// BrokerHint teaches topic detection for one broker library.
type BrokerHint struct {
	Broker       string   // protocol name: kafka, amqp, nats, pulsar, redis…
	TopicMethods []string // methods whose first string argument is a topic
}

// DatabaseHint teaches table detection for one database library.
type DatabaseHint struct {
	SQLMethods []string // query methods whose string argument is SQL
}

// Empty reports whether no plugin taught any detection, the common case.
func (h AdapterHints) Empty() bool {
	return len(h.Frameworks) == 0 && len(h.Brokers) == 0 && len(h.Databases) == 0
}

// Equal compares two hint sets; nil and empty maps are treated as equal.
func (h AdapterHints) Equal(other AdapterHints) bool {
	return reflect.DeepEqual(h, other)
}

// HintsFromContributions converts enabled plugin adapter contributions into
// detection hints keyed by module path. Adapters that declare no hints (only
// modules) still drive the direct-dependency entities in WithPluginAdapters,
// but contribute nothing here.
func HintsFromContributions(contributions []plugins.Contribution) AdapterHints {
	hints := AdapterHints{}
	for _, c := range contributions {
		if c.Kind != "adapter" {
			continue
		}
		switch c.AdapterKind {
		case "framework":
			hint := FrameworkHint{HandlerTypes: c.HandlerTypes, RouteMethods: c.RouteMethods}
			if len(hint.HandlerTypes) == 0 && len(hint.RouteMethods) == 0 {
				continue
			}
			if hints.Frameworks == nil {
				hints.Frameworks = map[string]FrameworkHint{}
			}
			for _, module := range c.Modules {
				hints.Frameworks[module] = hint
			}
		case "broker":
			if c.Broker == "" || len(c.TopicMethods) == 0 {
				continue
			}
			hint := BrokerHint{Broker: c.Broker, TopicMethods: c.TopicMethods}
			if hints.Brokers == nil {
				hints.Brokers = map[string]BrokerHint{}
			}
			for _, module := range c.Modules {
				hints.Brokers[module] = hint
			}
		case "database":
			if len(c.SQLMethods) == 0 {
				continue
			}
			hint := DatabaseHint{SQLMethods: c.SQLMethods}
			if hints.Databases == nil {
				hints.Databases = map[string]DatabaseHint{}
			}
			for _, module := range c.Modules {
				hints.Databases[module] = hint
			}
		}
	}
	return hints
}
