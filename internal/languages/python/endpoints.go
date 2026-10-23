package python

import (
	"regexp"
	"strings"
)

// EndpointsInFile estrae gli endpoint HTTP dichiarati in un sorgente Python, senza eseguirlo e
// senza importare nulla: serve a Developer Context e alla CodeLens "Open in API Client", che in
// adOmnia funzionano allo stesso modo per Go, Java e ora Python.
//
// Riconosce le forme statiche dei tre framework più usati:
//   - FastAPI / Starlette: `@app.get("/items/{id}")`, `@router.post(...)`, `@app.api_route(path, methods=[...])`;
//   - Flask: `@app.route("/x", methods=["GET", "POST"])`, `@app.get(...)` (Flask 2+), `@blueprint.route(...)`;
//   - Django: `path("items/<int:pk>/", view)` e `re_path(r"^items/$", view)` negli `urls.py`.
//
// Il percorso resta quello dichiarato (con `{param}`, `<int:pk>` o regex): l'API client lo mostra
// com'è invece di indovinare un valore. Un decoratore dentro una docstring o in un commento non è
// un endpoint, quindi lo scanner segue lo stato delle stringhe.
func EndpointsInFile(relativePath string, data []byte) []HTTPEndpoint {
	lines := scanPythonLines(string(data))
	prefixes := routerPrefixes(lines)
	var endpoints []HTTPEndpoint
	for i, line := range lines {
		if !line.code {
			continue
		}
		trimmed := strings.TrimSpace(line.text)
		var found []HTTPEndpoint
		switch {
		case strings.HasPrefix(trimmed, "@"):
			found = decoratorEndpoints(trimmed, i+1)
		case isDjangoURLs(relativePath):
			found = djangoEndpoints(trimmed, i+1)
		}
		if len(found) == 0 {
			continue
		}
		handler := decoratedFunctionName(lines, i)
		for j := range found {
			if found[j].Handler == "" {
				found[j].Handler = handler
			}
			if found[j].owner != "" {
				found[j].Path = joinPrefix(prefixes[found[j].owner], found[j].Path)
				found[j].owner = ""
			}
		}
		endpoints = append(endpoints, found...)
	}
	return endpoints
}

// HTTPEndpoint è un endpoint HTTP dichiarato in un sorgente Python. Method "ANY" significa che il
// verbo lo decide la vista (Django); Path è il percorso dichiarato, Handler il simbolo che lo serve.
type HTTPEndpoint struct {
	Method  string
	Path    string
	Handler string
	Line    int
	// WebSocket è true per `@app.websocket("/ws")`: non è una richiesta HTTP ma una connessione WS.
	WebSocket bool
	// owner è l'oggetto del decoratore (`router`, `bp`): serve a comporre il prefisso dichiarato altrove.
	owner string
}

// pythonLine è una riga con l'indicazione se il suo inizio è codice (fuori da stringhe e commenti).
type pythonLine struct {
	text string
	code bool
}

