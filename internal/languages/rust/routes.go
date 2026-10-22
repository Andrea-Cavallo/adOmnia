package rust

import (
	"regexp"
	"strings"
)

// HTTPEndpoint è un endpoint HTTP dichiarato in un sorgente Rust (axum, actix-web, rocket).
// Method "ANY" significa che il verbo non è un singolo metodo (route senza metodo); Path è il
// percorso normalizzato nella forma comune (`{param}`); Handler il simbolo che lo serve.
type HTTPEndpoint struct {
	Method    string
	Path      string
	Handler   string
	Line      int
	WebSocket bool // riservato a RS-7.5 (WebSocketUpgrade / actix-ws)
}

// EndpointsInFile estrae le route HTTP dichiarate staticamente in un sorgente Rust, senza compilare
// né eseguire build.rs: serve a Developer Context e all'API client, come per Go/Java/Python.
// Tollerante: una riga non riconosciuta non blocca le altre.
//
// Riconosce:
//   - axum: `.route("/users/:id", get(h).post(h2))` (path con `:param` o `{param}`), `.nest(prefix, …)`;
//   - actix-web: `#[get("/x")]`/`#[post]`/`#[route("/x", method = "POST")]`,
//     `web::scope("/api").route(...)`, `web::resource("/x")`;
//   - rocket: `#[get("/x/<id>")]` (parametro `<id>` → `{id}`), `.mount("/base", routes![a, b])`.
func EndpointsInFile(relativePath string, data []byte) []HTTPEndpoint {
	lines := rustCodeLines(string(data))
	attributes := attributeEndpoints(lines)

	var endpoints []HTTPEndpoint
	// Le route attributo montate via `.mount(prefix, routes![…])` escono solo col percorso composto
	// (come Python compone i prefissi dei router); una route non montata nello stesso file esce col
	// percorso dichiarato, assumendo il mount alla radice.
	mounts := mountPrefixes(lines)
	for _, endpoint := range attributes {
		prefixes, mounted := mounts[endpoint.Handler]
		if !mounted || endpoint.Handler == "" {
			endpoints = append(endpoints, endpoint)
			continue
		}
		for _, prefix := range prefixes {
			endpoints = append(endpoints, HTTPEndpoint{Method: endpoint.Method, Path: joinRustPath(prefix, endpoint.Path), Handler: endpoint.Handler, Line: endpoint.Line})
		}
	}
	endpoints = append(endpoints, builderEndpoints(lines)...)
	return endpoints
}

// rustLine è una riga di codice con i commenti rimossi; n è il numero di riga 1-based.
type rustLine struct {
	text string
	n    int
}

var (
	// attrRoute riconosce `#[verb("path")]` (actix e rocket usano la stessa forma).
	attrRoute = regexp.MustCompile(`^#\[\s*(get|post|put|patch|delete|head|options|trace|route)\s*\(\s*"([^"]*)"`)
	// routeMethod è `method = "POST"` (actix #[route]).
	routeMethod = regexp.MustCompile(`method\s*=\s*"([A-Za-z]+)"`)
	// fnName è il nome della funzione decorata: `pub async fn name` / `fn name`.
	fnName = regexp.MustCompile(`^(?:pub(?:\s*\(\s*[^)]*\s*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_]\w*)`)
	// routeCall riconosce `.route("path", <catena>)` (axum e actix) e `.route("path")`.
	routeCall = regexp.MustCompile(`\.route\s*\(\s*"([^"]*)"\s*(?:,\s*(.*))?`)
	// nestCall è `.nest("prefix", …)` (axum) e `web::scope("prefix")` (actix): prefisso di un router.
	nestCall = regexp.MustCompile(`\.nest\s*\(\s*"([^"]*)"|web::scope\s*\(\s*"([^"]*)"`)
	// resourceCall è `web::resource("path")` (actix).
	resourceCall = regexp.MustCompile(`web::resource\s*\(\s*"([^"]*)"`)
	// rocketMount è `.mount("prefix", routes![a, b, c])`.
	rocketMount = regexp.MustCompile(`\.mount\s*\(\s*"([^"]*)"\s*,\s*routes!\s*\[([^\]]*)\]`)
	// verbCall riconosce un verbo nella catena: `get(...)`, `post(...)` e `web::get().to(...)`.
	verbCall = regexp.MustCompile(`(?:web::)?(get|post|put|patch|delete|head|options|trace|any)\s*\(`)
	// rocketParam è `<id>` o `<id:regex>` di rocket.
	rocketParam = regexp.MustCompile(`<([^>]+)>`)
)

