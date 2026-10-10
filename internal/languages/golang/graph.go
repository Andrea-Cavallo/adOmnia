package golang

import (
	"path"
	"strconv"
	"strings"

	"adomnia/internal/ide/graph"
)

// Il Semantic Workspace Graph di un progetto Go nasce dal report dell'Architecture Explorer
// (go/packages + tipi): qui c'è solo la traduzione in nodi e archi del grafo generico.

func fnNode(id string) string { return "fn:" + id }

// GraphFromArchitecture traduce il report (posizioni già risolte) nel grafo del progetto.
func GraphFromArchitecture(report ArchitectureReport) *graph.Builder {
	b := graph.NewBuilder()
	moduleOf := map[string]string{}
	for _, module := range report.Modules {
		b.Node(graph.Node{ID: "mod:" + module.Path, Kind: graph.KindModule, Label: module.Path, File: module.Site.Path, Line: module.Site.Line})
	}
	for _, module := range report.Modules {
		for _, required := range module.Requires {
			b.Edge("mod:"+module.Path, "mod:"+required, graph.EdgeRequires, "")
		}
	}
	for _, pkg := range report.Packages {
		moduleOf[pkg.Path] = pkg.Module
		b.Node(graph.Node{ID: "pkg:" + pkg.Path, Kind: graph.KindPackage, Label: pkg.Path, Package: pkg.Path, File: pkg.Site.Path, Line: pkg.Site.Line, Attrs: attrs("module", pkg.Module)})
		b.Edge("mod:"+pkg.Module, "pkg:"+pkg.Path, graph.EdgeContains, "")
	}
	for _, edge := range report.Imports {
		b.Edge("pkg:"+edge.From, "pkg:"+edge.To, graph.EdgeImports, "")
	}

	// byName: package + nome mostrato ("T.M") → nodo, per gli entry point che citano la funzione per nome.
	byName := map[string]string{}
	bySite := map[string]string{}
	for _, function := range report.Functions {
		id := fnNode(function.ID)
		kind := graph.KindFunction
		switch {
		case isTestFunction(function):
			kind = graph.KindTest
		case strings.Contains(function.Name, "."):
			kind = graph.KindMethod
		}
		node := graph.Node{ID: id, Kind: kind, Label: shortPackage(function.Package) + "." + function.Name, Package: function.Package, File: function.Site.Path, Line: function.Site.Line, Attrs: attrs("module", moduleOf[function.Package], "name", function.Name)}
		if function.Abstract {
			node.Attrs["abstract"] = "true"
		}
		b.Node(node)
		byName[function.Package+"\x00"+function.Name] = id
		if function.Site.Path != "" {
			bySite[function.Site.Path+"\x00"+strconv.Itoa(function.Site.Line)] = id
			file := "file:" + function.Site.Path
			b.Node(graph.Node{ID: file, Kind: graph.KindFile, Label: function.Site.Path, Package: function.Package, File: function.Site.Path})
			b.Edge("pkg:"+function.Package, file, graph.EdgeContains, "")
			b.Edge(file, id, graph.EdgeContains, "")
		}
	}
	for _, edge := range report.Calls {
		b.Edge(fnNode(edge.From), fnNode(edge.To), graph.EdgeCalls, "")
	}
	lookup := func(pkg, name string) string {
		if name == "" {
			return ""
		}
		if id, ok := byName[pkg+"\x00"+name]; ok {
			return id
		}
		// Il nome può arrivare qualificato ("pkg.Func" o "(*T).M"): si prova la forma corta.
		name = strings.NewReplacer("(*", "", "(", "", ")", "").Replace(name)
		if index := strings.LastIndex(name, "/"); index >= 0 {
			name = name[index+1:]
		}
		if id, ok := byName[pkg+"\x00"+name]; ok {
			return id
		}
		if _, short, ok := strings.Cut(name, "."); ok {
			return byName[pkg+"\x00"+short]
		}
		return ""
	}

	for _, item := range report.Interfaces {
		iface := "iface:" + item.Package + "." + item.Name
		b.Node(graph.Node{ID: iface, Kind: graph.KindInterface, Label: shortPackage(item.Package) + "." + item.Name, Package: item.Package, File: item.Site.Path, Line: item.Site.Line, Attrs: attrs("module", moduleOf[item.Package])})
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
			b.Node(graph.Node{ID: typeID, Kind: graph.KindType, Label: shortPackage(implementation.Package) + "." + implementation.Type, Package: implementation.Package, File: implementation.Site.Path, Line: implementation.Site.Line, Attrs: attrs("module", moduleOf[implementation.Package])})
			b.Edge(typeID, iface, graph.EdgeImplements, "")
		}
	}

	for _, entry := range report.Entries {
		switch entry.Kind {
		case "http":
			endpoint := "http:" + entry.Name
			b.Node(graph.Node{ID: endpoint, Kind: graph.KindEndpoint, Label: entry.Name, Package: entry.Package, File: entry.Site.Path, Line: entry.Site.Line, Attrs: attrs("framework", entry.Detail)})
			handler := ""
			if entry.HandlerSite != nil {
				handler = bySite[entry.HandlerSite.Path+"\x00"+strconv.Itoa(entry.HandlerSite.Line)]
			}
			if handler == "" {
				handler = lookup(entry.Package, entry.Handler)
			}
			if handler == "" {
				// Handler anonimo (func literal): lo serve la funzione che registra la route.
				handler = lookup(entry.Package, entry.Function)
			}
			b.Edge(handler, endpoint, graph.EdgeHandles, "")
		case "grpc":
			rpc := "grpc:" + entry.Name
			b.Node(graph.Node{ID: rpc, Kind: graph.KindRPC, Label: entry.Name, Package: entry.Package, File: entry.Site.Path, Line: entry.Site.Line, Attrs: attrs("server", entry.Detail)})
			// Il servizio è servito da tutti i metodi del tipo registrato.
			server := path.Base(strings.TrimPrefix(entry.Detail, "*"))
			if _, short, ok := strings.Cut(server, "."); ok {
				server = short
			}
			for _, function := range report.Functions {
				if function.Package == entry.Package && strings.HasPrefix(function.Name, server+".") {
					b.Edge(fnNode(function.ID), rpc, graph.EdgeHandles, "")
				}
			}
		case "kafka-producer", "kafka-consumer":
			function := lookup(entry.Package, entry.Function)
			edgeKind := graph.EdgeProduces
			if entry.Kind == "kafka-consumer" {
				edgeKind = graph.EdgeConsumes
			}
			for _, topic := range entry.Topics {
				topicID := "topic:" + topic
				b.Node(graph.Node{ID: topicID, Kind: graph.KindTopic, Label: topic, Attrs: attrs("broker", "kafka")})
				b.Edge(function, topicID, edgeKind, entry.TopicRoles[topic])
			}
		case "main", "init", "job", "cli":
			entryID := "entry:" + entry.Kind + ":" + entry.Package + ":" + entry.Name
			b.Node(graph.Node{ID: entryID, Kind: graph.KindEntry, Label: entry.Kind + " " + entry.Name, Package: entry.Package, File: entry.Site.Path, Line: entry.Site.Line, Attrs: attrs("entry", entry.Kind)})
			b.Edge(entryID, lookup(entry.Package, entry.Function), graph.EdgeStarts, "")
		}
	}

	for _, query := range report.Queries {
		function := lookup(query.Package, query.Function)
		for _, table := range query.Tables {
			tableID := "table:" + strings.ToLower(table)
			b.Node(graph.Node{ID: tableID, Kind: graph.KindTable, Label: table, Attrs: attrs("library", query.Library)})
			b.Edge(function, tableID, graph.EdgeQueries, query.Operation)
		}
	}
	return b
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
