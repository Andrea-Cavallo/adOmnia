package diagrams

import (
	"fmt"
	"strings"
)

// Shapes are the Diagram Studio library ids a blueprint may use, with what each one is for.
// An unknown id still opens (as a process box), but agents get this list to choose well.
var Shapes = map[string]string{
	"rectangle": "plain box", "rounded-rectangle": "rounded box", "ellipse": "ellipse", "circle": "circle", "diamond": "diamond",
	"hexagon": "hexagon", "triangle": "triangle", "star": "star", "block-arrow": "block arrow", "cloud": "cloud",
	"process": "flowchart step", "decision": "flowchart decision", "io": "input/output", "terminator": "start/end",
	"document": "document", "stored-data": "stored data", "subprocess": "subprocess", "manual-input": "manual input",
	"preparation": "preparation", "delay": "delay", "off-page": "off-page link", "connector": "junction",
	"service": "microservice/app", "api": "HTTP API", "database": "database", "cache": "cache (Redis)", "queue": "message queue",
	"gateway": "API gateway", "load-balancer": "load balancer", "client": "user/browser/mobile client", "external": "external system",
	"go-service": "Go service", "java-service": "Java/Spring service", "rest-endpoint": "REST endpoint", "soap-endpoint": "SOAP endpoint",
	"kafka-topic": "Kafka topic", "event": "domain event", "camel-route": "Camel route", "saga-orchestrator": "saga orchestrator",
	"saga-step": "saga step", "osgi-bundle": "OSGi bundle", "uml-class": "UML class", "uml-interface": "UML interface",
	"uml-actor": "UML actor", "uml-use-case": "UML use case", "uml-package": "UML package", "uml-component": "UML component",
	"container": "group/frame (parent of other nodes)", "swimlane": "swimlane (parent)", "boundary": "dashed system boundary (parent)",
	"text": "free text", "note": "note", "sticky-yellow": "sticky note", "sticky-pink": "sticky note", "sticky-green": "sticky note",
	"sticky-blue": "sticky note", "legend": "legend",
}

// Colors are the palette tints a node or link may use.
var Colors = []string{"graphite", "green", "blue", "amber", "red", "violet", "paper"}

// Validate checks a blueprint an agent wrote: keys unique, links and parents pointing at nodes.
func Validate(bp *Blueprint) error {
	bp.Format = BlueprintFormat
	if strings.TrimSpace(bp.Name) == "" {
		bp.Name = "Generated diagram"
	}
	if len(bp.Nodes) == 0 && strings.TrimSpace(bp.Sequence) == "" {
		return fmt.Errorf("the diagram needs nodes or a sequence")
	}
	keys := map[string]bool{}
	for index, node := range bp.Nodes {
		if strings.TrimSpace(node.Key) == "" {
			return fmt.Errorf("node %d has no key", index+1)
		}
		if keys[node.Key] {
			return fmt.Errorf("node key %q is used twice", node.Key)
		}
		keys[node.Key] = true
		if node.Shape == "" {
			bp.Nodes[index].Shape = "process"
		}
	}
	for _, node := range bp.Nodes {
		if node.Parent != "" && !keys[node.Parent] {
			return fmt.Errorf("node %q has parent %q, which is not a node", node.Key, node.Parent)
		}
	}
	for index, link := range bp.Links {
		if !keys[link.From] || !keys[link.To] {
			return fmt.Errorf("link %d goes from %q to %q: both must be node keys", index+1, link.From, link.To)
		}
	}
	if bp.Nodes == nil {
		bp.Nodes = []Node{}
	}
	if bp.Links == nil {
		bp.Links = []Link{}
	}
	return nil
}

// FileName is where a blueprint is saved by default, inside the workspace.
func FileName(name string) string {
	base := slug(name)
	if base == "" {
		base = "diagram"
	}
	return "diagrams/" + base + ".adomnia-diagram.json"
}
