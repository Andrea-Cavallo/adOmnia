// Package diagrams turns written descriptions into Diagram Studio blueprints: shapes, links and
// containers without coordinates, which the desktop lays out (ELK) and draws with its shape
// library. The same blueprint is what the MCP server writes for an agent and what the
// "From Markdown" command of Diagram Studio opens.
package diagrams

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

// BlueprintFormat marks a blueprint file; Diagram Studio imports it as a new, laid-out diagram.
const BlueprintFormat = "adomnia-diagram-blueprint"

// Node is one shape of a blueprint. Shape is an id of the Diagram Studio library (service,
// database, kafka-topic, process, decision, container…); Color a palette tint (blue, green…).
type Node struct {
	Key      string `json:"key"`
	Shape    string `json:"shape"`
	Label    string `json:"label"`
	Subtitle string `json:"subtitle,omitempty"`
	Color    string `json:"color,omitempty"`
	Parent   string `json:"parent,omitempty"`
}

// Link is a connector between two node keys.
type Link struct {
	From   string `json:"from"`
	To     string `json:"to"`
	Label  string `json:"label,omitempty"`
	Dashed bool   `json:"dashed,omitempty"`
	Flow   bool   `json:"flow,omitempty"`
	Color  string `json:"color,omitempty"`
}

// Blueprint is a diagram described as data. Sequence, when set, is Mermaid-style
// `sequenceDiagram` text drawn as its own page with lifelines and activation bars.
type Blueprint struct {
	Format   string `json:"format"`
	Name     string `json:"name"`
	Nodes    []Node `json:"nodes"`
	Links    []Link `json:"links"`
	Sequence string `json:"sequence,omitempty"`
}

// MaxMarkdownBytes bounds the input: a description, not a book.
const MaxMarkdownBytes = 1 << 20

var (
	headingLine   = regexp.MustCompile(`^(#{1,6})\s+(.+?)\s*#*$`)
	bulletLine    = regexp.MustCompile(`^\s*[-*+]\s+(?:\[[ xX]\]\s+)?(.+)$`)
	numberedLine  = regexp.MustCompile(`^\s*(\d+)[.)]\s+(.+)$`)
	relationLine  = regexp.MustCompile(`^(.+?)\s*(-\.->|-->|==>|=>|->|→|⇒)\s*(?:\|([^|]*)\|\s*)?(.+?)(?:\s*:\s*(.+))?$`)
	mermaidNode   = regexp.MustCompile(`^([A-Za-z0-9_.-]+)\s*(\[\(|\(\(|\[\[|\[|\(|\{|>)(.*?)(\)\]|\)\)|\]\]|\]|\)|\})?$`)
	componentLine = regexp.MustCompile("^(?:\\*\\*|__)?([^*_:—(`]+?)(?:\\*\\*|__)?\\s*(?:\\(([^)]*)\\)|`([^`]*)`)?\\s*(?:[:—–-]\\s+(.*))?$")
	sequenceArrow = regexp.MustCompile(`-?->>|-\)|--\)`)
)

type builder struct {
	bp     Blueprint
	byName map[string]string // lower-case label or key -> node key
	group  string
	keys   map[string]bool
}

