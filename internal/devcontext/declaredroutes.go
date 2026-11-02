package devcontext

import (
	"strconv"

	"github.com/Andrea-Cavallo/adOmnia/internal/languages/declared"
)

// detectDeclaredFile: ASP.NET, Laravel/Symfony, Rails/Sinatra, Phoenix and Vapor routes become route
// entities like Go, Spring and FastAPI ones, so API Workspace, Mock, cURL and Live Session see them.
// The static parsing lives in the declared-languages adapter; here they only map to entities.
func detectDeclaredFile(rel string, data []byte) []Entity {
	var out []Entity
	for _, endpoint := range declared.EndpointsInFile(rel, data) {
		attrs := map[string]string{
			"declFile":  rel,
			"declLine":  strconv.Itoa(endpoint.Line),
			"language":  endpoint.Language,
			"framework": endpoint.Framework,
		}
		if endpoint.Handler != "" {
			attrs["declName"] = endpoint.Handler
		}
		out = append(out, routeEntity(endpoint.Method, endpoint.Path, ConfidenceInferred, attrs, Source{endpoint.Framework + "routes", rel, endpoint.Line}))
	}
	return out
}