var (
	// decoratorPattern riconosce `@oggetto.verbo(`: oggetto semplice o puntato (app, router, bp.v1).
	decoratorPattern = regexp.MustCompile(`^@\s*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\.([A-Za-z_]\w*)\s*\(`)
	// defPattern riconosce la funzione decorata, sincrona o asincrona.
	defPattern = regexp.MustCompile(`^(?:async\s+)?def\s+([A-Za-z_]\w*)`)
	// routeVerbs sono i verbi HTTP accettati come nome del decoratore (FastAPI, Flask 2+, Starlette).
	routeVerbs = map[string]bool{"get": true, "post": true, "put": true, "patch": true, "delete": true, "head": true, "options": true, "trace": true}
	// methodsLiteral è la lista `methods=[...]` o `methods=(...)`.
	methodsLiteral = regexp.MustCompile(`\bmethods\s*=\s*[\[\(]([^\]\)]*)[\]\)]`)
	// methodLiteral è una stringa dentro la lista dei metodi.
	methodLiteral = regexp.MustCompile(`['"]\s*([A-Za-z]+)\s*['"]`)
	// djangoPattern riconosce `path(...)`, `re_path(...)` e `url(...)`.
	djangoPattern = regexp.MustCompile(`^(?:re_)?path\s*\(|^url\s*\(`)
	// djangoParam converte `<int:pk>` / `<pk>` nella forma `{pk}` usata da Go, Spring e FastAPI, così
	// l'API client vede un parametro di percorso invece di una sintassi Python.
	djangoParam = regexp.MustCompile(`<(?:\w+:)?(\w+)>`)
	pathKeyword = regexp.MustCompile(`^path\s*=\s*`)
	// routerDecl è `router = APIRouter(` / `bp = Blueprint(` (anche con annotazione di tipo).
	routerDecl = regexp.MustCompile(`^([A-Za-z_]\w*)\s*(?::[^=]+)?=\s*(?:[\w.]+\.)?(?:APIRouter|Blueprint)\s*\(`)
	// includeCall è `app.include_router(router, ...)` (FastAPI) o `app.register_blueprint(bp, ...)` (Flask).
	includeCall = regexp.MustCompile(`\.(include_router|register_blueprint)\s*\(\s*([A-Za-z_][\w.]*)`)
	// prefixKeyword è l'argomento `prefix=` / `url_prefix=`.
	prefixKeyword = regexp.MustCompile(`\b(?:url_)?prefix\s*=\s*`)
	// djangoNamedGroup è `(?P<anno>[0-9]{4})` di una regex Django.
	djangoNamedGroup = regexp.MustCompile(`\(\?P<(\w+)>[^)]*\)`)
	// handlerLiteral è il secondo argomento identificabile di una url di Django.
	handlerLiteral = regexp.MustCompile(`^\s*([A-Za-z_][\w.]*)`)
)

// decoratorEndpoints interpreta un decoratore di rotta; ritorna vuoto per i decoratori che non lo sono.
func decoratorEndpoints(line string, number int) []HTTPEndpoint {
	match := decoratorPattern.FindStringSubmatch(line)
	if match == nil {
		return nil
	}
	verb := strings.ToLower(match[2])
	if !routeVerbs[verb] && verb != "route" && verb != "api_route" && verb != "websocket" {
		return nil
	}
	// La ricerca parte da dopo la parentesi aperta: `@app.get(...)`.
	rest := line[strings.Index(line, "(")+1:]
	path, ok := readPathArgument(rest)
	if !ok {
		return nil
	}
	owner := match[1]
	if verb == "websocket" {
		return []HTTPEndpoint{{Method: "WS", Path: path, Line: number, WebSocket: true, owner: owner}}
	}
	if verb != "route" && verb != "api_route" {
		return []HTTPEndpoint{{Method: strings.ToUpper(verb), Path: path, Line: number, owner: owner}}
	}
	// `.route(...)` (Flask) e `.api_route(...)` (FastAPI) dichiarano i metodi in `methods=[...]`;
	// senza lista il metodo è GET, come nei due framework.
	methods := declaredMethods(rest)
	if len(methods) == 0 {
		methods = []string{"GET"}
	}
	endpoints := make([]HTTPEndpoint, 0, len(methods))
	for _, method := range methods {
		endpoints = append(endpoints, HTTPEndpoint{Method: method, Path: path, Line: number, owner: owner})
	}
	return endpoints
}

// djangoEndpoints interpreta una voce di `urls.py`: `path("x/", view)` o `re_path(r"^x$", view)`.
// Un `include(...)` non è un endpoint: il percorso lo dichiara il modulo incluso.
func djangoEndpoints(line string, number int) []HTTPEndpoint {
	if !djangoPattern.MatchString(line) || strings.Contains(line, "include(") {
		return nil
	}
	open := strings.Index(line, "(")
	if open < 0 {
		return nil
	}
	rest := line[open+1:]
	path, ok := readPathArgument(rest)
	if !ok {
		// `path("", views.index)`: la radice del sito è un endpoint, non un errore.
		if literal, found := readPathLiteral(strings.TrimLeft(rest, " 	")); !found || literal != "" {
			return nil
		}
		path = "/"
	}
	if !strings.HasPrefix(line, "path") {
		path = djangoRegexPath(path) // re_path / url: il percorso è una regex
	}
	endpoint := HTTPEndpoint{Method: "ANY", Path: djangoPath(path), Line: number}
	if comma := indexOutsideString(rest); comma >= 0 {
		if match := handlerLiteral.FindStringSubmatch(rest[comma+1:]); match != nil {
			endpoint.Handler = match[1]
		}
	}
	return []HTTPEndpoint{endpoint}
}

