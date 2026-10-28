package devcontext

import (
	"bytes"
	"strconv"

	"github.com/Andrea-Cavallo/adOmnia/internal/languages/rust"
)

// detectRustGrpc: i servizi tonic diventano entità grpc come quelle Go e dei `.proto`, così il
// pannello gRPC e il Mock leggono gli stessi servizi a prescindere dal linguaggio.
func detectRustGrpc(rel string, data []byte) []Entity {
	if !bytes.Contains(data, []byte("include_proto")) && !bytes.Contains(data, []byte("async_trait")) &&
		!bytes.Contains(data, []byte("compile_protos")) {
		return nil
	}
	var out []Entity
	for _, ref := range rust.GrpcServicesInFile(rel, data) {
		name := ref.Service
		if name == "" {
			name = ref.Proto
		}
		attrs := map[string]string{
			"language": "rust",
			"declFile": rel,
			"declLine": strconv.Itoa(ref.Line),
		}
		if ref.Service != "" {
			attrs["service"] = ref.Service
		}
		if ref.Proto != "" {
			attrs["proto"] = ref.Proto
		}
		out = append(out, entity("grpc", name, name, ConfidenceInferred, attrs, Source{"rustgrpc", rel, ref.Line}))
	}
	return out
}

// detectRustWebSocket: gli handler WebSocket (axum WebSocketUpgrade, actix-ws) e SSE (axum Sse)
// diventano entità websocket con il percorso della route che li espone, come per Go e FastAPI.
func detectRustWebSocket(rel string, data []byte) []Entity {
	if !bytes.Contains(data, []byte("WebSocketUpgrade")) && !bytes.Contains(data, []byte("ws::WebSocket")) &&
		!bytes.Contains(data, []byte("Sse<")) {
		return nil
	}
	var out []Entity
	for _, ref := range rust.WebSocketsInFile(rel, data) {
		label := ref.Handler
		if ref.Path != "" {
			label = ref.Path
		}
		attrs := map[string]string{
			"role":     "server",
			"handler":  ref.Handler,
			"language": "rust",
			"declFile": rel,
			"declLine": strconv.Itoa(ref.Line),
		}
		if ref.Path != "" {
			attrs["path"] = ref.Path
		}
		if ref.SSE {
			attrs["sse"] = "true"
		}
		out = append(out, entity("websocket", "server:"+rel+":"+ref.Handler, label, ConfidenceInferred, attrs, Source{"rustwebsocket", rel, ref.Line}))
	}
	return out
}
