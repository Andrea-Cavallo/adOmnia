package diagrams

import (
	"slices"
	"sort"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/flowintel"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/graph"
)

// The Workspace Analyzer: it unifies what the language adapters already found (the Semantic
// Workspace Graph of Go, Flow Intelligence for Java/OSGi/XML) into one navigable model. It does not
// scan sources itself: discovery stays with the adapters, and this package only normalizes,
// deduplicates and attributes each entity to the service it belongs to.

// Entity kinds of the normalized model. Adapter kinds are mapped onto these, so the UI has one
// vocabulary independent of the language.
const (
	EntityService   = "service"
	EntityModule    = "module"
	EntityPackage   = "package"
	EntityFunction  = "function"
	EntityMethod    = "method"
	EntityType      = "type"
	EntityEndpoint  = "endpoint"
	EntityTopic     = "topic"
	EntityTable     = "table"
	EntityExternal  = "external"
	EntityEntry     = "entry"
	EntityBundle    = "bundle"
	EntityFlow      = "flow"
	EntitySubflow   = "subflow"
	EntityActivator = "activator"
	EntityOther     = "other"
)

// WorkspaceEntity is one navigable node of the diagram. ID is stable: it is the adapter's node id,
// so a refresh keeps the identity of everything whose logical role did not change. File and Line
// point at the declaration; they are relative to Root and 1-based.
type WorkspaceEntity struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"`
	Label      string `json:"label"`
	Detail     string `json:"detail,omitempty"`
	Package    string `json:"package,omitempty"`
	File       string `json:"file,omitempty"`
	Line       int    `json:"line,omitzero"`
	Service    string `json:"service,omitempty"`    // id of the owning service entity
	Language   string `json:"language,omitempty"`   // go, java, xml, osgi, declared
	Confidence string `json:"confidence,omitempty"` // how the entity itself was found
}

// WorkspaceLink is a relation between entities, with the evidence strength the adapter reported.
// Empty confidence means "derived" for graphs built before confidence existed.
type WorkspaceLink struct {
	From       string `json:"from"`
	To         string `json:"to"`
	Kind       string `json:"kind"`
	Detail     string `json:"detail,omitempty"`
	Confidence string `json:"confidence,omitempty"`
}

// WorkspaceSource says which adapter fed the model, so the UI can state coverage honestly.
type WorkspaceSource struct {
	Language    string         `json:"language"`
	Nodes       int            `json:"nodes"`
	Edges       int            `json:"edges"`
	Fingerprint string         `json:"fingerprint,omitempty"`
	Stats       map[string]int `json:"stats,omitempty"`
	Problems    []string       `json:"problems,omitempty"`
}

// WorkspaceAnalysis is the normalized, deduplicated view of one workspace.
type WorkspaceAnalysis struct {
	Root        string            `json:"root"`
	Fingerprint string            `json:"fingerprint,omitempty"`
	Languages   []string          `json:"languages"`
	Entities    []WorkspaceEntity `json:"entities"`
	Links       []WorkspaceLink   `json:"links"`
	Sources     []WorkspaceSource `json:"sources"`
	Stats       map[string]int    `json:"stats"`
	Problems    []string          `json:"problems,omitempty"`
	Truncated   bool              `json:"truncated,omitzero"`
}

// WorkspaceInput is what the service gathered from the adapters. Any of the graphs may be empty:
// the analysis still describes whatever was found, and says which source is missing via Problems.
type WorkspaceInput struct {
	Root     string
	Semantic *graph.Graph
	Flows    *flowintel.Discovery
	Problems []string
}

