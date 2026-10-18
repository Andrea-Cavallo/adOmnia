package java

import (
	"os"
	"regexp"
	"strings"
)

// javaAnnotation è un'annotation trovata nei sorgenti, con la posizione del suo nome.
type javaAnnotation struct {
	Name        string `json:"name"`     // senza `@` e senza package (`Autowired`)
	FullName    string `json:"fullName"` // come scritto (`org.springframework.beans.factory.annotation.Autowired`)
	Args        string `json:"args,omitempty"`
	Line        int    `json:"line,omitempty"`
	StartColumn int    `json:"startColumn,omitempty"`
	EndColumn   int    `json:"endColumn,omitempty"`
}

// javaParam è un parametro di metodo o costruttore.
type javaParam struct {
	Type        string           `json:"type"`
	Name        string           `json:"name"`
	Annotations []javaAnnotation `json:"annotations,omitempty"`
}

// javaMember è un campo, un metodo o un costruttore dichiarato in una classe.
type javaMember struct {
	Class       string           `json:"class"`
	Name        string           `json:"name"`
	Type        string           `json:"type,omitempty"`
	Kind        string           `json:"kind"` // "field" | "method" | "constructor"
	Annotations []javaAnnotation `json:"annotations,omitempty"`
	Params      []javaParam      `json:"params,omitempty"`
	// Final, Static e Initialized servono alle iniezioni che Lombok genera (@RequiredArgsConstructor): solo i campi.
	Final       bool `json:"final,omitempty"`
	Static      bool `json:"static,omitempty"`
	Initialized bool `json:"initialized,omitempty"`
	Line        int  `json:"line,omitempty"`
	StartColumn int  `json:"startColumn,omitempty"`
	EndColumn   int  `json:"endColumn,omitempty"`
}

// javaTypeDecl è una classe, interfaccia, enum o record con le sue annotation.
type javaTypeDecl struct {
	Name        string           `json:"name"` // qualificato (`com.acme.UserService`)
	Short       string           `json:"short"`
	Kind        string           `json:"kind"` // "class" | "interface" | "enum" | "record"
	Annotations []javaAnnotation `json:"annotations,omitempty"`
	// Supertypes sono i tipi dopo `extends` e `implements` (nomi come scritti, senza generici): un'iniezione per
	// interfaccia si risolve nel bean che la implementa.
	Supertypes []string `json:"supertypes,omitempty"`
	// Componenti del record (`record Props(String nome)`): per Spring sono proprietà.
	Components []javaParam `json:"components,omitempty"`
	// Intervallo del corpo: serve per sapere a quale classe appartiene un membro.
	bodyStart, bodyEnd int
	// declEnd è l'offset di byte a cui finisce la dichiarazione del tipo.
	declEnd     int
	Line        int `json:"line,omitempty"`
	StartColumn int `json:"startColumn,omitempty"`
	EndColumn   int `json:"endColumn,omitempty"`
}

// javaSource è il risultato del parsing leggero di un file .java.
type javaSource struct {
	File    string
	Package string
	Types   []javaTypeDecl
	Members []javaMember
}

// Elementi prodotti dallo scanner: annotation, dichiarazione o parentesi graffa.
type javaToken struct {
	kind       string // "annotation" | "declaration" | "open" | "close"
	start, end int
	text       string
	annotation javaAnnotation
}

// readJavaSource legge e analizza un sorgente Java. Restituisce false per i file troppo grandi o
// illeggibili: l'indice Spring non deve mai fallire per un file singolo.
func readJavaSource(path, projectRoot string) (javaSource, bool) {
	data, err := os.ReadFile(path)
	if err != nil {
		return javaSource{}, false
	}
	source := parseJavaSource(data)
	source.File = relativeTo(projectRoot, path)
	return source, true
}

// parseJavaSource estrae package, classi, membri e annotation da un sorgente Java.
// È un parser leggero (non un compilatore): basta a trovare bean, iniezioni ed endpoint.
func parseJavaSource(data []byte) javaSource {
	clean := stripJavaComments(data)
	source := javaSource{}
	if match := packageLine.FindSubmatch(clean); match != nil {
		source.Package = string(match[1])
	}
	tokens := scanJavaTokens(clean)
	declared := scanJavaTypes(clean, tokens, source.Package)
	source.Types = declared.types
	source.Members = scanJavaMembers(clean, tokens, declared)
	return source
}

