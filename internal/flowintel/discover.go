package flowintel

import (
	"encoding/xml"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/eclipsepde"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/graph"
)

// Discovery is the indexed Flow Intelligence graph of a workspace plus what was skipped.
type Discovery struct {
	Root        string         `json:"root"`
	Fingerprint string         `json:"fingerprint"`
	Graph       graph.Graph    `json:"graph"`
	Adapters    []string       `json:"adapters"`
	Counts      map[string]int `json:"counts"`
	Problems    []string       `json:"problems"`
}

const (
	maxFlowFiles   = 20000
	maxFlowFileLen = 1 << 20
)

var flowIgnoredDirs = map[string]bool{
	".git": true, ".svn": true, ".hg": true, "node_modules": true, "vendor": true,
	"target": true, "bin": true, "build": true, "out": true, "dist": true,
	".gradle": true, ".idea": true, ".adomnia": true, ".settings": true, "generated": true,
}

// Discover builds the Flow Intelligence graph: declared flows, generic XML flows, Java
// types/methods/calls, and the OSGi bundles/activators/services around them. Read-only.
func Discover(root string) (*Discovery, error) {
	absolute, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(absolute)
	if err != nil || !info.IsDir() {
		return nil, fmt.Errorf("%s is not a folder", root)
	}
	discovery := &Discovery{Root: absolute, Counts: map[string]int{}, Problems: []string{}}
	builder := graph.NewBuilder()
	methods := map[string]javaMethod{}
	typesBySimple := map[string][]javaType{}
	methodsByName := map[string][]string{}
	var javaFiles []string
	var xmlFiles []string

	_ = filepath.WalkDir(absolute, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if len(javaFiles)+len(xmlFiles) >= maxFlowFiles {
			return filepath.SkipAll
		}
		if entry.IsDir() {
			if path != absolute && flowIgnoredDirs[strings.ToLower(entry.Name())] {
				return filepath.SkipDir
			}
			return nil
		}
		switch strings.ToLower(filepath.Ext(entry.Name())) {
		case ".java":
			javaFiles = append(javaFiles, path)
		case ".xml":
			xmlFiles = append(xmlFiles, path)
		}
		return nil
	})

	// Java adapter: types, methods, annotations, external calls.
	for _, path := range javaFiles {
		stat, err := os.Stat(path)
		if err != nil || stat.Size() > maxFlowFileLen {
			continue
		}
		rel, _ := filepath.Rel(absolute, path)
		parsed, err := readJavaFile(path, filepath.ToSlash(rel))
		if err != nil {
			discovery.Problems = append(discovery.Problems, "java: "+filepath.ToSlash(rel)+": "+err.Error())
			continue
		}
		for _, typ := range parsed.Types {
			id := "type:" + typ.FQN
			builder.Node(graph.Node{ID: id, Kind: typ.Kind, Label: typ.Name, Package: typ.Package, File: typ.File, Line: typ.Line})
			typesBySimple[typ.Name] = append(typesBySimple[typ.Name], typ)
		}
		for _, method := range parsed.Methods {
			methods[method.ID] = method
			methodsByName[method.Name] = append(methodsByName[method.Name], method.ID)
			owner := "type:" + method.Class
			if !builder.Has(owner) {
				// A method outside a parsed type (unlikely): give it an owner anyway.
				builder.Node(graph.Node{ID: owner, Kind: graph.KindType, Label: method.Class, File: method.File, Line: method.Line})
			}
			builder.Node(graph.Node{ID: method.ID, Kind: graph.KindMethod, Label: simpleName(method.Class) + "." + method.Name, Package: packageOf(method.Class), File: method.File, Line: method.Line, Attrs: map[string]string{"class": method.Class}})
			builder.Edge(owner, method.ID, graph.EdgeContains, "")
			for _, annotation := range method.Annotations {
				kind := flowKindOfAnnotation(annotation)
				if kind == "" {
					continue
				}
				flowID := "flow:" + method.ID
				builder.Node(graph.Node{ID: flowID, Kind: kind, Label: flowLabel(kind, method), File: method.File, Line: method.Line, Attrs: map[string]string{"method": method.ID, "class": method.Class}})
				builder.EdgeWithConfidence(flowID, method.ID, graph.EdgeInvokes, "annotation @"+annotation, graph.ConfidenceDeclared)
			}
			for _, external := range method.Externals {
				externalID := "external:" + external.Kind + ":" + external.Name
				builder.Node(graph.Node{ID: externalID, Kind: graph.KindExternal, Label: external.Name, Attrs: map[string]string{"type": external.Kind, "detail": external.Detail}})
				builder.EdgeWithConfidence(method.ID, externalID, graph.EdgeCallsExt, external.Detail, graph.ConfidenceInferred)
			}
		}
	}

	// Resolve calls: same class first (derived), a known receiver type (derived),
	// otherwise a unique method name (inferred) or a guess (inferred).
	for _, method := range methods {
		for _, call := range method.Calls {
			target := ""
			confidence := graph.ConfidenceInferred
			candidate := "method:" + method.Class + "." + call.Name
			if _, ok := methods[candidate]; ok {
				target = candidate
				confidence = graph.ConfidenceDerived
			} else if call.Receiver != "" && call.Receiver != "this" {
				if types := typesBySimple[call.Receiver]; len(types) == 1 {
					candidate = "method:" + types[0].FQN + "." + call.Name
					if _, ok := methods[candidate]; ok {
						target, confidence = candidate, graph.ConfidenceDerived
					}
				}
			}
			if target == "" {
				if candidates := methodsByName[call.Name]; len(candidates) == 1 {
					target = candidates[0]
				} else if len(candidates) > 1 {
					target = candidates[0]
				}
			}
			if target == "" {
				continue
			}
			if _, ok := methods[target]; !ok {
				continue
			}
			builder.EdgeWithConfidence(method.ID, target, graph.EdgeCalls, "", confidence)
		}
	}

	// Declared adapter (.adomnia/flows.json).
	config, hasConfig, err := LoadConfig(absolute)
	if err != nil {
		discovery.Problems = append(discovery.Problems, "flows.json: "+err.Error())
	} else if hasConfig {
		discovery.Adapters = append(discovery.Adapters, "declared")
		applyDeclared(builder, config, methods, methodsByName, discovery)
	}

	// Generic XML adapter: flow/subflow elements and their references.
	if len(xmlFiles) > 0 {
		discovery.Adapters = append(discovery.Adapters, "xml")
		for _, path := range xmlFiles {
			stat, err := os.Stat(path)
			if err != nil || stat.Size() > maxFlowFileLen {
				continue
			}
			data, err := os.ReadFile(path)
			if err != nil {
				continue
			}
			if !looksLikeFlowXML(data) {
				continue
			}
			rel, _ := filepath.Rel(absolute, path)
			applyFlowXML(builder, filepath.ToSlash(rel), data, methodsByName, discovery)
		}
	}

	// OSGi adapter: bundle, Activator, Declarative Services.
	discovery.Adapters = append(discovery.Adapters, "osgi")
	applyOSGi(builder, absolute, discovery)

	result := builder.Graph()
	result.Root, result.Language = absolute, "flow"
	result.Nodes = filterZeroNodes(result.Nodes)
	for _, node := range result.Nodes {
		discovery.Counts[node.Kind]++
	}
	if len(discovery.Problems) > 0 {
		result.Problems = append(result.Problems, discovery.Problems...)
	}
	discovery.Graph = result
	discovery.Adapters = dedupeStrings(discovery.Adapters)
	if fingerprint, err := graph.Fingerprint(absolute, flowRelevantFile); err == nil {
		discovery.Fingerprint = fingerprint
		discovery.Graph.Fingerprint = fingerprint
	}
	return discovery, nil
}

