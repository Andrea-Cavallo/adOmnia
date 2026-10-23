package devcontext

import (
	"bytes"
	"strconv"

	"adomnia/internal/languages/rust"
)

// detectRustFile è l'entry point per i sorgenti `.rs` in Developer Context: route (axum/actix/
// rocket) più riferimenti a database (sqlx/diesel/sea-orm e stringhe di connessione).
func detectRustFile(rel string, data []byte) []Entity {
	var out []Entity
	out = append(out, detectRustRoutes(rel, data)...)
	out = append(out, detectRustDatabase(rel, data)...)
	out = append(out, detectRustEnv(rel, data)...)
	out = append(out, detectRustGrpc(rel, data)...)
	out = append(out, detectRustWebSocket(rel, data)...)
	out = append(out, detectRustBroker(rel, data)...)
	out = append(out, detectRustOpenApi(rel, data)...)
	return out
}

// detectRustRoutes: le route axum, actix-web e rocket diventano route come quelle Go, Spring e
// FastAPI, così API Workspace, Mock, cURL e Live Session funzionano uguale a prescindere dal
// linguaggio. Il riconoscimento è statico (nessuna esecuzione, nessun build.rs): sta nell'adapter
// `internal/languages/rust`, qui si mappa solo sulle entità comuni (come `javaroutes.go` riusa
// `java.EndpointsInFile`).
func detectRustRoutes(rel string, data []byte) []Entity {
	// Cheap exit: senza `route`, attributi o `web::` non è un servizio HTTP.
	if !bytes.Contains(data, []byte("route")) && !bytes.Contains(data, []byte("#[")) && !bytes.Contains(data, []byte("web::")) {
		return nil
	}
	var out []Entity
	for _, endpoint := range rust.EndpointsInFile(rel, data) {
		attrs := map[string]string{
			"declFile": rel,
			"declLine": strconv.Itoa(endpoint.Line),
			"language": "rust",
		}
		if endpoint.Handler != "" {
			attrs["declName"] = endpoint.Handler
		}
		method := endpoint.Method
		if method == "" {
			method = "ANY"
		}
		out = append(out, routeEntity(method, endpoint.Path, ConfidenceInferred, attrs, Source{"rustroutes", rel, endpoint.Line}))
	}
	return out
}
