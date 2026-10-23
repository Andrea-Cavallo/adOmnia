package golang

import (
	"go/ast"
	"path"
	"strconv"
	"strings"

	"adomnia/internal/ide/graph"
)

// Il Semantic Workspace Graph di un progetto Go nasce dal report dell'Architecture Explorer
// (go/packages + tipi): qui c'è solo la traduzione in nodi e archi del grafo generico.

func fnNode(id string) string { return "fn:" + id }

// graphTranslator holds the lookup tables shared by the steps that turn a report into a graph.
type graphTranslator struct {
	b            *graph.Builder
	report       ArchitectureReport
	moduleOf     map[string]string
	dependencies []string
	byName       map[string]string // package + nome mostrato ("T.M") → nodo
	bySite       map[string]string
	dto          map[string]string // nome dello schema → nodo
}

// GraphFromArchitecture traduce il report (posizioni già risolte) nel grafo del progetto.
func GraphFromArchitecture(report ArchitectureReport) *graph.Builder {
	t := &graphTranslator{
		b: graph.NewBuilder(), report: report,
		moduleOf: map[string]string{}, byName: map[string]string{}, bySite: map[string]string{}, dto: map[string]string{},
	}
	t.addModules()
	t.addExternalDependencies()
	t.addPackages()
	t.addFunctions()
	t.addInterfaces()
	t.addEntries()
	t.addReads()
	t.addSchemas()
	t.addEntrySchemaUses()
	t.addQueries()
	return t.b
}

func (t *graphTranslator) addModules() {
	b := t.b
	for _, module := range t.report.Modules {
		b.Node(graph.Node{ID: "mod:" + module.Path, Kind: graph.KindModule, Label: module.Path, File: module.Site.Path, Line: module.Site.Line})
	}
	for _, module := range t.report.Modules {
		for _, required := range module.Requires {
			b.Edge("mod:"+module.Path, "mod:"+required, graph.EdgeRequires, "")
		}
	}
}

// addExternalDependencies adds one node per required module, reached by the packages that import it.
func (t *graphTranslator) addExternalDependencies() {
	b := t.b
	local := map[string]bool{}
	for _, module := range t.report.Modules {
		local[module.Path] = true
	}
	for _, module := range t.report.Modules {
		for _, external := range module.External {
			path, version, _ := strings.Cut(external, "@")
			if local[path] { // un altro modulo del workspace (go.work, replace locale)
				b.Edge("mod:"+module.Path, "mod:"+path, graph.EdgeRequires, "")
				continue
			}
			b.Node(graph.Node{ID: "dep:" + path, Kind: graph.KindDependency, Label: path, File: module.Site.Path, Attrs: attrs("version", version)})
			b.Edge("mod:"+module.Path, "dep:"+path, graph.EdgeRequires, version)
			t.dependencies = append(t.dependencies, path)
		}
	}
}

func (t *graphTranslator) dependencyOf(importPath string) string {
	best := ""
	for _, path := range t.dependencies {
		if (importPath == path || strings.HasPrefix(importPath, path+"/")) && len(path) > len(best) {
			best = path
		}
	}
	return best
}

func (t *graphTranslator) addPackages() {
	b, report := t.b, t.report
	for _, pkg := range report.Packages {
		t.moduleOf[pkg.Path] = pkg.Module
		b.Node(graph.Node{ID: "pkg:" + pkg.Path, Kind: graph.KindPackage, Label: pkg.Path, Package: pkg.Path, File: pkg.Site.Path, Line: pkg.Site.Line, Attrs: attrs("module", pkg.Module)})
		b.Edge("mod:"+pkg.Module, "pkg:"+pkg.Path, graph.EdgeContains, "")
	}
	for _, pkg := range report.Packages {
		for _, imported := range pkg.External {
			if dependency := t.dependencyOf(imported); dependency != "" {
				b.Edge("pkg:"+pkg.Path, "dep:"+dependency, graph.EdgeImports, imported)
			} else {
				// Package di un altro modulo del workspace (go.work, replace locale): arco fra package.
				b.Edge("pkg:"+pkg.Path, "pkg:"+imported, graph.EdgeImports, "")
			}
		}
	}
	// Libreria standard: serve alle regole d'architettura ("niente net/http nel dominio").
	for _, pkg := range report.Packages {
		for _, imported := range pkg.StdImports {
			b.Node(graph.Node{ID: "std:" + imported, Kind: graph.KindStdlib, Label: imported})
			b.Edge("pkg:"+pkg.Path, "std:"+imported, graph.EdgeImports, "")
		}
	}
	for _, edge := range report.Imports {
		b.Edge("pkg:"+edge.From, "pkg:"+edge.To, graph.EdgeImports, "")
	}
}

