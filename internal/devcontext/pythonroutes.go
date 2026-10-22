package devcontext

import (
	"bytes"
	"strconv"

	"adomnia/internal/languages/python"
)

// detectPythonFile: gli endpoint FastAPI, Flask e Django diventano route come quelle Go e Spring,
// così API Workspace, Mock, cURL e Live Session funzionano uguale a prescindere dal linguaggio.
// Il riconoscimento è statico (nessuna esecuzione, nessun import): sta nell'adapter Python.
func detectPythonFile(rel string, data []byte) []Entity {
	// Cheap exit: un file senza decoratori né urlpatterns non è un servizio HTTP.
	if !bytes.Contains(data, []byte("(")) || (!bytes.Contains(data, []byte("@")) && !bytes.Contains(data, []byte("path"))) {
		return nil
	}
	var out []Entity
	for _, endpoint := range python.EndpointsInFile(rel, data) {
		attrs := map[string]string{
			"declFile": rel,
			"declLine": strconv.Itoa(endpoint.Line),
			"language": "python",
		}
		if endpoint.Handler != "" {
			attrs["declName"] = endpoint.Handler
		}
		if endpoint.WebSocket {
			// Stessa forma del rilevatore Go: il WSPanel apre il server a partire da questa entità.
			attrs["role"], attrs["path"] = "server", normalizePath(endpoint.Path)
			attrs["handler"] = endpoint.Handler
			label := endpoint.Handler
			if normalized := normalizePath(endpoint.Path); normalized != "" {
				label = normalized
			}
			out = append(out, entity("websocket", "server:"+rel+":"+endpoint.Handler, label, ConfidenceInferred,
				attrs, Source{"pythonroutes", rel, endpoint.Line}))
			continue
		}
		out = append(out, routeEntity(endpoint.Method, endpoint.Path, ConfidenceInferred, attrs, Source{"pythonroutes", rel, endpoint.Line}))
	}
	return out
}
