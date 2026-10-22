package rust

import (
	"regexp"
)

// GrpcRef è un servizio gRPC dichiarato in un sorgente Rust (tonic): il nome del servizio (trait)
// o del package proto, e l'eventuale riferimento al `.proto`.
type GrpcRef struct {
	Service string // nome del servizio (trait implementato) o del package proto
	Proto   string // riferimento al .proto (include_proto! o compile_protos), se noto
	Line    int
}

// WebSocketRef è un endpoint WebSocket o SSE: un handler che gestisce un upgrade WS o una risposta
// SSE, con il percorso della route che lo espone (vuoto se non collegabile staticamente).
type WebSocketRef struct {
	Handler string
	Path    string
	SSE     bool
	Line    int
}

var (
	// includeProto è `tonic::include_proto!("greeter")` / `include_proto!("greeter")`.
	includeProto = regexp.MustCompile(`(?:tonic::)?include_proto!\s*\(\s*"([^"]*)"`)
	// tonicImpl è `#[tonic::async_trait] impl Greeter for MyGreeter`.
	tonicImpl = regexp.MustCompile(`#\[tonic::async_trait\]\s*impl\s+([A-Za-z_]\w*)\s+for`)
	// compileProtos è `tonic_build::compile_protos("proto/x.proto")` (in build.rs).
	compileProtos = regexp.MustCompile(`tonic_build::compile_protos\s*\(\s*"([^"]*)"`)
	// wsHandler è `fn name(... WebSocketUpgrade ...)` (axum) o actix-ws `ws::WebSocket`.
	wsHandler = regexp.MustCompile(`(?s)(?:async\s+)?fn\s+([A-Za-z_]\w*)\s*\([^)]*?(?:WebSocketUpgrade|ws::WebSocket)\b[^)]*\)`)
	// sseHandler è `fn name(...) -> Sse<...>` (axum SSE).
	sseHandler = regexp.MustCompile(`(?s)(?:async\s+)?fn\s+([A-Za-z_]\w*)\s*\([^)]*\)\s*->\s*Sse\s*<`)
	// builderRoute associa `.route("path", verb(handler))` al nome del handler.
	builderRoute = regexp.MustCompile(`\.route\s*\(\s*"([^"]*)"\s*,\s*[^)]*\b(?:get|post|put|patch|delete|head|options|trace|any)\s*\(\s*([A-Za-z_]\w*)`)
)

// GrpcServicesInFile estrae i servizi gRPC tonic dichiarati staticamente. Tollerante.
func GrpcServicesInFile(relativePath string, data []byte) []GrpcRef {
	source := string(data)
	var refs []GrpcRef
	seen := map[string]bool{}
	emit := func(service, proto string, offset int) {
		key := "grpc:" + service + proto
		if seen[key] {
			return
		}
		seen[key] = true
		refs = append(refs, GrpcRef{Service: service, Proto: proto, Line: lineAt(source, offset)})
	}

	for _, loc := range includeProto.FindAllStringSubmatchIndex(source, -1) {
		emit(source[loc[2]:loc[3]], source[loc[2]:loc[3]], loc[0])
	}
	for _, loc := range tonicImpl.FindAllStringSubmatchIndex(source, -1) {
		emit(source[loc[2]:loc[3]], "", loc[0])
	}
	for _, loc := range compileProtos.FindAllStringSubmatchIndex(source, -1) {
		emit("", source[loc[2]:loc[3]], loc[0])
	}
	return refs
}

// WebSocketsInFile estrae gli endpoint WebSocket/SSE: un handler che riceve WebSocketUpgrade (axum)
// o ws::WebSocket (actix-ws), o che restituisce Sse. Il percorso arriva dalla route collegata.
func WebSocketsInFile(relativePath string, data []byte) []WebSocketRef {
	source := string(data)
	ws := map[string]bool{}
	sse := map[string]bool{}
	for _, m := range wsHandler.FindAllStringSubmatch(source, -1) {
		ws[m[1]] = true
	}
	for _, m := range sseHandler.FindAllStringSubmatch(source, -1) {
		sse[m[1]] = true
	}
	if len(ws) == 0 && len(sse) == 0 {
		return nil
	}

	lines := rustCodeLines(source)
	pathByHandler := map[string]string{}
	for _, e := range attributeEndpoints(lines) {
		if e.Handler != "" {
			pathByHandler[e.Handler] = e.Path
		}
	}
	for _, m := range builderRoute.FindAllStringSubmatch(source, -1) {
		pathByHandler[m[2]] = normalizeRustPath(m[1])
	}

	var refs []WebSocketRef
	for name := range ws {
		refs = append(refs, WebSocketRef{Handler: name, Path: pathByHandler[name], Line: fnLine(source, name)})
	}
	for name := range sse {
		if ws[name] {
			continue // un handler già WS con ritorno Sse resta un solo endpoint
		}
		refs = append(refs, WebSocketRef{Handler: name, Path: pathByHandler[name], SSE: true, Line: fnLine(source, name)})
	}
	return refs
}

// fnLine restituisce la riga 1-based della dichiarazione `fn name`.
func fnLine(source, name string) int {
	re := regexp.MustCompile(`(?m)^\s*(?:async\s+)?fn\s+` + regexp.QuoteMeta(name) + `\b`)
	if loc := re.FindStringIndex(source); loc != nil {
		return lineAt(source, loc[0])
	}
	return 0
}