// filterZeroNodes drops empty nodes the builder may have created.
func filterZeroNodes(nodes []graph.Node) []graph.Node {
	out := nodes[:0]
	for _, node := range nodes {
		if node.ID == "" || node.Kind == "" {
			continue
		}
		out = append(out, node)
	}
	return out
}

func flowRelevantFile(rel string) bool {
	lower := strings.ToLower(rel)
	if strings.HasSuffix(lower, ".java") || strings.HasSuffix(lower, ".xml") {
		return true
	}
	return lower == ".adomnia/flows.json"
}

func applyDeclared(builder *graph.Builder, config Config, methods map[string]javaMethod, byName map[string][]string, discovery *Discovery) {
	addFlowNode := func(id, kind, label, file string, line int) {
		if id == "" {
			return
		}
		builder.Node(graph.Node{ID: "flow:" + id, Kind: kind, Label: label, File: file, Line: line})
	}
	resolveMethod := func(reference string) string {
		reference = strings.TrimSpace(reference)
		if reference == "" {
			return ""
		}
		if strings.Contains(reference, "#") {
			class, method, _ := strings.Cut(reference, "#")
			id := "method:" + class + "." + method
			if _, ok := methods[id]; ok {
				return id
			}
			return ""
		}
		if strings.Contains(reference, ".") {
			id := "method:" + reference
			if _, ok := methods[id]; ok {
				return id
			}
		}
		if candidates := byName[reference]; len(candidates) > 0 {
			return candidates[0]
		}
		return ""
	}
	for _, flow := range config.Flows {
		kind := graph.KindFlow
		if flow.Kind == "subflow" {
			kind = graph.KindSubflow
		}
		flowID := "flow:" + flow.ID
		builder.Node(graph.Node{ID: flowID, Kind: kind, Label: flow.Name, File: flow.File, Line: flow.Line, Attrs: map[string]string{"declared": "true"}})
		if method := resolveMethod(flow.Method); method != "" {
			builder.EdgeWithConfidence(flowID, method, graph.EdgeInvokes, "declared method", graph.ConfidenceDeclared)
		} else if flow.Method != "" {
			discovery.Problems = append(discovery.Problems, fmt.Sprintf("flows.json: flow %s: method %s not found", flow.ID, flow.Method))
		}
		for _, subflow := range flow.Subflows {
			builder.Node(graph.Node{ID: "flow:" + subflow, Kind: graph.KindSubflow, Label: subflow})
			builder.EdgeWithConfidence(flowID, "flow:"+subflow, graph.EdgeFlowsTo, "declared", graph.ConfidenceDeclared)
		}
		for _, target := range flow.Flows {
			builder.Node(graph.Node{ID: "flow:" + target, Kind: graph.KindFlow, Label: target})
			builder.EdgeWithConfidence(flowID, "flow:"+target, graph.EdgeFlowsTo, "declared", graph.ConfidenceDeclared)
		}
		for _, call := range flow.Calls {
			method := resolveMethod(call.Method)
			if method == "" && call.Class != "" && call.Name != "" {
				method = resolveMethod(call.Class + "#" + call.Name)
			}
			if method == "" {
				discovery.Problems = append(discovery.Problems, fmt.Sprintf("flows.json: flow %s: call %q not found", flow.ID, call.Method))
				continue
			}
			detail := ""
			if call.Name != "" {
				detail = call.Name
			}
			builder.EdgeWithConfidence(flowID, method, graph.EdgeInvokes, detail, graph.ConfidenceDeclared)
		}
		for _, external := range flow.External {
			externalID := "external:" + external.Kind + ":" + external.Name
			builder.Node(graph.Node{ID: externalID, Kind: graph.KindExternal, Label: external.Name, Attrs: map[string]string{"type": external.Kind, "detail": external.Detail}})
			builder.EdgeWithConfidence(flowID, externalID, graph.EdgeCallsExt, external.Detail, graph.ConfidenceDeclared)
		}
		addFlowNode(flow.ID, kind, flow.Name, flow.File, flow.Line)
	}
}

