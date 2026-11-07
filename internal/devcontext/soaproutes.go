package devcontext

import (
	"maps"
	"path"
	"strconv"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/languages/java"
)

// Internal kinds of JAX-WS: an implementation class and an endpoint mapping (sun-jaxws.xml, CXF) become a
// SOAP route at snapshot time, and the WSDL contract learns which class implements it.
const (
	soapImplKind    = "soapimpl"
	soapMappingKind = "soapmapping"
	soapContentType = "text/xml; charset=utf-8"
)

func isSOAPEndpointConfig(base string) bool {
	lower := strings.ToLower(base)
	return lower == "sun-jaxws.xml" || (strings.HasSuffix(lower, ".xml") && strings.Contains(lower, "cxf"))
}

// detectJavaEnterprise: JAX-WS endpoints become internal entities, message-driven beans JMS topics.
func detectJavaEnterprise(rel string, data []byte) []Entity {
	var out []Entity
	for _, endpoint := range java.WebServicesInFile(rel, data) {
		if endpoint.Interface {
			continue // the service endpoint interface: the implementation is what answers
		}
		operations := make([]string, 0, len(endpoint.Operations))
		attrs := map[string]string{
			"class": endpoint.Class, "service": endpoint.ServiceName, "namespace": endpoint.Namespace,
			"wsdlLocation": endpoint.WSDLLocation, "file": rel, "line": strconv.Itoa(endpoint.Line),
		}
		for _, operation := range endpoint.Operations {
			operations = append(operations, operation.Name)
			attrs["op."+operation.Name] = strconv.Itoa(operation.Line)
		}
		attrs["operations"] = strings.Join(operations, ",")
		out = append(out, Entity{
			ID: soapImplKind + ":" + endpoint.Class, Kind: soapImplKind, Label: endpoint.ServiceName, Attrs: attrs,
			Sources: []Source{{Detector: "jaxws", File: rel, Line: endpoint.Line}}, Confidence: ConfidenceInferred,
		})
	}
	for _, bean := range java.MessageDrivenBeansInFile(rel, data) {
		attrs := map[string]string{"broker": "jms", "declFile": rel, "declLine": strconv.Itoa(bean.Line), "declName": bean.Class}
		if bean.Kind != "" {
			attrs["destinationType"] = bean.Kind
		}
		out = append(out, entity("topic", bean.Destination, bean.Destination, ConfidenceInferred, attrs, Source{"ejb", rel, bean.Line}))
	}
	return out
}

func detectSOAPEndpointConfig(rel string, data []byte) []Entity {
	var out []Entity
	for _, mapping := range java.SOAPEndpointMappings(data) {
		out = append(out, Entity{
			ID: soapMappingKind + ":" + rel + ":" + mapping.URL, Kind: soapMappingKind, Label: mapping.URL,
			Attrs:   map[string]string{"class": mapping.Class, "url": mapping.URL, "file": rel, "line": strconv.Itoa(mapping.Line)},
			Sources: []Source{{Detector: "jaxws", File: rel, Line: mapping.Line}}, Confidence: ConfidenceCertain,
		})
	}
	return out
}

// linkSOAP turns each implementation into a POST route (at its mapped URL, else /<serviceName>, the Java EE
// default) and points the matching WSDL contract at the class.
func linkSOAP(entities []Entity) []Entity {
	var impls, mappings []Entity
	rest := make([]Entity, 0, len(entities))
	for _, e := range entities {
		switch e.Kind {
		case soapImplKind:
			impls = append(impls, e)
		case soapMappingKind:
			mappings = append(mappings, e)
		default:
			rest = append(rest, e)
		}
	}
	if len(impls) == 0 {
		return rest
	}
	var routes []Entity
	for _, impl := range impls {
		contract := linkWSDLContract(rest, impl)
		for _, endpoint := range soapURLs(impl, mappings) {
			attrs := map[string]string{
				"declName": impl.Attrs["class"], "declFile": impl.Attrs["file"], "declLine": impl.Attrs["line"],
				"soapService": impl.Attrs["service"], "soapOperations": impl.Attrs["operations"],
				"requestContentType": soapContentType,
			}
			if contract != "" {
				attrs["contract"] = contract
			}
			if impl.Attrs["namespace"] != "" {
				attrs["soapNamespace"] = impl.Attrs["namespace"]
			}
			routes = append(routes, routeEntity("POST", endpoint.url, endpoint.confidence, attrs, endpoint.source))
		}
	}
	return merge(rest, routes)
}

type soapURL struct {
	url        string
	confidence string
	source     Source
}

func soapURLs(impl Entity, mappings []Entity) []soapURL {
	var urls []soapURL
	for _, mapping := range mappings {
		if mapping.Attrs["class"] == impl.Attrs["class"] {
			urls = append(urls, soapURL{java.ServletRoutePath(mapping.Attrs["url"]), ConfidenceCertain, mapping.Sources[0]})
		}
	}
	if len(urls) == 0 {
		urls = append(urls, soapURL{"/" + impl.Attrs["service"], ConfidenceInferred, impl.Sources[0]})
	}
	return urls
}

// linkWSDLContract finds the WSDL of the implementation (wsdlLocation, else a WSDL declaring the service)
// and adds the code to it, so the contract opens the class that serves it. Returns the contract path.
func linkWSDLContract(entities []Entity, impl Entity) string {
	location := strings.TrimPrefix(path.Clean("/"+impl.Attrs["wsdlLocation"]), "/")
	for index := range entities {
		contract := &entities[index]
		if contract.Kind != "contract" || contract.Attrs["type"] != "wsdl" {
			continue
		}
		byLocation := location != "" && location != "." && strings.HasSuffix(contract.Attrs["path"], location)
		byService := containsWord(contract.Attrs["services"], impl.Attrs["service"])
		if !byLocation && !byService {
			continue
		}
		attrs := make(map[string]string, len(contract.Attrs)+3)
		maps.Copy(attrs, contract.Attrs)
		attrs["declName"], attrs["declFile"], attrs["declLine"] = impl.Attrs["class"], impl.Attrs["file"], impl.Attrs["line"]
		contract.Attrs = attrs // the per-file cache keeps its own map
		return contract.Attrs["path"]
	}
	return ""
}

func containsWord(list, word string) bool {
	for item := range strings.SplitSeq(list, ",") {
		if item == word {
			return true
		}
	}
	return false
}