// djangoPath porta una rotta Django nella forma comune: barra iniziale (Django la omette) e
// parametri `{nome}` invece dei converter `<int:nome>`. Il resto del percorso non viene toccato.
func djangoPath(path string) string {
	path = djangoParam.ReplaceAllString(path, "{$1}")
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return path
}

// readPathArgument legge il primo argomento come stringa di percorso (anche `path="/x"`). La stringa
// vuota è valida: è la radice di un router con prefisso o `path("", view)` di Django.
func readPathArgument(text string) (string, bool) {
	text = strings.TrimLeft(text, " \t")
	if keyword := pathKeyword.FindString(text); keyword != "" {
		text = text[len(keyword):]
	}
	return readPathLiteral(text)
}

// readPathLiteral legge una stringa Python all'inizio di text, con prefisso opzionale r/b/u (Django
// usa r"..."): restituisce il contenuto già interpretato. In una stringa raw il backslash resta.
func readPathLiteral(text string) (string, bool) {
	i, raw := 0, false
	for i < len(text) && i < 2 && strings.ContainsRune("rRbBuU", rune(text[i])) {
		raw = raw || text[i] == 'r' || text[i] == 'R'
		i++
	}
	if i >= len(text) || (text[i] != '\'' && text[i] != '"') {
		return "", false
	}
	quote := text[i]
	i++
	var out strings.Builder
	for ; i < len(text); i++ {
		c := text[i]
		if c == quote {
			return out.String(), true
		}
		if c == '\\' && !raw && i+1 < len(text) {
			i++
			out.WriteByte(text[i])
			continue
		}
		out.WriteByte(c)
	}
	return "", false
}

// declaredMethods legge i metodi HTTP dichiarati in `methods=[...]`, normalizzati e deduplicati.
func declaredMethods(text string) []string {
	match := methodsLiteral.FindStringSubmatch(text)
	if match == nil {
		return nil
	}
	seen := map[string]bool{}
	var methods []string
	for _, item := range methodLiteral.FindAllStringSubmatch(match[1], -1) {
		method := strings.ToUpper(item[1])
		if !seen[method] {
			seen[method] = true
			methods = append(methods, method)
		}
	}
	return methods
}

// decoratedFunctionName è il nome della funzione decorata: la prima `def`/`async def` dopo il
// decoratore (saltando gli altri decoratori). Vuoto se la forma non è riconoscibile.
func decoratedFunctionName(lines []pythonLine, decorator int) string {
	for i := decorator + 1; i < len(lines) && i <= decorator+8; i++ {
		if !lines[i].code {
			return ""
		}
		text := strings.TrimSpace(lines[i].text)
		if strings.HasPrefix(text, "@") {
			continue
		}
		if match := defPattern.FindStringSubmatch(text); match != nil {
			return match[1]
		}
		return ""
	}
	return ""
}

// indexOutsideString è la posizione della prima virgola fuori da una stringa, -1 se non c'è.
func indexOutsideString(text string) int {
	var quote byte
	escaped := false
	for i := 0; i < len(text); i++ {
		c := text[i]
		if quote != 0 {
			switch {
			case escaped:
				escaped = false
			case c == '\\':
				escaped = true
			case c == quote:
				quote = 0
			}
			continue
		}
		switch c {
		case '\'', '"':
			quote = c
		case ',':
			return i
		case ')':
			return -1
		}
	}
	return -1
}

// scanPythonLines marca le righe il cui inizio è codice: fuori da stringhe (anche triple) e da
// commenti. Un decoratore dentro una docstring non deve diventare un endpoint.
func scanPythonLines(source string) []pythonLine {
	var lines []pythonLine
	triple := ""
	for _, raw := range strings.Split(source, "\n") {
		line := pythonLine{text: strings.TrimRight(raw, "\r")}
		line.code = triple == ""
		if triple == "" {
			triple = tripleQuoteOpened(line.text)
		} else if strings.Contains(line.text, triple) {
			triple = ""
		}
		lines = append(lines, line)
	}
	return lines
}