// looksLikeFlowXML keeps the XML adapter away from plugin.xml/build.xml noise.
func looksLikeFlowXML(data []byte) bool {
	text := strings.ToLower(string(data))
	return strings.Contains(text, "<flow") || strings.Contains(text, "<subflow") || strings.Contains(text, "subflow")
}

// flowXMLElement is one start/end element the adapter understands.
type flowXMLElement struct {
	name  string
	line  int
	attrs map[string]string
}

func applyFlowXML(builder *graph.Builder, file string, data []byte, byName map[string][]string, discovery *Discovery) {
	decoder := xml.NewDecoder(strings.NewReader(string(data)))
	var stack []flowXMLElement
	sawFlow := false
	for {
		token, err := decoder.Token()
		if err != nil {
			break
		}
		switch element := token.(type) {
		case xml.StartElement:
			attrs := map[string]string{}
			for _, attr := range element.Attr {
				attrs[strings.ToLower(attr.Name.Local)] = attr.Value
			}
			line, _ := decoder.InputPos()
			item := flowXMLElement{name: strings.ToLower(element.Name.Local), line: line, attrs: attrs}
			stack = append(stack, item)
			kind := ""
			switch {
			case strings.Contains(item.name, "subflow"):
				kind = graph.KindSubflow
			case strings.Contains(item.name, "flow"):
				kind = graph.KindFlow
			}
			if kind != "" && len(stack) >= 2 {
				id := firstAttr(attrs, "id", "name", "ref", "flow", "target")
				if id != "" {
					sawFlow = true
					nodeID := "flow:" + id
					builder.Node(graph.Node{ID: nodeID, Kind: kind, Label: id, File: file, Line: line, Attrs: map[string]string{"declared": "xml"}})
					parentID := ""
					for index := len(stack) - 2; index >= 0; index-- {
						candidate := stack[index]
						if strings.Contains(candidate.name, "subflow") || strings.Contains(candidate.name, "flow") {
							parentID = "flow:" + firstAttr(candidate.attrs, "id", "name", "ref", "flow", "target")
							break
						}
					}
					if parentID != "" && parentID != nodeID {
						builder.EdgeWithConfidence(parentID, nodeID, graph.EdgeFlowsTo, "xml nesting", graph.ConfidenceDeclared)
					}
					if methodRef := firstAttr(attrs, "method", "class"); methodRef != "" {
						if method := resolveXMLMethod(methodRef, byName); method != "" {
							builder.EdgeWithConfidence(nodeID, method, graph.EdgeInvokes, "xml", graph.ConfidenceDeclared)
						}
					}
					if target := firstAttr(attrs, "flow", "target", "ref"); target != "" && target != id {
						builder.Node(graph.Node{ID: "flow:" + target, Kind: graph.KindFlow, Label: target})
						builder.EdgeWithConfidence(nodeID, "flow:"+target, graph.EdgeFlowsTo, "xml reference", graph.ConfidenceDeclared)
					}
				}
			}
		case xml.EndElement:
			if len(stack) > 0 {
				stack = stack[:len(stack)-1]
			}
		}
	}
	if !sawFlow {
		discovery.Problems = append(discovery.Problems, "xml: "+file+": no flow/subflow element found")
	}
}