func functionKind(function ArchFunction) string {
	switch {
	case isTestFunction(function):
		return graph.KindTest
	case strings.Contains(function.Name, "."):
		return graph.KindMethod
	}
	return graph.KindFunction
}

func (t *graphTranslator) addFunctions() {
	b := t.b
	for _, function := range t.report.Functions {
		id := fnNode(function.ID)
		node := graph.Node{ID: id, Kind: functionKind(function), Label: shortPackage(function.Package) + "." + function.Name, Package: function.Package, File: function.Site.Path, Line: function.Site.Line, Attrs: attrs("module", t.moduleOf[function.Package], "name", function.Name)}
		if function.Abstract {
			node.Attrs["abstract"] = "true"
		}
		b.Node(node)
		t.byName[function.Package+"\x00"+function.Name] = id
		if function.Site.Path != "" {
			t.bySite[function.Site.Path+"\x00"+strconv.Itoa(function.Site.Line)] = id
			file := "file:" + function.Site.Path
			b.Node(graph.Node{ID: file, Kind: graph.KindFile, Label: function.Site.Path, Package: function.Package, File: function.Site.Path})
			b.Edge("pkg:"+function.Package, file, graph.EdgeContains, "")
			b.Edge(file, id, graph.EdgeContains, "")
		}
	}
	for _, edge := range t.report.Calls {
		b.Edge(fnNode(edge.From), fnNode(edge.To), graph.EdgeCalls, "")
	}
}

func (t *graphTranslator) lookup(pkg, name string) string {
	if name == "" {
		return ""
	}
	if id, ok := t.byName[pkg+"\x00"+name]; ok {
		return id
	}
	// Il nome può arrivare qualificato ("pkg.Func" o "(*T).M"): si prova la forma corta.
	name = strings.NewReplacer("(*", "", "(", "", ")", "").Replace(name)
	if index := strings.LastIndex(name, "/"); index >= 0 {
		name = name[index+1:]
	}
	if id, ok := t.byName[pkg+"\x00"+name]; ok {
		return id
	}
	if _, short, ok := strings.Cut(name, "."); ok {
		return t.byName[pkg+"\x00"+short]
	}
	return ""
}

func (t *graphTranslator) addInterfaces() {
	b := t.b
	for _, item := range t.report.Interfaces {
		iface := "iface:" + item.Package + "." + item.Name
		b.Node(graph.Node{ID: iface, Kind: graph.KindInterface, Label: shortPackage(item.Package) + "." + item.Name, Package: item.Package, File: item.Site.Path, Line: item.Site.Line, Attrs: attrs("module", t.moduleOf[item.Package])})
		for _, signature := range item.Methods {
			method, _, _ := strings.Cut(signature, "(") // "Get(id string) string" → "Get"
			abstract := fnNode("(" + item.Package + "." + item.Name + ")." + method)
			b.Edge(iface, abstract, graph.EdgeContains, "")
			for _, implementation := range item.Implementations {
				concrete := implementation.Package + "." + implementation.Type
				for _, candidate := range []string{fnNode("(*" + concrete + ")." + method), fnNode("(" + concrete + ")." + method)} {
					b.Edge(abstract, candidate, graph.EdgeDispatches, "")
				}
			}
		}
		for _, implementation := range item.Implementations {
			typeID := "type:" + implementation.Package + "." + implementation.Type
			b.Node(graph.Node{ID: typeID, Kind: graph.KindType, Label: shortPackage(implementation.Package) + "." + implementation.Type, Package: implementation.Package, File: implementation.Site.Path, Line: implementation.Site.Line, Attrs: attrs("module", t.moduleOf[implementation.Package])})
			b.Edge(typeID, iface, graph.EdgeImplements, "")
		}
	}
}