// scanJavaTypes trova le dichiarazioni di tipo e i limiti del loro corpo.
func scanJavaTypes(data []byte, tokens []javaToken, pkg string) (declared javaDeclarations) {
	pending := map[int][]javaAnnotation{}
	for index, token := range tokens {
		switch token.kind {
		case "annotation":
			pending[index] = nil
		case "declaration":
			annotations := collectPending(tokens, pending, index)
			if decl, ok := parseJavaType(data, token, annotations, pkg); ok {
				declared.types = append(declared.types, decl)
			}
		}
	}
	// I limiti del corpo: la prima graffa dopo la dichiarazione, chiusa dalla sua pari.
	for position := range declared.types {
		declared.types[position].bodyStart, declared.types[position].bodyEnd = bodyRange(data, tokens, declared.types[position])
	}
	return declared
}

type javaDeclarations struct {
	types []javaTypeDecl
}

// parseJavaType riconosce `class|interface|enum|record Nome` in una dichiarazione.
func parseJavaType(data []byte, token javaToken, annotations []javaAnnotation, pkg string) (javaTypeDecl, bool) {
	match := javaTypePattern.FindStringSubmatchIndex(token.text)
	if match == nil {
		return javaTypeDecl{}, false
	}
	kind := strings.TrimSpace(token.text[match[2]:match[3]])
	short := strings.TrimSpace(token.text[match[4]:match[5]])
	if short == "" {
		return javaTypeDecl{}, false
	}
	name := short
	if pkg != "" {
		name = pkg + "." + short
	}
	nameStart := token.start + match[4]
	line, startColumn, endColumn := locate(data, pomText{start: nameStart, end: nameStart + len(short)})
	return javaTypeDecl{
		Name: name, Short: short, Kind: kind, Annotations: annotations,
		Components: recordComponents(token.text, match[5], kind),
		Supertypes: supertypesOf(token.text[match[5]:]),
		bodyStart:  -1, bodyEnd: -1, declEnd: token.end,
		Line: line, StartColumn: startColumn, EndColumn: endColumn,
	}, true
}

// supertypesOf legge `extends A implements B, C<D>` dalla coda della dichiarazione (dopo il nome del tipo).
func supertypesOf(rest string) []string {
	if cut := strings.IndexByte(rest, '{'); cut >= 0 {
		rest = rest[:cut]
	}
	var found []string
	for _, keyword := range []string{"extends", "implements"} {
		at := strings.Index(" "+rest+" ", " "+keyword+" ")
		if at < 0 {
			continue
		}
		list := (" " + rest + " ")[at+len(keyword)+2:]
		for _, other := range []string{" extends ", " implements ", " permits "} {
			if cut := strings.Index(list, other); cut >= 0 {
				list = list[:cut]
			}
		}
		for _, item := range splitTopLevel(list, ',') {
			name := strings.TrimSpace(item)
			if cut := strings.IndexByte(name, '<'); cut >= 0 {
				name = name[:cut]
			}
			if name = strings.TrimSpace(name); name != "" {
				found = append(found, name)
			}
		}
	}
	return found
}

// recordComponents sono i componenti di un record: per Spring sono proprietà di configurazione.
func recordComponents(text string, afterName int, kind string) []javaParam {
	if kind != "record" {
		return nil
	}
	rest := strings.TrimSpace(text[afterName:])
	if !strings.HasPrefix(rest, "(") {
		return nil
	}
	end := matchParen(rest, 0)
	if end < 0 {
		return nil
	}
	return parseJavaParams(rest[1:end])
}

// scanJavaMembers associa ogni dichiarazione di campo/metodo alla classe che la contiene.
func scanJavaMembers(data []byte, tokens []javaToken, declared javaDeclarations) []javaMember {
	var members []javaMember
	for index, token := range tokens {
		if token.kind != "declaration" {
			continue
		}
		annotations := collectPending(tokens, map[int][]javaAnnotation{}, index)
		owner := ownerOf(declared.types, token.start)
		for _, member := range parseJavaMembers(data, token, annotations, owner) {
			members = append(members, member)
		}
	}
	return members
}