// FromMarkdown reads a Markdown description: `#` is the diagram name, `##` sections with bullet
// lists are containers of components, numbered lists are flows of steps, lines like
// `A -> B: label` (`-->` dashed, `=>` animated) are links, and ```mermaid blocks are read as
// flowcharts or sequence diagrams.
func FromMarkdown(markdown string) (Blueprint, error) {
	if len(markdown) > MaxMarkdownBytes {
		return Blueprint{}, fmt.Errorf("the Markdown is %d bytes; the limit is %d", len(markdown), MaxMarkdownBytes)
	}
	b := &builder{bp: Blueprint{Format: BlueprintFormat, Nodes: []Node{}, Links: []Link{}}, byName: map[string]string{}, keys: map[string]bool{}}
	lines := strings.Split(strings.ReplaceAll(markdown, "\r\n", "\n"), "\n")
	var steps []string
	flush := func() { b.addSteps(steps); steps = nil }
	for index := 0; index < len(lines); index++ {
		line := strings.TrimRight(lines[index], " \t")
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "```") {
			flush()
			end := index + 1
			for end < len(lines) && !strings.HasPrefix(strings.TrimSpace(lines[end]), "```") {
				end++
			}
			b.addFence(strings.TrimSpace(strings.TrimPrefix(trimmed, "```")), lines[index+1:min(end, len(lines))])
			index = end
			continue
		}
		if match := headingLine.FindStringSubmatch(trimmed); match != nil {
			flush()
			b.heading(len(match[1]), cleanInline(match[2]))
			continue
		}
		if match := numberedLine.FindStringSubmatch(line); match != nil {
			text := cleanInline(match[2])
			if b.relation(text, match[1]+". ") {
				continue
			}
			steps = append(steps, text)
			continue
		}
		flush()
		if match := bulletLine.FindStringSubmatch(line); match != nil {
			text := cleanInline(match[1])
			if !b.relation(text, "") {
				b.component(text)
			}
			continue
		}
		if trimmed != "" {
			b.relation(cleanInline(trimmed), "")
		}
	}
	flush()
	b.dropEmptyGroups()
	if b.bp.Name == "" {
		b.bp.Name = "Generated diagram"
	}
	if len(b.bp.Nodes) == 0 && b.bp.Sequence == "" {
		return Blueprint{}, fmt.Errorf("nothing to draw: write components as bullet lists, steps as a numbered list or links as `A -> B`")
	}
	return b.bp, nil
}

func (b *builder) heading(level int, text string) {
	if level == 1 && b.bp.Name == "" {
		b.bp.Name = text
		return
	}
	if text == "" {
		return
	}
	key := b.uniqueKey("group-" + slug(text))
	b.bp.Nodes = append(b.bp.Nodes, Node{Key: key, Shape: "container", Label: text})
	b.group = key
}

// component adds a bullet item: "**Name** (tech): description" or "Name: description".
func (b *builder) component(text string) {
	match := componentLine.FindStringSubmatch(text)
	name, subtitle := text, ""
	if match != nil {
		name = strings.TrimSpace(match[1])
		subtitle = strings.TrimSpace(match[2] + match[3])
	}
	if name == "" || len([]rune(name)) > 60 {
		return
	}
	if key, ok := b.byName[strings.ToLower(name)]; ok {
		b.setParent(key)
		return
	}
	shape, color := inferShape(name + " " + subtitle)
	key := b.uniqueKey(slug(name))
	b.bp.Nodes = append(b.bp.Nodes, Node{Key: key, Shape: shape, Label: name, Subtitle: subtitle, Color: color, Parent: b.group})
	b.byName[strings.ToLower(name)] = key
}

func (b *builder) setParent(key string) {
	for index := range b.bp.Nodes {
		if b.bp.Nodes[index].Key == key && b.bp.Nodes[index].Parent == "" && b.group != "" && key != b.group {
			b.bp.Nodes[index].Parent = b.group
		}
	}
}

// relation reads "A -> B: label"; it returns false when the text is not a link.
func (b *builder) relation(text, prefix string) bool {
	if sequenceArrow.MatchString(text) {
		return false
	}
	match := relationLine.FindStringSubmatch(text)
	if match == nil {
		return false
	}
	from, to := b.node(match[1]), b.node(match[4])
	if from == "" || to == "" {
		return false
	}
	arrow := match[2]
	label := strings.TrimSpace(match[3])
	if label == "" {
		label = strings.TrimSpace(match[5])
	}
	if label != "" {
		label = prefix + label
	}
	link := Link{From: from, To: to, Label: label, Dashed: arrow == "-->" || arrow == "-.->", Flow: arrow == "=>" || arrow == "==>" || arrow == "⇒"}
	if link.Flow {
		link.Color = "green"
	}
	b.bp.Links = append(b.bp.Links, link)
	return true
}

