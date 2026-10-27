package devcontext

import (
	"bytes"
	"strconv"

	"github.com/Andrea-Cavallo/adOmnia/internal/languages/java"
)

// detectJavaFile: gli endpoint Spring MVC (@RestController, @RequestMapping…) diventano route come quelle Go,
// così API Workspace, Mock, cURL e Live Session funzionano uguale a prescindere dal linguaggio.
func detectJavaFile(rel string, data []byte) []Entity {
	if !bytes.Contains(data, []byte("Mapping")) {
		return nil // cheap exit: most sources are not controllers
	}
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
		path := endpoint.Path
		if path == "" || path[0] != '/' {
			path = "/" + path
		}
		out = append(out, routeEntity(method, path, ConfidenceInferred, attrs, Source{"springroutes", rel, endpoint.Line}))
	}
	return out
}