func (t *graphTranslator) addEntries() {
	for _, entry := range t.report.Entries {
		switch entry.Kind {
		case "http":
			t.addHTTPEntry(entry)
		case "grpc":
			t.addGRPCEntry(entry)
		case "kafka-producer", "kafka-consumer", "nats-producer", "nats-consumer", "amqp-producer", "amqp-consumer":
			t.addBrokerEntry(entry)
		case "websocket-server":
			// L'upgrade è servito via HTTP: compare fra le route che il codice serve.
			socket := "ws:" + entry.Package + "." + entry.Function
			t.b.Node(graph.Node{ID: socket, Kind: graph.KindEndpoint, Label: "WebSocket " + entry.Function, Package: entry.Package, File: entry.Site.Path, Line: entry.Site.Line, Attrs: attrs("library", entry.Detail)})
			t.b.Edge(t.lookup(entry.Package, entry.Function), socket, graph.EdgeHandles, "")
		case "websocket-client":
			socket := "ws:" + entry.Name
			t.b.Node(graph.Node{ID: socket, Kind: graph.KindSocket, Label: entry.Name, Attrs: attrs("library", entry.Detail)})
			t.b.Edge(t.lookup(entry.Package, entry.Function), socket, graph.EdgeCalls, "")
		case "main", "init", "job", "cli":
			entryID := "entry:" + entry.Kind + ":" + entry.Package + ":" + entry.Name
			t.b.Node(graph.Node{ID: entryID, Kind: graph.KindEntry, Label: entry.Kind + " " + entry.Name, Package: entry.Package, File: entry.Site.Path, Line: entry.Site.Line, Attrs: attrs("entry", entry.Kind)})
			t.b.Edge(entryID, t.lookup(entry.Package, entry.Function), graph.EdgeStarts, "")
		}
	}
}

func (t *graphTranslator) addHTTPEntry(entry ArchEntry) {
	endpoint := "http:" + entry.Name
	t.b.Node(graph.Node{ID: endpoint, Kind: graph.KindEndpoint, Label: entry.Name, Package: entry.Package, File: entry.Site.Path, Line: entry.Site.Line, Attrs: attrs("framework", entry.Detail)})
	handler := ""
	if entry.HandlerSite != nil {
		handler = t.bySite[entry.HandlerSite.Path+"\x00"+strconv.Itoa(entry.HandlerSite.Line)]
	}
	if handler == "" {
		handler = t.lookup(entry.Package, entry.Handler)
	}
	if handler == "" {
		// Handler anonimo (func literal): lo serve la funzione che registra la route.
		handler = t.lookup(entry.Package, entry.Function)
	}
	t.b.Edge(handler, endpoint, graph.EdgeHandles, "")
}

func (t *graphTranslator) addGRPCEntry(entry ArchEntry) {
	b := t.b
	rpc := "grpc:" + entry.Name
	b.Node(graph.Node{ID: rpc, Kind: graph.KindRPC, Label: entry.Name, Package: entry.Package, File: entry.Site.Path, Line: entry.Site.Line, Attrs: attrs("server", entry.Detail)})
	// Il servizio è servito da tutti i metodi del tipo registrato.
	server := path.Base(strings.TrimPrefix(entry.Detail, "*"))
	if _, short, ok := strings.Cut(server, "."); ok {
		server = short
	}
	// Ogni metodo esportato del tipo registrato è un metodo RPC: Servizio/Metodo.
	for _, function := range t.report.Functions {
		method, ok := strings.CutPrefix(function.Name, server+".")
		if function.Package != entry.Package || !ok || method == "" || !ast.IsExported(method) || strings.HasPrefix(method, "mustEmbed") {
			continue
		}
		methodID := rpc + "/" + method
		b.Node(graph.Node{ID: methodID, Kind: graph.KindRPC, Label: entry.Name + "/" + method, Package: entry.Package, File: function.Site.Path, Line: function.Site.Line, Attrs: attrs("service", entry.Name)})
		b.Edge(rpc, methodID, graph.EdgeContains, "")
		b.Edge(fnNode(function.ID), methodID, graph.EdgeHandles, "")
	}
}