// node finds or creates the node a link end names; Mermaid ids with a label (A[Text]) work too.
func (b *builder) node(raw string) string {
	raw = strings.Trim(strings.TrimSpace(raw), "*_`")
	label, shape := raw, ""
	if match := mermaidNode.FindStringSubmatch(raw); match != nil && match[2] != "" {
		label = strings.Trim(strings.TrimSpace(match[3]), `"`)
		shape = mermaidShape(match[2])
		if key, ok := b.byName[strings.ToLower(match[1])]; ok {
			return key
		}
		if label == "" {
			label = match[1]
		}
		key := b.newNode(label, shape)
		b.byName[strings.ToLower(match[1])] = key
		return key
	}
	if label == "" || len([]rune(label)) > 60 {
		return ""
	}
	if key, ok := b.byName[strings.ToLower(label)]; ok {
		return key
	}
	return b.newNode(label, shape)
}

func (b *builder) newNode(label, shape string) string {
	inferred, color := inferShape(label)
	if shape == "" {
		shape = inferred
	} else if shape == "decision" {
		color = "amber"
	}
	key := b.uniqueKey(slug(label))
	b.bp.Nodes = append(b.bp.Nodes, Node{Key: key, Shape: shape, Label: label, Color: color})
	b.byName[strings.ToLower(label)] = key
	return key
}

// addSteps turns a numbered list into a chain: start and end are terminators, questions are decisions.
func (b *builder) addSteps(steps []string) {
	previous := ""
	for index, text := range steps {
		shape, color := "process", "blue"
		switch {
		case isDecision(text):
			shape, color = "decision", "amber"
		case index == 0 || index == len(steps)-1:
			shape, color = "terminator", "green"
		}
		key := b.uniqueKey(fmt.Sprintf("step-%d", len(b.bp.Nodes)+1))
		b.bp.Nodes = append(b.bp.Nodes, Node{Key: key, Shape: shape, Label: text, Color: color})
		if _, known := b.byName[strings.ToLower(text)]; !known {
			b.byName[strings.ToLower(text)] = key
		}
		if previous != "" {
			b.bp.Links = append(b.bp.Links, Link{From: previous, To: key, Flow: true, Color: "blue"})
		}
		previous = key
	}
}

func (b *builder) addFence(language string, body []string) {
	text := strings.Join(body, "\n")
	first := ""
	for _, line := range body {
		if strings.TrimSpace(line) != "" {
			first = strings.TrimSpace(line)
			break
		}
	}
	if strings.HasPrefix(first, "sequenceDiagram") || language == "sequence" {
		if b.bp.Sequence != "" {
			b.bp.Sequence += "\n"
		}
		b.bp.Sequence += text
		return
	}
	if language != "mermaid" && !strings.HasPrefix(first, "graph") && !strings.HasPrefix(first, "flowchart") {
		return
	}
	for _, line := range body {
		trimmed := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(line), ";"))
		if trimmed == "" || strings.HasPrefix(trimmed, "graph") || strings.HasPrefix(trimmed, "flowchart") || strings.HasPrefix(trimmed, "%%") ||
			strings.HasPrefix(trimmed, "classDef") || strings.HasPrefix(trimmed, "class ") || strings.HasPrefix(trimmed, "style ") {
			continue
		}
		if strings.HasPrefix(trimmed, "subgraph") {
			b.heading(2, strings.TrimSpace(strings.TrimPrefix(trimmed, "subgraph")))
			continue
		}
		if trimmed == "end" {
			b.group = ""
			continue
		}
		if !b.relation(trimmed, "") {
			if key := b.node(trimmed); key != "" {
				b.setParent(key)
			}
		}
	}
}

