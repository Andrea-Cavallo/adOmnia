package devcontext

import (
	"bytes"
	"encoding/json"
	"strconv"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/languages/java"
)

// detectJavaFile: gli endpoint Spring MVC (@RestController, @RequestMapping…) diventano route come quelle Go,
// così API Workspace, Mock, cURL e Live Session funzionano uguale a prescindere dal linguaggio.
func detectJavaFile(rel string, data []byte) []Entity {
	hasType := bytes.Contains(data, []byte("class ")) || bytes.Contains(data, []byte("record ")) || bytes.Contains(data, []byte("interface "))
	if !hasType && !bytes.Contains(data, []byte("Mapping")) && !bytes.Contains(data, []byte("@Path")) && !bytes.Contains(data, []byte("@GET")) {
		return nil // cheap exit: most sources are not controllers or DTOs
	}
	out := detectServlets(rel, data)
	if bytes.Contains(data, []byte("Mapping")) || bytes.Contains(data, []byte("@Path")) || bytes.Contains(data, []byte("@GET")) {
		out = append(out, javaRoutes(rel, data)...)
	}
	// Controllers/services are not request DTOs: skipping them keeps the scan
	// close to its previous cost in large Java projects.
	component := false
	for _, marker := range []string{"@RestController", "@Controller", "@Service", "@Repository", "@Configuration", "@Component", "@Path", "Servlet"} {
		if bytes.Contains(data, []byte(marker)) {
			component = true
			break
		}
	}
	if !component {
		for _, body := range java.BodyDeclsInFile(rel, data) {
			attrs := map[string]string{"name": body.Name, "fullName": body.FullName, "example": body.Example}
			if fields, err := json.Marshal(body.Fields); err == nil {
				attrs["fields"] = string(fields)
			}
			out = append(out, Entity{
				ID: bodyDeclKind + ":" + rel + ":" + strconv.Itoa(body.Line), Kind: bodyDeclKind, Label: body.Name,
				Attrs:      attrs,
				Sources:    []Source{{Detector: "javabodies", File: rel, Line: body.Line}},
				Confidence: ConfidenceInferred,
			})
		}
	}
	return out
}

func javaRoutes(rel string, data []byte) []Entity {
	var out []Entity
	for _, endpoint := range java.EndpointsInFile(rel, data) {
		method := endpoint.Method
		if method == "" {
			method = "ANY"
		}
		attrs := map[string]string{
			"declName": endpoint.Class + "." + endpoint.Member,
			"declFile": rel,
			"declLine": strconv.Itoa(endpoint.Line),
		}
		if params := javaRequestParams(endpoint.Params); params != "" {
			attrs["requestParams"] = params
		}
		if endpoint.BodyType != "" {
			attrs["requestBodyType"] = endpoint.BodyType
			if endpoint.BodyArray {
				attrs["requestBodyArray"] = "true"
			}
			contentType := "application/json"
			if endpoint.Consumes != "" {
				contentType = strings.TrimSpace(strings.Split(endpoint.Consumes, ",")[0])
			}
			attrs["requestContentType"] = contentType
		}
		path := endpoint.Path
		if path == "" || path[0] != '/' {
			path = "/" + path
		}
		out = append(out, routeEntity(method, path, ConfidenceInferred, attrs, Source{"springroutes", rel, endpoint.Line}))
	}
	return out
}

func javaRequestParams(params []java.SpringParam) string {
	if len(params) == 0 {
		return ""
	}
	data, err := json.Marshal(params)
	if err != nil {
		return ""
	}
	return string(data)
}