// ownerOf è la classe il cui corpo contiene l'offset: la più interna tra quelle candidate.
func ownerOf(types []javaTypeDecl, offset int) javaTypeDecl {
	var found javaTypeDecl
	found.Short = ""
	for _, decl := range types {
		if decl.bodyStart >= 0 && offset > decl.bodyStart && offset < decl.bodyEnd {
			if found.Short == "" || decl.bodyStart > found.bodyStart {
				found = decl
			}
		}
	}
	return found
}

// bodyRange trova l'intervallo del corpo di un tipo: la prima graffa dopo la dichiarazione.
func bodyRange(data []byte, tokens []javaToken, decl javaTypeDecl) (int, int) {
	depth := 0
	started := false
	for _, token := range tokens {
		if token.end <= decl.declEnd {
			continue
		}
		switch token.kind {
		case "open":
			if !started {
				started = true
			}
			depth++
		case "close":
			if !started {
				return -1, -1
			}
			depth--
			if depth == 0 {
				return decl.declEnd, token.start
			}
		}
	}
	return -1, -1
}

// parseJavaMembers riconosce campo, metodo o costruttore in una dichiarazione.
func parseJavaMembers(data []byte, token javaToken, annotations []javaAnnotation, owner javaTypeDecl) []javaMember {
	text := strings.TrimSpace(token.text)
	if text == "" || strings.HasPrefix(text, "package ") || strings.HasPrefix(text, "import ") {
		return nil
	}
	// Una dichiarazione di tipo non è un membro: la classe appartiene a se stessa.
	if javaTypePattern.MatchString(text) {
		return nil
	}
	line, startColumn, endColumn := locate(data, pomText{start: token.start, end: token.end})
	name, typ, params, isMethod := splitDeclaration(text, owner.Short)
	if name == "" {
		return nil
	}
	// Le espressioni (`return x;`, `throw new …`) non sono dichiarazioni.
	if first := strings.Fields(text); len(first) > 0 && javaKeywords[first[0]] {
		return nil
	}
	kind := "field"
	if isMethod {
		kind = "method"
		if owner.Short != "" && name == owner.Short {
			kind = "constructor"
		}
	}
	member := javaMember{
		Class: owner.Name, Name: name, Type: typ, Kind: kind,
		Annotations: annotations, Params: params,
		Line: line, StartColumn: startColumn, EndColumn: endColumn,
	}
	if kind == "field" {
		member.Final, member.Static, member.Initialized = fieldFlags(text)
	}
	return []javaMember{member}
}

// splitDeclaration separa nome, tipo e parametri di una dichiarazione.
func splitDeclaration(text, ownerShort string) (name, typ string, params []javaParam, isMethod bool) {
	open := indexTopLevel(text, '(')
	if open < 0 {
		// Campo: `private String nome;` (o `String nome = …`).
		head := text
		if cut := strings.IndexAny(head, "=;"); cut >= 0 {
			head = head[:cut]
		}
		fields := strings.Fields(strings.TrimSpace(head))
		if len(fields) < 2 {
			return "", "", nil, false
		}
		return fields[len(fields)-1], strings.Join(stripModifiers(fields[:len(fields)-1]), " "), nil, false
	}
	close := matchParen(text, open)
	if close < 0 {
		return "", "", nil, false
	}
	head := strings.TrimSpace(text[:open])
	fields := strings.Fields(head)
	if len(fields) == 0 {
		return "", "", nil, false
	}
	name = fields[len(fields)-1]
	typ = strings.Join(stripModifiers(fields[:len(fields)-1]), " ")
	params = parseJavaParams(text[open+1 : close])
	return name, typ, params, true
}

// fieldFlags dice se un campo è `final`, `static` e se ha un inizializzatore (`= …`).
func fieldFlags(text string) (final, static, initialized bool) {
	head := text
	if cut := strings.IndexAny(head, "=;"); cut >= 0 {
		initialized = head[cut] == '='
		head = head[:cut]
	}
	for _, word := range strings.Fields(head) {
		switch word {
		case "final":
			final = true
		case "static":
			static = true
		}
	}
	return final, static, initialized
}

// javaModifiers sono i modificatori Java: non fanno parte del tipo.
var javaModifiers = map[string]bool{
	"public": true, "private": true, "protected": true, "static": true, "final": true,
	"abstract": true, "native": true, "synchronized": true, "transient": true, "volatile": true,
	"strictfp": true, "default": true,
}

