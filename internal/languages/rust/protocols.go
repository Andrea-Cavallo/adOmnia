package rust

import (
	"regexp"
	"sort"
	"strings"
)

// GrpcRef è un servizio gRPC dichiarato in un sorgente Rust (tonic): il nome del servizio (trait)
// o del package proto, e l'eventuale riferimento al `.proto`.
type GrpcRef struct {
	Service string // nome del servizio (trait implementato) o del package proto
	Proto   string // riferimento al .proto (include_proto! o compile_protos), se noto
	Line    int
	// Methods sono i metodi dell'impl tonic: uno per rpc (say_hello per SayHello), dove si salta dal client.
	Methods []GrpcMethod
}

// GrpcMethod è un metodo di un impl tonic: il nome Rust (snake_case) e la riga della sua `fn`.
type GrpcMethod struct {
	Name string
	Line int
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
	// tonicImpl è `#[tonic::async_trait] impl Greeter for MyGreeter` (anche `#[async_trait]` importato e
	// `impl greeter_server::Greeter for MyGreeter`): il gruppo 1 è il trait, cioè il servizio.
	tonicImpl = regexp.MustCompile(`#\[(?:tonic::)?async_trait\]\s*impl(?:\s*<[^>]*>)?\s+(?:[A-Za-z_][\w:]*::)?([A-Za-z_]\w*)\s+for\b`)
	// implMethod è una `async fn` dentro l'impl: i metodi del trait generato da tonic.
	implMethod = regexp.MustCompile(`(?:pub(?:\([^)]*\))?\s+)?async\s+fn\s+([A-Za-z_]\w*)\s*[(<]`)
	// compileProtos è `tonic_build::compile_protos("proto/x.proto")` (in build.rs).
	compileProtos = regexp.MustCompile(`tonic_build::compile_protos\s*\(\s*"([^"]*)"`)
	// wsHandler è `fn name(... WebSocketUpgrade ...)` (axum), actix-ws `ws::WebSocket` oppure
	// `web::Payload` (la firma dell'upgrade actix-ws/`ws`).
	wsHandler = regexp.MustCompile(`(?s)(?:async\s+)?fn\s+([A-Za-z_]\w*)\s*\([^)]*?(?:WebSocketUpgrade|ws::WebSocket|web::Payload)\b[^)]*\)`)
	// sseHandler è `fn name(...) -> Sse<...>` (axum SSE).
	sseHandler = regexp.MustCompile(`(?s)(?:async\s+)?fn\s+([A-Za-z_]\w*)\s*\([^)]*\)\s*->\s*Sse\s*<`)
	// builderRoute associa `.route("path", verb(handler))` al nome del handler.
	builderRoute = regexp.MustCompile(`\.route\s*\(\s*"([^"]*)"\s*,\s*[^)]*\b(?:get|post|put|patch|delete|head|options|trace|any)\s*\(\s*([A-Za-z_]\w*)`)
)

// GrpcServicesInFile estrae i servizi gRPC tonic dichiarati staticamente. Tollerante.
func GrpcServicesInFile(relativePath string, data []byte) []GrpcRef {
	source := string(data)
	var refs []GrpcRef
	seen := map[string]int{}
	// emit returns the ref of the service, the one already seen when the file declares it twice.
	emit := func(service, proto string, offset int) *GrpcRef {
		key := "grpc:" + service + "\x00" + proto
		if index, ok := seen[key]; ok {
			return &refs[index]
		}
		seen[key] = len(refs)
		refs = append(refs, GrpcRef{Service: service, Proto: proto, Line: lineAt(source, offset)})
		return &refs[len(refs)-1]
	}

	// include_proto!("greeter") dichiara il modulo generato, non il `.proto`: non è un riferimento
	// a file e non deve finire nell'attributo proto dell'entità.
	for _, loc := range includeProto.FindAllStringSubmatchIndex(source, -1) {
		emit(source[loc[2]:loc[3]], "", loc[0])
	}
	for _, loc := range tonicImpl.FindAllStringSubmatchIndex(source, -1) {
		ref := emit(source[loc[2]:loc[3]], "", loc[0])
		ref.Methods = append(ref.Methods, implMethods(source, loc[1])...)
	}
	for _, loc := range compileProtos.FindAllStringSubmatchIndex(source, -1) {
		emit("", source[loc[2]:loc[3]], loc[0])
	}
	return refs
}

// implMethods sono le `async fn` scritte direttamente nel corpo dell'impl che inizia dopo offset: le funzioni
// annidate dentro un metodo restano fuori. Il corpo si delimita contando le graffe fuori da stringhe e commenti.
func implMethods(source string, offset int) []GrpcMethod {
	open := strings.IndexByte(source[offset:], '{')
	if open < 0 {
		return nil
	}
	start := offset + open + 1
	end := matchingBrace(source, start)
	body := source[start:end]
	var methods []GrpcMethod
	for _, loc := range implMethod.FindAllStringSubmatchIndex(body, -1) {
		if braceDepth(body[:loc[0]]) != 0 {
			continue
		}
		methods = append(methods, GrpcMethod{Name: body[loc[2]:loc[3]], Line: lineAt(source, start+loc[2])})
	}
	return methods
}

// matchingBrace è l'indice della `}` che chiude il blocco aperto subito prima di start (fine sorgente se manca).
func matchingBrace(source string, start int) int {
	depth := 1
	for index := start; index < len(source); index++ {
		switch skip := skipLiteral(source, index); {
		case skip > index:
			index = skip - 1
		case source[index] == '{':
			depth++
		case source[index] == '}':
			depth--
			if depth == 0 {
				return index
			}
		}
	}
	return len(source)
}

// braceDepth è quante graffe restano aperte nel testo (fuori da stringhe e commenti).
func braceDepth(text string) int {
	depth := 0
	for index := 0; index < len(text); index++ {
		switch skip := skipLiteral(text, index); {
		case skip > index:
			index = skip - 1
		case text[index] == '{':
			depth++
		case text[index] == '}':
			depth--
		}
	}
	return depth
}

// skipLiteral è dove finisce la stringa o il commento che inizia a index, o index se non ne inizia uno:
// una `{` dentro `"{name}"` o `// {` non apre un blocco.
func skipLiteral(text string, index int) int {
	rest := text[index:]
	switch {
	case strings.HasPrefix(rest, "//"):
		if newline := strings.IndexByte(rest, '\n'); newline >= 0 {
			return index + newline
		}
		return len(text)
	case strings.HasPrefix(rest, "/*"):
		if end := strings.Index(rest[2:], "*/"); end >= 0 {
			return index + 2 + end + 2
		}
		return len(text)
	case rest[0] == '"':
		for cursor := 1; cursor < len(rest); cursor++ {
			if rest[cursor] == '\\' {
				cursor++
				continue
			}
			if rest[cursor] == '"' {
				return index + cursor + 1
			}
		}
		return len(text)
	}
	return index
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
	// Le mappe non hanno ordine: si stabilizza per riga così le entità del file non ballano
	// tra un'analisi e l'altra.
	sort.SliceStable(refs, func(i, j int) bool {
		if refs[i].Line != refs[j].Line {
			return refs[i].Line < refs[j].Line
		}
		return refs[i].Handler < refs[j].Handler
	})
	return refs
}

// fnLine restituisce la riga 1-based della dichiarazione `fn name` (anche `pub`/`pub(crate)`).
func fnLine(source, name string) int {
	re := regexp.MustCompile(`(?m)^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+` + regexp.QuoteMeta(name) + `\b`)
	if loc := re.FindStringIndex(source); loc != nil {
		return lineAt(source, loc[0])
	}
	return 0
}