// rustCodeLines divide il sorgente in righe di codice, togliendo i commenti `//` e i blocchi `/* */`
// (rispettando le stringhe): una rotta dentro un commento non deve diventare un endpoint.
func rustCodeLines(source string) []rustLine {
	raw := strings.Split(strings.ReplaceAll(source, "\r\n", "\n"), "\n")
	lines := make([]rustLine, 0, len(raw))
	inBlock := false
	for i, text := range raw {
		if inBlock {
			if end := strings.Index(text, "*/"); end >= 0 {
				text = text[end+2:]
				inBlock = false
			} else {
				lines = append(lines, rustLine{text: "", n: i + 1})
				continue
			}
		}
		text = stripRustComments(text, &inBlock)
		lines = append(lines, rustLine{text: text, n: i + 1})
	}
	return lines
}

// stripRustComments toglie `//…` e `/*…*/` fuori dalle stringhe; aggiorna inBlock se un blocco resta
// aperto su questa riga.
func stripRustComments(line string, inBlock *bool) string {
	var out strings.Builder
	inString, escaped := false, false
	for i := 0; i < len(line); i++ {
		c := line[i]
		if inString {
			out.WriteByte(c)
			if escaped {
				escaped = false
			} else if c == '\\' {
				escaped = true
			} else if c == '"' {
				inString = false
			}
			continue
		}
		switch {
		case c == '"':
			inString = true
			out.WriteByte(c)
		case c == '/' && i+1 < len(line) && line[i+1] == '/':
			return out.String()
		case c == '/' && i+1 < len(line) && line[i+1] == '*':
			rest := line[i+2:]
			if end := strings.Index(rest, "*/"); end >= 0 {
				i += 2 + end + 1
			} else {
				*inBlock = true
				return out.String()
			}
		default:
			out.WriteByte(c)
		}
	}
	return out.String()
}

// attributeEndpoints riconosce `#[get("/x")]`, `#[post]`, `#[route("/x", method = "POST")]` e il
// nome della funzione decorata sulla riga successiva.
func attributeEndpoints(lines []rustLine) []HTTPEndpoint {
	var out []HTTPEndpoint
	for i, line := range lines {
		match := attrRoute.FindStringSubmatch(strings.TrimSpace(line.text))
		if match == nil {
			continue
		}
		verb, path := match[1], match[2]
		method := strings.ToUpper(verb)
		handler := ""
		if verb == "route" {
			method = "ANY"
			if m := routeMethod.FindStringSubmatch(line.text); m != nil {
				method = strings.ToUpper(m[1])
			}
		}
		for j := i + 1; j < len(lines) && j <= i+4; j++ {
			if strings.TrimSpace(lines[j].text) == "" {
				continue
			}
			if m := fnName.FindStringSubmatch(strings.TrimSpace(lines[j].text)); m != nil {
				handler = m[1]
			}
			break
		}
		out = append(out, HTTPEndpoint{Method: method, Path: normalizeRustPath(path), Handler: handler, Line: line.n})
	}
	return out
}