// BuildWorkspace normalizes the adapter graphs into one model.
func BuildWorkspace(input WorkspaceInput) WorkspaceAnalysis {
	analysis := WorkspaceAnalysis{Root: input.Root, Languages: []string{}, Entities: []WorkspaceEntity{}, Links: []WorkspaceLink{}, Sources: []WorkspaceSource{}, Stats: map[string]int{}}
	analysis.Problems = append(analysis.Problems, input.Problems...)
	entities := map[string]WorkspaceEntity{}
	links := map[WorkspaceLink]bool{}
	owner := map[string]string{}

	if input.Semantic != nil {
		g := *input.Semantic
		analysis.Truncated = analysis.Truncated || g.Truncated
		analysis.Problems = append(analysis.Problems, g.Problems...)
		analysis.Sources = append(analysis.Sources, sourceOf("go", g))
		mergeGraph(entities, links, owner, g, "go", goServiceOf)
		if g.Fingerprint != "" {
			analysis.Fingerprint = g.Fingerprint
		}
	}
	if input.Flows != nil && len(input.Flows.Graph.Nodes) > 0 {
		g := input.Flows.Graph
		analysis.Problems = append(analysis.Problems, input.Flows.Problems...)
		analysis.Sources = append(analysis.Sources, sourceOf("flow", g))
		mergeGraph(entities, links, owner, g, "flow", bundleServiceOf)
		if analysis.Fingerprint == "" {
			analysis.Fingerprint = input.Flows.Fingerprint
		}
	}

	// Nodes the adapters did not contain are still useful (an endpoint, a topic, an external system):
	// attribute them to the service that reaches them, so grouping never leaves them orphaned.
	assignReachedOwners(entities, links, owner)
	for id, service := range owner {
		entity, ok := entities[id]
		if !ok {
			continue
		}
		entity.Service = service
		entities[id] = entity
	}

	analysis.Entities = sortedEntities(entities)
	analysis.Links = sortedLinks(links)
	for _, entity := range analysis.Entities {
		analysis.Stats[entity.Kind]++
		if entity.Language != "" && !containsString(analysis.Languages, entity.Language) {
			analysis.Languages = append(analysis.Languages, entity.Language)
		}
	}
	sort.Strings(analysis.Languages)
	analysis.Truncated = analysis.Truncated || len(analysis.Entities) >= maxWorkspaceEntities
	return analysis
}

// maxWorkspaceEntities keeps a pathological workspace from crossing the binding; the Truncated flag
// tells the UI it is looking at a partial analysis.
const maxWorkspaceEntities = 20000

func sourceOf(language string, g graph.Graph) WorkspaceSource {
	stats := g.Stats()
	return WorkspaceSource{Language: language, Nodes: len(g.Nodes), Edges: len(g.Edges), Fingerprint: g.Fingerprint, Stats: stats, Problems: append([]string{}, g.Problems...)}
}

// mergeGraph adds one adapter graph to the accumulated maps. serviceOf resolves the owning service
// of a node from the contains edges of that same graph.
func mergeGraph(entities map[string]WorkspaceEntity, links map[WorkspaceLink]bool, owner map[string]string, g graph.Graph, language string, serviceOf func(graph.Graph) map[string]string) {
	service := serviceOf(g)
	for _, node := range g.Nodes {
		if _, exists := entities[node.ID]; exists {
			continue // the first adapter that claimed the identity wins; ids are namespaced anyway
		}
		entity := WorkspaceEntity{
			ID: node.ID, Kind: normalizeKind(node.Kind), Label: node.Label, Detail: detailOf(node),
			Package: node.Package, File: node.File, Line: node.Line, Language: language,
		}
		if node.Kind == graph.KindModule || node.Kind == graph.KindBundle {
			entity.Kind = EntityService
		}
		entities[node.ID] = entity
		if owned := service[node.ID]; owned != "" {
			owner[node.ID] = owned
		}
	}
	for _, edge := range g.Edges {
		if edge.Kind == graph.EdgeContains {
			continue // containment is the grouping, not a visible flow
		}
		key := WorkspaceLink{From: edge.From, To: edge.To, Kind: edge.Kind, Detail: edge.Detail, Confidence: confidenceOf(edge.Confidence)}
		links[key] = true
	}
}

