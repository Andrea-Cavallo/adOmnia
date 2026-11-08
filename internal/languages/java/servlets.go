package java

import (
	"bytes"
	"encoding/xml"
	"strings"
)

// Servlet is a class that serves HTTP through the Servlet API (javax.servlet or jakarta.servlet): the
// entry point of WAR applications before Spring MVC and JAX-RS.
type Servlet struct {
	Class string `json:"class"` // qualified (`com.acme.OrderServlet`)
	Short string `json:"short"`
	File  string `json:"file"`
	Line  int    `json:"line"`
	// Patterns are the URL patterns of `@WebServlet` (Servlet 3.0); web.xml adds the others.
	Patterns []string        `json:"patterns,omitempty"`
	Methods  []ServletMethod `json:"methods,omitempty"`
}

// ServletMethod is an overridden doGet/doPost/…, or `service` (every method).
type ServletMethod struct {
	HTTP string `json:"http"` // GET, POST… or ANY for service()
	Name string `json:"name"`
	Line int    `json:"line"`
}

// servletHandlers maps the HttpServlet methods to the HTTP method they answer.
var servletHandlers = map[string]string{
	"doGet": "GET", "doPost": "POST", "doPut": "PUT", "doDelete": "DELETE",
	"doHead": "HEAD", "doOptions": "OPTIONS", "doPatch": "PATCH", "service": "ANY",
}

// ServletsInFile finds the servlets of one source: a class extending HttpServlet, annotated with
// @WebServlet, or overriding doGet/doPost/… with a servlet request (a subclass of a project base servlet).
func ServletsInFile(relativePath string, data []byte) []Servlet {
	if !bytes.Contains(data, []byte("Servlet")) {
		return nil
	}
	source := parseJavaSource(data)
	var servlets []Servlet
	for _, decl := range source.Types {
		if decl.Kind != "class" {
			continue
		}
		annotation := findAnnotation(decl.Annotations, "WebServlet")
		methods := servletMethodsOf(source, decl)
		if annotation == nil && len(methods) == 0 && !extendsHttpServlet(decl) {
			continue
		}
		servlet := Servlet{Class: decl.Name, Short: decl.Short, File: relativePath, Line: decl.Line, Methods: methods}
		if annotation != nil {
			servlet.Patterns = servletPatterns(annotation.Args)
		}
		servlets = append(servlets, servlet)
	}
	return servlets
}

func extendsHttpServlet(decl javaTypeDecl) bool {
	for _, supertype := range decl.Supertypes {
		if supertype == "HttpServlet" || strings.HasSuffix(supertype, ".HttpServlet") {
			return true
		}
	}
	return false
}

// servletMethodsOf are the handler overrides of the class: the name alone is not enough (a helper may be
// called doGet), the first parameter must be a servlet request.
func servletMethodsOf(source javaSource, decl javaTypeDecl) []ServletMethod {
	var methods []ServletMethod
	for _, member := range source.Members {
		http, ok := servletHandlers[member.Name]
		if !ok || member.Kind != "method" || member.Class != decl.Name || len(member.Params) == 0 {
			continue
		}
		if !strings.HasSuffix(cleanType(member.Params[0].Type), "ServletRequest") {
			continue
		}
		methods = append(methods, ServletMethod{HTTP: http, Name: member.Name, Line: member.Line})
	}
	return methods
}

// servletPatterns are the literals of @WebServlet that are URL patterns (`name = "x"` is not one).
func servletPatterns(args string) []string {
	var patterns []string
	for _, value := range annotationStrings(args) {
		if strings.HasPrefix(value, "/") || strings.HasPrefix(value, "*.") {
			patterns = append(patterns, value)
		}
	}
	return patterns
}

// WebXMLMapping is one `<servlet-mapping>` of a deployment descriptor, resolved to its servlet.
type WebXMLMapping struct {
	Servlet string `json:"servlet"`           // servlet-name
	Class   string `json:"class,omitempty"`   // servlet-class
	JSPFile string `json:"jspFile,omitempty"` // jsp-file, for a JSP published as a servlet
	Pattern string `json:"pattern"`
	Line    int    `json:"line"`
}

// maxWebXMLMappings bounds what a generated descriptor can produce.
const maxWebXMLMappings = 500

// WebXMLMappings reads the servlet mappings of a web.xml (or web-fragment.xml). A malformed descriptor
// yields the mappings read before the error.
func WebXMLMappings(data []byte) []WebXMLMapping {
	decoder := xml.NewDecoder(bytes.NewReader(data))
	decoder.Strict = false
	classes := map[string]WebXMLMapping{}
	var mappings []WebXMLMapping
	for len(mappings) < maxWebXMLMappings {
		offset := decoder.InputOffset()
		token, err := decoder.Token()
		if err != nil {
			break // io.EOF or a malformed tail: keep what was read
		}
		start, ok := token.(xml.StartElement)
		if !ok {
			continue
		}
		line := 1 + bytes.Count(data[:offset], []byte("\n"))
		switch start.Name.Local {
		case "servlet":
			var servlet struct {
				Name    string `xml:"servlet-name"`
				Class   string `xml:"servlet-class"`
				JSPFile string `xml:"jsp-file"`
			}
			if decoder.DecodeElement(&servlet, &start) == nil {
				classes[strings.TrimSpace(servlet.Name)] = WebXMLMapping{Class: strings.TrimSpace(servlet.Class), JSPFile: strings.TrimSpace(servlet.JSPFile)}
			}
		case "servlet-mapping":
			var mapping struct {
				Name     string   `xml:"servlet-name"`
				Patterns []string `xml:"url-pattern"`
			}
			if decoder.DecodeElement(&mapping, &start) != nil {
				continue
			}
			for _, pattern := range mapping.Patterns {
				if pattern = strings.TrimSpace(pattern); pattern != "" {
					mappings = append(mappings, WebXMLMapping{Servlet: strings.TrimSpace(mapping.Name), Pattern: pattern, Line: line})
				}
			}
		}
	}
	// Servlets may be declared after their mappings: resolve at the end.
	for index, mapping := range mappings {
		mappings[index].Class, mappings[index].JSPFile = classes[mapping.Servlet].Class, classes[mapping.Servlet].JSPFile
	}
	return mappings
}

// ServletRoutePath turns a servlet URL pattern into a route path: `/orders/*` and the default servlet `/`
// match every sub-path (`**`), an extension mapping `*.do` becomes `/{action}.do`.
func ServletRoutePath(pattern string) string {
	pattern = strings.TrimSpace(pattern)
	switch {
	case pattern == "" || pattern == "/" || pattern == "/*":
		return "/**"
	case strings.HasPrefix(pattern, "*."):
		return "/{action}" + pattern[1:]
	case strings.HasSuffix(pattern, "/*"):
		return strings.TrimSuffix(pattern, "*") + "**"
	case !strings.HasPrefix(pattern, "/"):
		return "/" + pattern
	}
	return pattern
}