// mountPrefixes associa a ogni handler il prefisso (o i prefissi) dei `.mount(prefix, routes![…])`
// che lo montano nello stesso file. Un handler montato in più punti produce più prefissi.
func mountPrefixes(lines []rustLine) map[string][]string {
	mounts := map[string][]string{}
	for _, line := range lines {
		match := rocketMount.FindStringSubmatch(line.text)
		if match == nil {
			continue
		}
		prefix := normalizeRustPath(match[1])
		for _, name := range strings.Split(match[2], ",") {
			if name = strings.TrimSpace(name); name != "" {
				mounts[name] = append(mounts[name], prefix)
			}
		}
	}
	return mounts
}

// builderEndpoints riconosce `.route("path", get(h).post(h2))`, `web::resource("path")` e
// `web::scope("prefix").route(...)`. Lavora su istruzioni complete (le catene possono andare a capo).
func builderEndpoints(lines []rustLine) []HTTPEndpoint {
	var out []HTTPEndpoint
	for _, statement := range rustStatements(lines) {
		out = append(out, statementEndpoints(statement.text, statement.n)...)
	}
	return out
}

// statementEndpoints interpreta una singola istruzione builder: applica il prefisso di scope/nest
// alle route della stessa istruzione e riconosce `.route`/`web::resource`.
func statementEndpoints(statement string, line int) []HTTPEndpoint {
	var out []HTTPEndpoint
	// Prefisso da scope/nest all'inizio dell'istruzione (actix `web::scope("/api").route(...)`).
	prefix := ""
	if m := nestCall.FindStringSubmatch(statement); m != nil {
		if m[1] != "" {
			prefix = normalizeRustPath(m[1])
		} else {
			prefix = normalizeRustPath(m[2])
		}
	}
	for _, call := range routeCalls(statement) {
		for _, method := range callVerbs(call.second) {
			path := normalizeRustPath(call.path)
			if prefix != "" {
				path = joinRustPath(prefix, path)
			}
			out = append(out, HTTPEndpoint{Method: method, Path: path, Line: line})
		}
	}
	out = append(out, resourceEndpoints(statement, line, prefix)...)
	return out
}

// resourceEndpoints riconosce `web::resource("path")` (actix): con `.route(web::verb().to(h))`
// produce una rotta per verbo, senza produce ANY.
func resourceEndpoints(statement string, line int, prefix string) []HTTPEndpoint {
	var out []HTTPEndpoint
	for _, loc := range resourceCall.FindAllStringSubmatchIndex(statement, -1) {
		path := normalizeRustPath(statement[loc[2]:loc[3]])
		// Testo dopo la parentesi che chiude web::resource("path"): le `.route(web::verb()…)` annidate.
		rest := statement[loc[1]:]
		close := strings.Index(rest, ")")
		verbs := resourceVerbs(rest[close+1:])
		if len(verbs) == 0 {
			if prefix != "" {
				path = joinRustPath(prefix, path)
			}
			out = append(out, HTTPEndpoint{Method: "ANY", Path: path, Line: line})
			continue
		}
		for _, method := range verbs {
			full := path
			if prefix != "" {
				full = joinRustPath(prefix, path)
			}
			out = append(out, HTTPEndpoint{Method: method, Path: full, Line: line})
		}
	}
	return out
}

// resourceVerbs legge i verbi `.route(web::verb().to(h))` annidati su una resource, fino al confine
// della resource (la prima `)` a profondità zero o un'altra `.service`).
func resourceVerbs(rest string) []string {
	seen := map[string]bool{}
	var verbs []string
	for _, m := range verbCall.FindAllStringSubmatch(rest, -1) {
		method := strings.ToUpper(m[1])
		if method != "ANY" && httpVerbs[method] && !seen[method] {
			seen[method] = true
			verbs = append(verbs, method)
		}
	}
	return verbs
}

// routeArg è il percorso e la catena di verbi di un `.route(...)`.
type routeArg struct {
	path   string
	second string
}