func confidenceOf(value string) string {
	switch value {
	case graph.ConfidenceDeclared, graph.ConfidenceDerived, graph.ConfidenceInferred, graph.ConfidenceObserved:
		return value
	default:
		return graph.ConfidenceDerived
	}
}

func normalizeKind(kind string) string {
	switch kind {
	case graph.KindModule, graph.KindBundle:
		return EntityService
	case graph.KindPackage:
		return EntityPackage
	case graph.KindFunction, graph.KindTest:
		return EntityFunction
	case graph.KindInterface, graph.KindType:
		return EntityType
	case graph.KindEndpoint, graph.KindRPC, graph.KindSocket:
		return EntityEndpoint
	case graph.KindTopic:
		return EntityTopic
	case graph.KindTable:
		return EntityTable
	case graph.KindExternal, graph.KindDependency, graph.KindStdlib:
		return EntityExternal
	case graph.KindEntry:
		return EntityEntry
	case graph.KindFlow:
		return EntityFlow
	case graph.KindSubflow:
		return EntitySubflow
	case graph.KindActivator:
		return EntityActivator
	default:
		return EntityOther
	}
}

func detailOf(node graph.Node) string {
	if node.Kind == graph.KindFunction || node.Kind == graph.KindMethod {
		return node.Package
	}
	if value := node.Attrs["library"]; value != "" {
		return value
	}
	if value := node.Attrs["framework"]; value != "" {
		return value
	}
	if value := node.Attrs["broker"]; value != "" {
		return value
	}
	if value := node.Attrs["version"]; value != "" {
		return value
	}
	if value := node.Attrs["entry"]; value != "" {
		return value
	}
	return ""
}

// goServiceOf maps every Go node to its module: pkg → module is a contains edge, and the package
// carries the module path as an attribute (a package shared by two modules does not happen).
func goServiceOf(g graph.Graph) map[string]string {
	modules := map[string]string{}
	for _, node := range g.Nodes {
		if node.Kind == graph.KindModule {
			modules[node.ID] = node.ID
		}
	}
	owners := map[string]string{}
	// contains edges: module → package → file/function.
	children := map[string][]string{}
	for _, edge := range g.Edges {
		if edge.Kind == graph.EdgeContains {
			children[edge.From] = append(children[edge.From], edge.To)
		}
	}
	for module := range modules {
		walkOwners(module, module, children, owners)
	}
	// Fallback for a package that no edge reached: its module attribute names the module.
	for _, node := range g.Nodes {
		if _, owned := owners[node.ID]; owned {
			continue
		}
		if module := node.Attrs["module"]; module != "" {
			owners[node.ID] = "mod:" + module
		}
	}
	return owners
}

// bundleServiceOf maps Java/OSGi nodes to their bundle. A flow declared in a bundle that has no
// contains edge is attributed by its bundle attribute.
func bundleServiceOf(g graph.Graph) map[string]string {
	owners := map[string]string{}
	children := map[string][]string{}
	for _, edge := range g.Edges {
		if edge.Kind == graph.EdgeContains {
			children[edge.From] = append(children[edge.From], edge.To)
		}
	}
	for _, node := range g.Nodes {
		if node.Kind == graph.KindBundle {
			walkOwners(node.ID, node.ID, children, owners)
		}
	}
	for _, node := range g.Nodes {
		if _, owned := owners[node.ID]; owned {
			continue
		}
		if bundle := node.Attrs["bundle"]; bundle != "" {
			owners[node.ID] = "bundle:" + bundle
		}
	}
	return owners
}

func walkOwners(id, service string, children map[string][]string, owners map[string]string) {
	if id == service || owners[id] == "" {
		owners[id] = service
	}
	for _, child := range children[id] {
		if owners[child] != "" && owners[child] != service {
			continue // shared or cyclic containment: keep the first attribution
		}
		walkOwners(child, service, children, owners)
	}
}

