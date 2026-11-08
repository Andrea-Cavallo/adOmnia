package java

import (
	"bytes"
	"regexp"
	"strings"
)

// WebServiceEndpoint is a JAX-WS endpoint (@WebService or @WebServiceProvider): the code behind a WSDL.
type WebServiceEndpoint struct {
	Class string `json:"class"`
	Short string `json:"short"`
	File  string `json:"file"`
	Line  int    `json:"line"`
	// ServiceName is the WSDL <service> name: serviceName, else the class name + "Service" (JAX-WS default).
	ServiceName  string                `json:"serviceName"`
	Namespace    string                `json:"namespace,omitempty"`
	WSDLLocation string                `json:"wsdlLocation,omitempty"`
	Interface    bool                  `json:"interface,omitzero"`
	Operations   []WebServiceOperation `json:"operations,omitempty"`
}

// WebServiceOperation is one WSDL operation and the method that implements it.
type WebServiceOperation struct {
	Name   string `json:"name"`
	Method string `json:"method"`
	Line   int    `json:"line"`
}

// MessageDrivenBean is an EJB that consumes a JMS destination.
type MessageDrivenBean struct {
	Class       string `json:"class"`
	File        string `json:"file"`
	Line        int    `json:"line"`
	Destination string `json:"destination"`
	// Kind is "queue" or "topic" when the activation config says it.
	Kind string `json:"kind,omitempty"`
}

var (
	activationProperty = regexp.MustCompile(`propertyName\s*=\s*"([^"]+)"\s*,\s*propertyValue\s*=\s*"([^"]*)"`)
	excludedWebMethod  = regexp.MustCompile(`\bexclude\s*=\s*true\b`)
)

// WebServicesInFile finds the JAX-WS endpoints and service interfaces of one source.
func WebServicesInFile(relativePath string, data []byte) []WebServiceEndpoint {
	if !bytes.Contains(data, []byte("WebService")) {
		return nil
	}
	source := parseJavaSource(data)
	var endpoints []WebServiceEndpoint
	for _, decl := range source.Types {
		annotation := findAnnotation(decl.Annotations, "WebService")
		if annotation == nil {
			annotation = findAnnotation(decl.Annotations, "WebServiceProvider")
		}
		if annotation == nil {
			continue
		}
		service := annotationString(annotation.Args, "serviceName")
		if service == "" {
			service = decl.Short + "Service"
		}
		endpoints = append(endpoints, WebServiceEndpoint{
			Class: decl.Name, Short: decl.Short, File: relativePath, Line: decl.Line, ServiceName: service,
			Namespace: annotationString(annotation.Args, "targetNamespace"), WSDLLocation: annotationString(annotation.Args, "wsdlLocation"),
			Interface: decl.Kind == "interface", Operations: webServiceOperations(source, decl),
		})
	}
	return endpoints
}

// webServiceOperations are the @WebMethod methods, or every method when none is annotated (the JAX-WS
// rule for public methods; the light parser cannot see `public`, so private helpers may show up).
func webServiceOperations(source javaSource, decl javaTypeDecl) []WebServiceOperation {
	var annotated, all []WebServiceOperation
	for _, member := range source.Members {
		if member.Kind != "method" || member.Class != decl.Name {
			continue
		}
		operation := WebServiceOperation{Name: member.Name, Method: member.Name, Line: member.Line}
		all = append(all, operation)
		if webMethod := findAnnotation(member.Annotations, "WebMethod"); webMethod != nil {
			if excludedWebMethod.MatchString(webMethod.Args) {
				continue
			}
			if name := annotationString(webMethod.Args, "operationName"); name != "" {
				operation.Name = name
			}
			annotated = append(annotated, operation)
		}
	}
	if len(annotated) > 0 {
		return annotated
	}
	return all
}