func stripModifiers(fields []string) []string {
	var kept []string
	for _, field := range fields {
		if !javaModifiers[field] {
			kept = append(kept, field)
		}
	}
	return kept
}

// parseJavaParams legge i parametri di un metodo o costruttore, annotation comprese.
func parseJavaParams(body string) []javaParam {
	var params []javaParam
	for _, chunk := range splitTopLevel(body, ',') {
		chunk = strings.TrimSpace(chunk)
		if chunk == "" {
			continue
		}
		param := javaParam{}
		// Le annotation del parametro (`@Qualifier("x") final Foo bar`).
		for strings.HasPrefix(chunk, "@") {
			end := annotationEnd(chunk)
			if end <= 0 {
				break
			}
			param.Annotations = append(param.Annotations, parseJavaAnnotation(chunk[:end], 0, 0, 0))
			chunk = strings.TrimSpace(chunk[end:])
		}
		chunk = strings.TrimSpace(strings.TrimPrefix(chunk, "final "))
		fields := strings.Fields(chunk)
		if len(fields) == 0 {
			continue
		}
		param.Name = strings.Trim(fields[len(fields)-1], "[]")
		param.Type = strings.Trim(strings.Join(fields[:len(fields)-1], " "), "[]")
		if param.Type == "" {
			param.Type = param.Name
			param.Name = ""
		}
		params = append(params, param)
	}
	return params
}

// parseJavaAnnotation costruisce un'annotation dal suo testo (`@Autowired(required=false)`).
func parseJavaAnnotation(text string, line, startColumn, endColumn int) javaAnnotation {
	name := strings.TrimSpace(strings.TrimPrefix(strings.SplitN(text, "(", 2)[0], "@"))
	annotation := javaAnnotation{Name: name, FullName: name, Line: line, StartColumn: startColumn, EndColumn: endColumn}
	if open := strings.Index(text, "("); open >= 0 && strings.HasSuffix(strings.TrimSpace(text), ")") {
		annotation.Args = strings.TrimSpace(text[open+1 : strings.LastIndex(text, ")")])
	}
	if dot := strings.LastIndex(name, "."); dot >= 0 {
		annotation.Name = name[dot+1:]
	}
	return annotation
}

// annotationEnd è la fine del testo di un'annotation, argomenti compresi.
// Il nome finisce al primo carattere che non fa parte di un identificatore Java: la `(` di un'altra
// annotation successiva non deve mai unire le due.
func annotationEnd(text string) int {
	index := 1
	for index < len(text) && isJavaNameChar(text[index]) {
		index++
	}
	if index < len(text) && text[index] == '(' {
		if close := matchParen(text, index); close >= 0 {
			return close + 1
		}
	}
	return index
}

func isJavaNameChar(value byte) bool {
	return value == '_' || value == '$' || value == '.' ||
		value >= 'a' && value <= 'z' || value >= 'A' && value <= 'Z' || value >= '0' && value <= '9'
}

// javaTypePattern cattura la keyword di tipo e il nome breve.
var javaTypePattern = regexp.MustCompile(`\b(class|interface|enum|record)\s+([A-Za-z_$][\w$]*)`)

// javaKeywords sono le parole che non iniziano una dichiarazione di campo o metodo.
var javaKeywords = map[string]bool{
	"if": true, "for": true, "while": true, "switch": true, "catch": true, "return": true,
	"new": true, "throw": true, "synchronized": true, "else": true, "do": true, "try": true,
	"case": true, "assert": true, "package": true, "import": true,
}

// scanJavaTokens produce l'elenco di annotation, dichiarazioni e graffe di un sorgente.
func scanJavaTokens(data []byte) []javaToken {
	var tokens []javaToken
	index := 0
	for index < len(data) {
		for index < len(data) && isJavaSpace(data[index]) {
			index++
		}
		if index >= len(data) {
			break
		}
		switch {
		case data[index] == '@':
			end := index + annotationEnd(string(data[index:]))
			if end <= index {
				end = index + 1
			}
			line, startColumn, endColumn := locate(data, pomText{start: index, end: end})
			tokens = append(tokens, javaToken{
				kind: "annotation", start: index, end: end, text: string(data[index:end]),
				annotation: parseJavaAnnotation(string(data[index:end]), line, startColumn, endColumn),
			})
			index = end
		case data[index] == '{':
			tokens = append(tokens, javaToken{kind: "open", start: index, end: index + 1, text: "{"})
			index++
		case data[index] == '}':
			tokens = append(tokens, javaToken{kind: "close", start: index, end: index + 1, text: "}"})
			index++
		default:
			end := declarationEnd(data, index)
			tokens = append(tokens, javaToken{kind: "declaration", start: index, end: end, text: string(data[index:end])})
			index = end
		}
	}
	return tokens
}