func (t *graphTranslator) addBrokerEntry(entry ArchEntry) {
	function := t.lookup(entry.Package, entry.Function)
	broker, role, _ := strings.Cut(entry.Kind, "-")
	edgeKind := graph.EdgeProduces
	if role == "consumer" {
		edgeKind = graph.EdgeConsumes
	}
	for _, topic := range entry.Topics {
		topicID := "topic:" + topic
		if broker != "kafka" {
			topicID = "topic:" + broker + ":" + topic
		}
		t.b.Node(graph.Node{ID: topicID, Kind: graph.KindTopic, Label: topic, Attrs: attrs("broker", broker)})
		t.b.Edge(function, topicID, edgeKind, entry.TopicRoles[topic])
	}
}

func (t *graphTranslator) addReads() {
	for _, read := range t.report.Reads {
		id, kind := "env:"+read.Key, graph.KindEnvVar
		if read.Kind == "config" {
			id, kind = "config:"+read.Key, graph.KindConfig
		}
		t.b.Node(graph.Node{ID: id, Kind: kind, Label: read.Key, File: read.Site.Path, Line: read.Site.Line, Attrs: attrs("library", read.Library)})
		t.b.Edge(t.lookup(read.Package, read.Function), id, graph.EdgeReads, read.Library)
	}
}

// addSchemas adds the DTO structs that routes read and write, and the ones they contain.
func (t *graphTranslator) addSchemas() {
	for _, schema := range t.report.Schemas {
		id := "type:" + schema.Package + "." + schema.Name
		t.dto[schema.Name] = id
		t.b.Node(graph.Node{ID: id, Kind: graph.KindType, Label: shortPackage(schema.Package) + "." + schema.Name, Package: schema.Package, File: schema.Site.Path, Line: schema.Site.Line, Attrs: attrs("module", t.moduleOf[schema.Package], "dto", "true")})
	}
	for _, schema := range t.report.Schemas {
		for _, field := range schema.Fields {
			for _, ref := range []string{field.Ref, field.Items} {
				if to, ok := t.dto[ref]; ok {
					t.b.Edge(t.dto[schema.Name], to, graph.EdgeUses, "field "+field.GoName)
				}
			}
		}
	}
}

func (t *graphTranslator) addEntrySchemaUses() {
	for _, entry := range t.report.Entries {
		if entry.Kind != "http" {
			continue
		}
		for detail, body := range map[string]*ArchBody{"request": entry.Request, "response": entry.Response} {
			if body == nil {
				continue
			}
			if to, ok := t.dto[body.Ref]; ok {
				t.b.Edge("http:"+entry.Name, to, graph.EdgeUses, detail)
			}
		}
	}
}

func (t *graphTranslator) addQueries() {
	for _, query := range t.report.Queries {
		function := t.lookup(query.Package, query.Function)
		for _, table := range query.Tables {
			tableID := "table:" + strings.ToLower(table)
			t.b.Node(graph.Node{ID: tableID, Kind: graph.KindTable, Label: table, Attrs: attrs("library", query.Library)})
			t.b.Edge(function, tableID, graph.EdgeQueries, query.Operation)
		}
	}
}

func isTestFunction(function ArchFunction) bool {
	if strings.Contains(function.Name, ".") || !strings.HasSuffix(function.Site.Path, "_test.go") {
		return false
	}
	for _, prefix := range []string{"Test", "Benchmark", "Fuzz", "Example"} {
		if strings.HasPrefix(function.Name, prefix) {
			return true
		}
	}
	return false
}

func shortPackage(importPath string) string { return path.Base(importPath) }

// attrs crea la mappa degli attributi saltando i valori vuoti.
func attrs(pairs ...string) map[string]string {
	out := map[string]string{}
	for index := 0; index+1 < len(pairs); index += 2 {
		if pairs[index+1] != "" {
			out[pairs[index]] = pairs[index+1]
		}
	}
	return out
}