// assignReachedOwners gives the entities without a container a service: the owner of the nearest
// node that reaches them (an endpoint reached by a handler, a table queried by a function). It
// covers two hops, then leaves the entity ungrouped rather than inventing a service.
func assignReachedOwners(entities map[string]WorkspaceEntity, links map[WorkspaceLink]bool, owner map[string]string) {
	incoming := map[string][]string{}
	for link := range links {
		incoming[link.To] = append(incoming[link.To], link.From)
	}
	for range 2 {
		changed := false
		for id := range entities {
			if owner[id] != "" {
				continue
			}
			for _, from := range incoming[id] {
				if service := owner[from]; service != "" {
					owner[id] = service
					changed = true
					break
				}
			}
		}
		if !changed {
			return
		}
	}
}

func sortedEntities(entities map[string]WorkspaceEntity) []WorkspaceEntity {
	out := make([]WorkspaceEntity, 0, len(entities))
	for _, entity := range entities {
		out = append(out, entity)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Kind != out[j].Kind {
			return out[i].Kind < out[j].Kind
		}
		if out[i].Label != out[j].Label {
			return out[i].Label < out[j].Label
		}
		return out[i].ID < out[j].ID
	})
	if len(out) > maxWorkspaceEntities {
		out = out[:maxWorkspaceEntities]
	}
	return out
}

func sortedLinks(links map[WorkspaceLink]bool) []WorkspaceLink {
	out := make([]WorkspaceLink, 0, len(links))
	for link := range links {
		out = append(out, link)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].From != out[j].From {
			return out[i].From < out[j].From
		}
		if out[i].To != out[j].To {
			return out[i].To < out[j].To
		}
		return out[i].Kind < out[j].Kind
	})
	return out
}

func containsString(values []string, value string) bool {
	return slices.Contains(values, value)
}

// FindEntity returns one entity by its adapter id.
func (a WorkspaceAnalysis) FindEntity(id string) (WorkspaceEntity, bool) {
	for _, entity := range a.Entities {
		if entity.ID == id {
			return entity, true
		}
	}
	return WorkspaceEntity{}, false
}

// Children returns the entities directly contained by a service/package, for progressive expansion.
func (a WorkspaceAnalysis) Children(serviceID string) []WorkspaceEntity {
	out := []WorkspaceEntity{}
	for _, entity := range a.Entities {
		if entity.Service == serviceID && entity.ID != serviceID {
			out = append(out, entity)
		}
	}
	return out
}

// Neighborhood returns the callers and callees of one entity, and the links that connect them.
func (a WorkspaceAnalysis) Neighborhood(id string, kinds []string) ([]WorkspaceEntity, []WorkspaceLink) {
	allow := map[string]bool{}
	for _, kind := range kinds {
		allow[kind] = true
	}
	selected := map[string]bool{id: true}
	links := []WorkspaceLink{}
	for _, link := range a.Links {
		if link.From != id && link.To != id {
			continue
		}
		if len(allow) > 0 && !allow[link.Kind] {
			continue
		}
		links = append(links, link)
		selected[link.From] = true
		selected[link.To] = true
	}
	entities := []WorkspaceEntity{}
	for _, entity := range a.Entities {
		if selected[entity.ID] {
			entities = append(entities, entity)
		}
	}
	return entities, links
}

// IsFlowKind reports whether a link kind is a call/execution relation, the ones callers/callees show.
func IsFlowKind(kind string) bool {
	switch kind {
	case graph.EdgeCalls, graph.EdgeInvokes, graph.EdgeFlowsTo, graph.EdgeDispatches, graph.EdgeCallsExt, graph.EdgeStarts:
		return true
	}
	return false
}

// TrimLabel shortens a long label for the canvas while keeping a stable identity elsewhere.
func TrimLabel(label string, limit int) string {
	if limit <= 0 || len(label) <= limit {
		return label
	}
	return strings.TrimSpace(label[:limit-1]) + "…"
}