// MessageDrivenBeansInFile finds the @MessageDriven beans and the destination they listen to.
func MessageDrivenBeansInFile(relativePath string, data []byte) []MessageDrivenBean {
	if !bytes.Contains(data, []byte("MessageDriven")) {
		return nil
	}
	source := parseJavaSource(data)
	var beans []MessageDrivenBean
	for _, decl := range source.Types {
		annotation := findAnnotation(decl.Annotations, "MessageDriven")
		if annotation == nil {
			continue
		}
		bean := MessageDrivenBean{Class: decl.Name, File: relativePath, Line: decl.Line, Destination: annotationString(annotation.Args, "mappedName")}
		for _, match := range activationProperty.FindAllStringSubmatch(annotation.Args, -1) {
			switch match[1] {
			case "destination", "destinationLookup":
				bean.Destination = match[2]
			case "destinationType":
				bean.Kind = destinationKind(match[2])
			}
		}
		if bean.Destination != "" {
			beans = append(beans, bean)
		}
	}
	return beans
}

func destinationKind(value string) string {
	switch {
	case strings.HasSuffix(value, "Topic"):
		return "topic"
	case strings.HasSuffix(value, "Queue"):
		return "queue"
	}
	return ""
}

// SOAPEndpointMapping publishes an implementation class at a URL: sun-jaxws.xml (JAX-WS RI, Metro) or a
// CXF <jaxws:endpoint>.
type SOAPEndpointMapping struct {
	Class string `json:"class"`
	URL   string `json:"url"`
	Line  int    `json:"line"`
}

var (
	riEndpoint  = regexp.MustCompile(`<endpoint\b[^>]*>`)
	cxfEndpoint = regexp.MustCompile(`<(?:jaxws:endpoint|jaxws:server)\b[^>]*>`)
	xmlAttr     = regexp.MustCompile(`([\w:-]+)\s*=\s*"([^"]*)"`)
)

// SOAPEndpointMappings reads the endpoints of sun-jaxws.xml or of a CXF configuration. A CXF endpoint
// that names a bean (`#orderService`) keeps the bean name: it is resolved only when it is a class.
func SOAPEndpointMappings(data []byte) []SOAPEndpointMapping {
	var mappings []SOAPEndpointMapping
	add := func(element string, offset int, classKey, urlKey string) {
		attributes := map[string]string{}
		for _, match := range xmlAttr.FindAllStringSubmatch(element, -1) {
			attributes[match[1]] = match[2]
		}
		class, url := strings.TrimSpace(attributes[classKey]), strings.TrimSpace(attributes[urlKey])
		if class == "" || url == "" || strings.Contains(url, "://") {
			return
		}
		mappings = append(mappings, SOAPEndpointMapping{Class: class, URL: url, Line: 1 + bytes.Count(data[:offset], []byte("\n"))})
	}
	for _, index := range riEndpoint.FindAllIndex(data, -1) {
		add(string(data[index[0]:index[1]]), index[0], "implementation", "url-pattern")
	}
	for _, index := range cxfEndpoint.FindAllIndex(data, -1) {
		element := string(data[index[0]:index[1]])
		classKey := "implementor"
		if !strings.Contains(element, "implementor=") {
			classKey = "serviceBean"
		}
		add(element, index[0], classKey, "address")
	}
	return mappings
}

var (
	wsdlService   = regexp.MustCompile(`<(?:\w+:)?service\b[^>]*\bname\s*=\s*"([^"]+)"`)
	wsdlNamespace = regexp.MustCompile(`<(?:\w+:)?definitions\b[^>]*\btargetNamespace\s*=\s*"([^"]+)"`)
)

// WSDLServices are the <service> names and the target namespace of a WSDL 1.1 document.
func WSDLServices(data []byte) (services []string, namespace string) {
	for _, match := range wsdlService.FindAllSubmatch(data, -1) {
		services = append(services, string(match[1]))
	}
	if match := wsdlNamespace.FindSubmatch(data); match != nil {
		namespace = string(match[1])
	}
	return services, namespace
}