func (b *builder) dropEmptyGroups() {
	used := map[string]bool{}
	for _, node := range b.bp.Nodes {
		if node.Parent != "" {
			used[node.Parent] = true
		}
	}
	for _, link := range b.bp.Links {
		used[link.From], used[link.To] = true, true
	}
	kept := b.bp.Nodes[:0]
	for _, node := range b.bp.Nodes {
		if node.Shape != "container" || used[node.Key] {
			kept = append(kept, node)
		}
	}
	b.bp.Nodes = kept
}

func (b *builder) uniqueKey(base string) string {
	if base == "" {
		base = "node"
	}
	key := base
	for index := 2; b.keys[key]; index++ {
		key = base + "-" + strconv.Itoa(index)
	}
	b.keys[key] = true
	return key
}

var shapeRules = []struct {
	words        []string
	shape, color string
}{
	{[]string{"kafka", "topic", "stream"}, "kafka-topic", "green"},
	{[]string{"queue", "rabbit", "amqp", "jms", "sqs", "broker", "pub/sub", "pubsub", "nats"}, "queue", "green"},
	{[]string{"redis", "cache", "memcached"}, "cache", "red"},
	{[]string{"database", "postgres", "mysql", "oracle", "mongo", "sql", "dynamo", "db", "storage", "bucket", "s3"}, "database", "graphite"},
	{[]string{"gateway", "ingress"}, "gateway", "amber"},
	{[]string{"load balancer", "balancer", "nginx", "haproxy"}, "load-balancer", "amber"},
	{[]string{"user", "client", "browser", "web", "webapp", "spa", "portal", "storefront", "frontend", "front-end", "mobile", "ui", "customer", "utente"}, "client", "violet"},
	{[]string{"orchestrator", "saga"}, "saga-orchestrator", "violet"},
	{[]string{"event"}, "event", "green"},
	{[]string{"external", "third-party", "third party", "partner", "saas", "stripe", "paypal", "esterno"}, "external", "amber"},
	{[]string{"api", "endpoint", "rest", "http"}, "api", "blue"},
}

// inferShape picks a library shape from the words of a name.
func inferShape(text string) (string, string) {
	lower := strings.ToLower(text)
	words := strings.FieldsFunc(lower, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '-' && r != '/' })
	has := func(word string) bool {
		if strings.Contains(word, " ") {
			return strings.Contains(lower, word)
		}
		for _, candidate := range words {
			if candidate == word || strings.HasPrefix(candidate, word) && len(word) > 3 {
				return true
			}
		}
		return false
	}
	for _, rule := range shapeRules {
		for _, word := range rule.words {
			if has(word) {
				return rule.shape, rule.color
			}
		}
	}
	return "service", "blue"
}

func mermaidShape(open string) string {
	switch open {
	case "{":
		return "decision"
	case "[(":
		return "database"
	case "((":
		return "circle"
	case "(":
		return "terminator"
	case "[[":
		return "subprocess"
	case ">":
		return "event"
	}
	return ""
}

func isDecision(text string) bool {
	lower := strings.ToLower(strings.TrimSpace(text))
	return strings.HasSuffix(lower, "?") || strings.HasPrefix(lower, "if ") || strings.HasPrefix(lower, "se ") || strings.HasPrefix(lower, "check ") || strings.HasPrefix(lower, "verifica ")
}

var inlineMarks = regexp.MustCompile(`\[([^\]]+)\]\([^)]*\)`)

// cleanInline drops Markdown links (keeping their text) and surrounding whitespace.
func cleanInline(text string) string {
	return strings.TrimSpace(inlineMarks.ReplaceAllString(text, "$1"))
}

func slug(text string) string {
	var out strings.Builder
	dash := false
	for _, r := range strings.ToLower(text) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			out.WriteRune(r)
			dash = false
		} else if !dash && out.Len() > 0 {
			out.WriteByte('-')
			dash = true
		}
	}
	return strings.TrimSuffix(out.String(), "-")
}