// routeCalls estrae le chiamate `.route("path", …)` da un'istruzione, pareggiando le parentesi.
func routeCalls(statement string) []routeArg {
	var out []routeArg
	for _, loc := range routeCall.FindAllStringSubmatchIndex(statement, -1) {
		path := routeCall.FindStringSubmatch(statement[loc[0]:loc[1]])[1]
		second := ""
		// Se c'è una virgola dopo la stringa, la catena di verbi parte da lì e arriva alla
		// parentesi che chiude la chiamata (pareggiando le parentesi annidate).
		open := loc[0] + strings.Index(statement[loc[0]:], "(") + 1
		afterPath := statement[open:]
		if comma := strings.Index(afterPath, ","); comma >= 0 {
			start := open + comma + 1
			second = balanced(statement, start)
		}
		out = append(out, routeArg{path: path, second: second})
	}
	return out
}

// callVerbs legge i verbi HTTP dalla catena (`get(...)`, `web::post().to(...)`, `any(...)`).
func callVerbs(second string) []string {
	seen := map[string]bool{}
	var verbs []string
	for _, m := range verbCall.FindAllStringSubmatch(second, -1) {
		method := strings.ToUpper(m[1])
		if method == "ANY" || httpVerbs[method] {
			if !seen[method] {
				seen[method] = true
				verbs = append(verbs, method)
			}
		}
	}
	if len(verbs) == 0 {
		return []string{"ANY"}
	}
	return verbs
}

var httpVerbs = map[string]bool{
	"GET": true, "POST": true, "PUT": true, "PATCH": true, "DELETE": true,
	"HEAD": true, "OPTIONS": true, "TRACE": true,
}

// balanced restituisce il testo da start fino alla parentesi che chiude, pareggiando le annidate.
func balanced(statement string, start int) string {
	depth := 0
	for i := start; i < len(statement); i++ {
		switch statement[i] {
		case '(':
			depth++
		case ')':
			if depth == 0 {
				return strings.TrimSpace(statement[start:i])
			}
			depth--
		}
	}
	return strings.TrimSpace(statement[start:])
}

// rustStatements raggruppa le righe in istruzioni complete, pareggiando le parentesi (una catena
// builder va spesso su più righe). Una riga che non apre parentesi è un'istruzione a sé.
func rustStatements(lines []rustLine) []rustLine {
	var out []rustLine
	var buf strings.Builder
	start := 0
	depth := 0
	flush := func() {
		if buf.Len() > 0 {
			out = append(out, rustLine{text: buf.String(), n: start})
			buf.Reset()
		}
	}
	for _, line := range lines {
		trimmed := strings.TrimSpace(line.text)
		if trimmed == "" {
			continue
		}
		if buf.Len() == 0 {
			start = line.n
		}
		buf.WriteString(trimmed)
		buf.WriteByte(' ')
		depth += strings.Count(trimmed, "(") - strings.Count(trimmed, ")")
		depth += strings.Count(trimmed, "[") - strings.Count(trimmed, "]")
		if depth <= 0 {
			flush()
		}
	}
	flush()
	return out
}

// normalizeRustPath porta i parametri di percorso nella forma comune `{param}`: `<id>`, `<id:regex>`
// e `<path..>` di rocket. I `:id` (axum) e `{id}` (axum 0.8/actix) li normalizza il detector devcontext.
func normalizeRustPath(path string) string {
	return rocketParam.ReplaceAllStringFunc(path, func(m string) string {
		name := strings.TrimSuffix(strings.TrimPrefix(m, "<"), ">")
		if i := strings.IndexAny(name, ":"); i >= 0 {
			name = name[:i]
		}
		name = strings.TrimSuffix(name, "..")
		return "{" + name + "}"
	})
}

// joinRustPath compone prefisso e percorso con una sola barra tra i due.
func joinRustPath(prefix, path string) string {
	prefix = strings.TrimSuffix(prefix, "/")
	if prefix == "" {
		if path == "" {
			return "/"
		}
		return path
	}
	if !strings.HasPrefix(prefix, "/") {
		prefix = "/" + prefix
	}
	if path == "" || path == "/" {
		return prefix
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return prefix + path
}