// declarationEnd è la fine di una dichiarazione: `;`, `{`, `}` oppure l'annotation successiva.
func declarationEnd(data []byte, start int) int {
	depth := 0
	for index := start; index < len(data); index++ {
		switch data[index] {
		case '(', '[':
			depth++
		case ')', ']':
			depth--
		case '{', '}':
			if depth <= 0 {
				return index
			}
		case ';':
			if depth <= 0 {
				return index + 1
			}
		case '@':
			if depth <= 0 && index > start {
				return index
			}
		}
	}
	return len(data)
}

// collectPending è la coda di annotation che precedono la dichiarazione a `index`.
func collectPending(tokens []javaToken, _ map[int][]javaAnnotation, index int) []javaAnnotation {
	var annotations []javaAnnotation
	for position := index - 1; position >= 0; position-- {
		if tokens[position].kind != "annotation" {
			break
		}
		annotations = append([]javaAnnotation{tokens[position].annotation}, annotations...)
	}
	return annotations
}

// stripJavaComments sostituisce i commenti con spazi, lasciando intatte le posizioni.
func stripJavaComments(data []byte) []byte {
	out := make([]byte, len(data))
	copy(out, data)
	index := 0
	for index < len(out) {
		switch {
		case out[index] == '/' && index+1 < len(out) && out[index+1] == '/':
			for index < len(out) && out[index] != '\n' {
				out[index] = ' '
				index++
			}
		case out[index] == '/' && index+1 < len(out) && out[index+1] == '*':
			for index < len(out) && !(out[index] == '*' && index+1 < len(out) && out[index+1] == '/') {
				if out[index] != '\n' {
					out[index] = ' '
				}
				index++
			}
			if index < len(out) {
				out[index], out[index+1] = ' ', ' '
				index += 2
			}
		case out[index] == '"' || out[index] == '\'':
			quote := out[index]
			index++
			for index < len(out) && out[index] != quote {
				if out[index] == '\\' {
					index++
				}
				index++
			}
			index++
		default:
			index++
		}
	}
	return out
}

func isJavaSpace(value byte) bool {
	return value == ' ' || value == '\t' || value == '\r' || value == '\n'
}

// indexTopLevel è l'indice del carattere cercato fuori da parentesi e quadre.
func indexTopLevel(text string, target byte) int {
	depth := 0
	for index := 0; index < len(text); index++ {
		if depth == 0 && text[index] == target {
			return index
		}
		switch text[index] {
		case '(', '[':
			depth++
		case ')', ']':
			depth--
		}
	}
	return -1
}

// matchParen è l'indice della parentesi chiusa corrispondente a `open`.
func matchParen(text string, open int) int {
	depth := 0
	for index := open; index < len(text); index++ {
		switch text[index] {
		case '(':
			depth++
		case ')':
			depth--
			if depth == 0 {
				return index
			}
		}
	}
	return -1
}

// splitTopLevel divide per `separator` fuori dalle parentesi.
func splitTopLevel(text string, separator byte) []string {
	var chunks []string
	depth, start := 0, 0
	for index := 0; index < len(text); index++ {
		switch text[index] {
		case '(', '[', '{':
			depth++
		case ')', ']', '}':
			depth--
		default:
			if depth == 0 && text[index] == separator {
				chunks = append(chunks, text[start:index])
				start = index + 1
			}
		}
	}
	return append(chunks, text[start:])
}

// relativeTo è il percorso relativo del file rispetto alla root, con separatori `/`.
func relativeTo(root, path string) string {
	slashedRoot := strings.TrimSuffix(filepathToSlash(root), "/")
	slashedPath := filepathToSlash(path)
	if strings.HasPrefix(slashedPath, slashedRoot+"/") {
		return strings.TrimPrefix(slashedPath, slashedRoot+"/")
	}
	return slashedPath
}

func filepathToSlash(path string) string {
	return strings.ReplaceAll(path, "\\", "/")
}