func resolveXMLMethod(reference string, byName map[string][]string) string {
	reference = strings.TrimSpace(reference)
	if reference == "" {
		return ""
	}
	if candidates := byName[reference]; len(candidates) > 0 {
		return candidates[0]
	}
	if index := strings.LastIndex(reference, "."); index >= 0 {
		if candidates := byName[reference[index+1:]]; len(candidates) > 0 {
			return candidates[0]
		}
	}
	return ""
}

func firstAttr(attrs map[string]string, names ...string) string {
	for _, name := range names {
		if value := strings.TrimSpace(attrs[name]); value != "" {
			return value
		}
	}
	return ""
}

// applyOSGi maps Java types to their bundle and adds Activators and DS services.
func applyOSGi(builder *graph.Builder, root string, discovery *Discovery) {
	ws, err := eclipsepde.ImportWorkspace(root)
	if err != nil || len(ws.Bundles()) == 0 {
		return
	}
	typeNodes := make([]graph.Node, 0)
	for _, node := range builderNodes(builder) {
		if node.Kind == graph.KindType && node.File != "" {
			typeNodes = append(typeNodes, node)
		}
	}
	for _, project := range ws.Bundles() {
		bundle := project.Bundle
		if bundle == nil {
			continue
		}
		bundleID := "bundle:" + bundle.SymbolicName
		builder.Node(graph.Node{ID: bundleID, Kind: graph.KindBundle, Label: bundle.SymbolicName, File: relativeTo(root, project.Dir), Attrs: map[string]string{"version": bundle.Version.String()}})
		prefix := strings.TrimSuffix(relativeTo(root, project.Dir), "/") + "/"
		for _, node := range typeNodes {
			if strings.HasPrefix(node.File, prefix) {
				builder.EdgeWithConfidence(bundleID, node.ID, graph.EdgeContains, "", graph.ConfidenceDerived)
			}
		}
		if bundle.Activator != "" {
			activatorID := "activator:" + bundle.SymbolicName
			builder.Node(graph.Node{ID: activatorID, Kind: graph.KindActivator, Label: bundle.Activator, Attrs: map[string]string{"bundle": bundle.SymbolicName}})
			builder.EdgeWithConfidence(bundleID, activatorID, graph.EdgeStarts, "", graph.ConfidenceDeclared)
			for _, methodName := range []string{"start", "stop"} {
				if method := "method:" + bundle.Activator + "." + methodName; builder.Has(method) {
					builder.EdgeWithConfidence(activatorID, method, graph.EdgeInvokes, "activator", graph.ConfidenceDeclared)
				}
			}
		}
		for _, component := range eclipsepde.ServiceComponents(bundle) {
			for _, provided := range component.Services {
				serviceID := "service:" + provided
				builder.Node(graph.Node{ID: serviceID, Kind: graph.KindService, Label: provided, Attrs: map[string]string{"bundle": bundle.SymbolicName}})
				builder.EdgeWithConfidence(bundleID, serviceID, graph.EdgeProvides, component.File, graph.ConfidenceDeclared)
			}
			for _, referenced := range component.References {
				serviceID := "service:" + referenced
				builder.Node(graph.Node{ID: serviceID, Kind: graph.KindService, Label: referenced})
				builder.EdgeWithConfidence(bundleID, serviceID, graph.EdgeRefers, component.File, graph.ConfidenceDeclared)
			}
		}
	}
}

// builderNodes reads the nodes accumulated so far (the Builder has no accessor).
func builderNodes(builder *graph.Builder) []graph.Node { return builder.Graph().Nodes }

func flowKindOfAnnotation(annotation string) string {
	lower := strings.ToLower(annotation)
	switch {
	case strings.Contains(lower, "subflow"):
		return graph.KindSubflow
	case strings.Contains(lower, "flow"):
		return graph.KindFlow
	}
	return ""
}

func flowLabel(kind string, method javaMethod) string {
	prefix := "Flow"
	if kind == graph.KindSubflow {
		prefix = "Subflow"
	}
	return prefix + ": " + simpleName(method.Class) + "." + method.Name
}

func simpleName(fqn string) string {
	if index := strings.LastIndex(fqn, "."); index >= 0 {
		return fqn[index+1:]
	}
	return fqn
}

func packageOf(fqn string) string {
	if index := strings.LastIndex(fqn, "."); index >= 0 {
		return fqn[:index]
	}
	return ""
}

func relativeTo(root, path string) string {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return filepath.ToSlash(path)
	}
	return filepath.ToSlash(rel)
}

func dedupeStrings(values []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}