// tripleQuoteOpened restituisce il delimitatore di una stringa triple aperta su questa riga e non
// chiusa (”' o """), "" se la riga non ne apre una. Commenti e stringhe semplici sono ignorati:
// servono solo a non generare endpoint da una docstring.
func tripleQuoteOpened(line string) string {
	var quote byte
	for i := 0; i < len(line); i++ {
		c := line[i]
		if quote != 0 {
			switch c {
			case '\\':
				i++
			case quote:
				quote = 0
			}
			continue
		}
		if c == '#' {
			return ""
		}
		if c != '\'' && c != '"' {
			continue
		}
		delimiter := strings.Repeat(string(c), 3)
		if !strings.HasPrefix(line[i:], delimiter) {
			quote = c
			continue
		}
		rest := line[i+3:]
		if end := strings.Index(rest, delimiter); end >= 0 {
			i += 3 + end + 2 // stringa triple chiusa sulla stessa riga
			continue
		}
		return delimiter
	}
	return ""
}

// isDjangoURLs dice se il file è un `urls.py` (o un modulo che ne segue la convenzione).
func isDjangoURLs(relativePath string) bool {
	normalized := strings.ToLower(strings.ReplaceAll(relativePath, "\\", "/"))
	base := normalized[strings.LastIndex(normalized, "/")+1:]
	return base == "urls.py"
}

// djangoRegexPath porta la regex di `re_path` nella forma comune: toglie le ancore e trasforma i
// gruppi con nome in `{nome}`. Il resto della regex non viene interpretato.
func djangoRegexPath(path string) string {
	path = strings.TrimSuffix(strings.TrimPrefix(path, "^"), "$")
	return djangoNamedGroup.ReplaceAllString(path, "{$1}")
}

// routerPrefixes risolve, dentro lo stesso file, il prefisso finale di ogni `APIRouter`/`Blueprint`:
// quello dichiarato nel costruttore più quello dell'`include_router`/`register_blueprint`.
// Ceiling: un router incluso in un altro router, o in un altro file, non compone la catena intera.
func routerPrefixes(lines []pythonLine) map[string]string {
	own := map[string]string{}
	for i, line := range lines {
		if !line.code {
			continue
		}
		if match := routerDecl.FindStringSubmatch(strings.TrimSpace(line.text)); match != nil {
			own[match[1]] = prefixArgument(statementAt(lines, i))
		}
	}
	if len(own) == 0 {
		return nil
	}
	final := map[string]string{}
	for i, line := range lines {
		if !line.code {
			continue
		}
		match := includeCall.FindStringSubmatch(line.text)
		if match == nil {
			continue
		}
		name := match[2]
		if _, declared := own[name]; !declared {
			continue
		}
		if _, done := final[name]; done {
			continue
		}
		included := prefixArgument(statementAt(lines, i)[strings.Index(statementAt(lines, i), match[0])+len(match[0]):])
		if match[1] == "register_blueprint" && included != "" {
			final[name] = included // Flask: url_prefix della registrazione sostituisce quello del blueprint
		} else {
			final[name] = joinPrefix(included, own[name])
		}
	}
	for name, prefix := range own {
		if _, done := final[name]; !done {
			final[name] = prefix
		}
	}
	return final
}

// prefixArgument legge `prefix="/x"` o `url_prefix="/x"` in un'istruzione; vuoto se manca.
func prefixArgument(statement string) string {
	location := prefixKeyword.FindStringIndex(statement)
	if location == nil {
		return ""
	}
	value, _ := readPathLiteral(statement[location[1]:])
	return value
}

// statementAt è il testo dell'istruzione che inizia alla riga i, fino a pareggiare le parentesi
// (al massimo 12 righe): i costruttori dei router vanno spesso su più righe.
func statementAt(lines []pythonLine, i int) string {
	var out strings.Builder
	depth := 0
	for j := i; j < len(lines) && j < i+12; j++ {
		text := strings.TrimSpace(lines[j].text)
		out.WriteString(text)
		out.WriteByte(' ')
		depth += strings.Count(text, "(") - strings.Count(text, ")")
		if depth <= 0 {
			break
		}
	}
	return out.String()
}

// joinPrefix compone prefisso e percorso con una sola barra tra i due.
func joinPrefix(prefix, path string) string {
	if prefix == "" {
		return path
	}
	if !strings.HasPrefix(prefix, "/") {
		prefix = "/" + prefix
	}
	prefix = strings.TrimSuffix(prefix, "/")
	if path == "" || path == "/" {
		if prefix == "" {
			return "/"
		}
		return prefix
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return prefix + path
}
