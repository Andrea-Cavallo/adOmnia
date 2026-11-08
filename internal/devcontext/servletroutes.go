package devcontext

import (
	"encoding/json"
	"strconv"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/languages/java"
)

// Internal kinds: a servlet class and a web.xml mapping only become routes together, at snapshot time,
// because the URL lives in web.xml and the code in the .java file. Neither reaches the snapshot.
const (
	servletClassKind   = "servletclass"
	servletMappingKind = "servletmapping"
)

// frameworkServletPrefixes are servlets that dispatch to other code (Spring's DispatcherServlet, Jersey,
// CXF, Faces…): their mapping is not an endpoint, the controllers behind them are.
var frameworkServletPrefixes = []string{
	"org.springframework.", "org.apache.", "org.glassfish.", "com.sun.", "javax.", "jakarta.",
	"org.eclipse.", "org.jboss.", "io.undertow.", "com.ibm.", "weblogic.", "org.primefaces.",
}

func isWebDescriptor(base string) bool { return base == "web.xml" || base == "web-fragment.xml" }

// detectServlets turns the servlets of a .java file into internal entities for linkServlets.
func detectServlets(rel string, data []byte) []Entity {
	var out []Entity
	for _, servlet := range java.ServletsInFile(rel, data) {
		attrs := map[string]string{"class": servlet.Class, "short": servlet.Short, "file": rel, "line": strconv.Itoa(servlet.Line)}
		if encoded, err := json.Marshal(servlet.Methods); err == nil {
			attrs["methods"] = string(encoded)
		}
		if len(servlet.Patterns) > 0 {
			attrs["patterns"] = strings.Join(servlet.Patterns, "\n")
		}
		out = append(out, Entity{
			ID: servletClassKind + ":" + servlet.Class, Kind: servletClassKind, Label: servlet.Short, Attrs: attrs,
			Sources: []Source{{Detector: "servlets", File: rel, Line: servlet.Line}}, Confidence: ConfidenceInferred,
		})
	}
	return out
}

// detectWebXML turns the servlet mappings of a deployment descriptor into internal entities.
func detectWebXML(rel string, data []byte) []Entity {
	var out []Entity
	for _, mapping := range java.WebXMLMappings(data) {
		if mapping.Class == "" && mapping.JSPFile == "" {
			continue
		}
		attrs := map[string]string{"class": mapping.Class, "jspFile": mapping.JSPFile, "pattern": mapping.Pattern, "servlet": mapping.Servlet, "file": rel, "line": strconv.Itoa(mapping.Line)}
		out = append(out, Entity{
			ID: servletMappingKind + ":" + rel + ":" + mapping.Pattern, Kind: servletMappingKind, Label: mapping.Pattern, Attrs: attrs,
			Sources: []Source{{Detector: "webxml", File: rel, Line: mapping.Line}}, Confidence: ConfidenceCertain,
		})
	}
	return out
}

// linkServlets replaces the internal servlet entities with routes: one per URL pattern (from @WebServlet
// or web.xml) and per overridden doGet/doPost/…, pointing at the method in the .java file. A web.xml
// servlet whose class is not in the project (a jar) still becomes a route, pointing at web.xml.
func linkServlets(entities []Entity) []Entity {
	classes := map[string]Entity{}
	var mappings []Entity
	rest := make([]Entity, 0, len(entities))
	for _, e := range entities {
		switch e.Kind {
		case servletClassKind:
			classes[e.Attrs["class"]] = e
		case servletMappingKind:
			mappings = append(mappings, e)
		default:
			rest = append(rest, e)
		}
	}
	if len(classes) == 0 && len(mappings) == 0 {
		return entities
	}
	var routes []Entity
	for _, servlet := range classes {
		for pattern := range strings.SplitSeq(servlet.Attrs["patterns"], "\n") {
			if pattern != "" {
				routes = append(routes, servletRoutes(servlet, pattern, Source{Detector: "servlets", File: servlet.Attrs["file"], Line: atoi(servlet.Attrs["line"])})...)
			}
		}
	}
	for _, mapping := range mappings {
		routes = append(routes, mappingRoutes(mapping, classes)...)
	}
	return merge(rest, routes)
}

func mappingRoutes(mapping Entity, classes map[string]Entity) []Entity {
	source := Source{Detector: "webxml", File: mapping.Attrs["file"], Line: atoi(mapping.Attrs["line"])}
	pattern, class := mapping.Attrs["pattern"], mapping.Attrs["class"]
	if servlet, ok := classes[class]; ok {
		return servletRoutes(servlet, pattern, source)
	}
	if isFrameworkServlet(class) {
		return nil
	}
	attrs := map[string]string{"servletPattern": pattern, "declFile": mapping.Attrs["file"], "declLine": mapping.Attrs["line"]}
	if class != "" {
		attrs["declName"] = class
	} else {
		attrs["declName"] = mapping.Attrs["jspFile"]
	}
	return []Entity{routeEntity("ANY", java.ServletRoutePath(pattern), ConfidenceCertain, attrs, source)}
}

// servletRoutes are the routes of one servlet at one pattern: a route per handler method, ANY without one.
func servletRoutes(servlet Entity, pattern string, source Source) []Entity {
	var methods []java.ServletMethod
	_ = json.Unmarshal([]byte(servlet.Attrs["methods"]), &methods) // written by detectServlets; empty means ANY
	path := java.ServletRoutePath(pattern)
	confidence := ConfidenceInferred
	if source.Detector == "webxml" {
		confidence = ConfidenceCertain
	}
	attrs := func(member string, line int) map[string]string {
		return map[string]string{
			"declName": servlet.Attrs["class"] + "." + member, "declFile": servlet.Attrs["file"], "declLine": strconv.Itoa(line),
			"servletPattern": pattern,
		}
	}
	if len(methods) == 0 {
		return []Entity{routeEntity("ANY", path, confidence, attrs(servlet.Attrs["short"], atoi(servlet.Attrs["line"])), source)}
	}
	routes := make([]Entity, 0, len(methods))
	for _, method := range methods {
		routes = append(routes, routeEntity(method.HTTP, path, confidence, attrs(method.Name, method.Line), source))
	}
	return routes
}

func isFrameworkServlet(class string) bool {
	for _, prefix := range frameworkServletPrefixes {
		if strings.HasPrefix(class, prefix) {
			return true
		}
	}
	return false
}

func atoi(value string) int {
	number, _ := strconv.Atoi(value) // attrs written by this package; 0 means unknown
	return number
}
