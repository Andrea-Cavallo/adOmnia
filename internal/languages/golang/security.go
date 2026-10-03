package golang

import (
	"go/ast"
	"go/parser"
	"go/token"
	"path"
	"strconv"
	"strings"

	"adomnia/internal/ide/security"
)

// Regole statiche Go: euristiche conservative sull'AST (senza type checking), pensate per pochi falsi positivi.
const (
	RuleTLSInsecureSkipVerify = "go/tls-insecure-skip-verify"
	RuleTLSOldVersion         = "go/tls-old-version"
	RuleWeakCrypto            = "go/weak-crypto"
	RuleWeakRSAKey            = "go/weak-rsa-key"
	RuleInsecureHTTP          = "go/insecure-http"
	RuleSQLInjection          = "go/sql-injection"
	RuleCommandInjection      = "go/command-injection"
	RulePathTraversal         = "go/path-traversal"
	RuleZipSlip               = "go/zip-slip"
	RuleUnsafeDeserialization = "go/unsafe-deserialization"
	RuleUnboundedBody         = "go/unbounded-request-body"
	RuleFilePermissions       = "go/file-permissions"

	minRSABits = 2048
)

var goSecurityRules = []security.Rule{
	{ID: RuleTLSInsecureSkipVerify, Category: "TLS", Severity: security.SeverityHigh, Title: "TLS certificate verification disabled",
		Description: "InsecureSkipVerify: true accepts any certificate, so a man-in-the-middle can read and change the traffic.",
		Remediation: "Remove InsecureSkipVerify. For a private CA, load it into tls.Config.RootCAs; for tests, use httptest's client."},
	{ID: RuleTLSOldVersion, Category: "TLS", Severity: security.SeverityMedium, Title: "Obsolete TLS version allowed",
		Description: "TLS 1.0/1.1 and SSL 3.0 have known weaknesses and are rejected by modern clients and compliance rules.",
		Remediation: "Set MinVersion to tls.VersionTLS12 or tls.VersionTLS13."},
	{ID: RuleWeakCrypto, Category: "Crypto", Severity: security.SeverityMedium, Title: "Weak cryptographic algorithm",
		Description: "MD5, SHA-1, DES/3DES and RC4 are broken for security uses (signatures, passwords, integrity against an attacker).",
		Remediation: "Use SHA-256 or better for hashing, AES-GCM or ChaCha20-Poly1305 for encryption, and bcrypt/argon2 for passwords. Suppress with a reason if it is a non-security checksum."},
	{ID: RuleWeakRSAKey, Category: "Crypto", Severity: security.SeverityMedium, Title: "RSA key shorter than 2048 bits",
		Description: "RSA keys under 2048 bits can be factored with affordable resources.",
		Remediation: "Generate keys of at least 2048 bits (3072 for long-lived keys)."},
	{ID: RuleInsecureHTTP, Category: "Transport", Severity: security.SeverityLow, Title: "Plain HTTP",
		Description: "Traffic over http:// or a server started without TLS can be read and modified on the network.",
		Remediation: "Use https:// endpoints and ListenAndServeTLS (or terminate TLS in front of the service and document it)."},
	{ID: RuleSQLInjection, Category: "Injection", Severity: security.SeverityHigh, Title: "SQL built from strings",
		Description: "The query text is built with fmt.Sprintf or string concatenation; values that reach it can change the SQL.",
		Remediation: "Use placeholders ($1, ?) and pass values as arguments to Query/Exec."},
	{ID: RuleCommandInjection, Category: "Injection", Severity: security.SeverityHigh, Title: "Shell command built from data",
		Description: "A shell (sh -c, cmd /C, powershell -Command) runs a command line that is not a constant: input can add commands.",
		Remediation: "Run the program directly with exec.Command(name, args...) and validate the arguments; avoid the shell."},
	{ID: RulePathTraversal, Category: "Injection", Severity: security.SeverityMedium, Title: "File path from request input",
		Description: "A filesystem path uses request data (URL, query, form, route params); \"../\" can reach files outside the intended folder.",
		Remediation: "Clean the name, reject \"..\" and absolute paths, and check the result stays under the base directory (os.Root on Go 1.24+)."},
	{ID: RuleZipSlip, Category: "Injection", Severity: security.SeverityHigh, Title: "Archive entry name used as a path (zip slip)",
		Description: "Joining an archive entry name to a destination lets entries like \"../../x\" write outside it.",
		Remediation: "Reject names with \"..\" or absolute paths and verify the joined path has the destination as prefix."},
	{ID: RuleUnsafeDeserialization, Category: "Deserialization", Severity: security.SeverityMedium, Title: "gob decoding of untrusted input",
		Description: "encoding/gob is not designed for hostile input: crafted data can exhaust memory or CPU.",
		Remediation: "Use JSON or protobuf with size limits for data from clients, or authenticate the peer first."},
	{ID: RuleUnboundedBody, Category: "Deserialization", Severity: security.SeverityLow, Title: "Request body decoded without a size limit",
		Description: "Decoding r.Body without http.MaxBytesReader lets a client send an arbitrarily large body.",
		Remediation: "Wrap the body: r.Body = http.MaxBytesReader(w, r.Body, limit)."},
	{ID: RuleFilePermissions, Category: "Filesystem", Severity: security.SeverityHigh, Title: "World-writable file permissions",
		Description: "Mode bits let any local user modify the file or directory (for example 0666, 0777 or os.ModePerm).",
		Remediation: "Use 0o600/0o644 for files and 0o700/0o755 for directories."},
}

// requestInputMarkers sono espressioni tipiche dei dati di una richiesta HTTP (net/http, gin, echo, chi, mux).
var requestInputMarkers = []string{".URL.Path", ".URL.Query()", ".URL.RawQuery", ".FormValue(", ".PostFormValue(", ".Form.Get(", ".PathValue(", "mux.Vars(", "chi.URLParam(", ".Param(", ".Query(", ".QueryParam(", ".DefaultQuery(", ".Params.ByName("}

var sqlMethods = map[string]int{
	"Query": 0, "QueryRow": 0, "Exec": 0, "Prepare": 0, "Raw": 0, "Select": 1, "Get": 1, "MustExec": 0, "Queryx": 0, "QueryRowx": 0,
	"QueryContext": 1, "QueryRowContext": 1, "ExecContext": 1, "PrepareContext": 1, "SelectContext": 2, "GetContext": 2, "QueryxContext": 1,
}

var sqlKeywords = []string{"SELECT ", "INSERT ", "UPDATE ", "DELETE ", " FROM ", " WHERE ", "ORDER BY", "DROP ", "CREATE ", "ALTER "}

var weakCryptoPackages = map[string]string{"crypto/md5": "MD5", "crypto/sha1": "SHA-1", "crypto/des": "DES/3DES", "crypto/rc4": "RC4"}

var oldTLSVersions = map[string]bool{"VersionTLS10": true, "VersionTLS11": true, "VersionSSL30": true}

var shells = map[string]string{"sh": "-c", "bash": "-c", "zsh": "-c", "/bin/sh": "-c", "/bin/bash": "-c", "cmd": "/c", "cmd.exe": "/c", "powershell": "-command", "powershell.exe": "-command", "pwsh": "-command"}

var permissionCalls = map[string]int{"WriteFile": 2, "OpenFile": 2, "Mkdir": 1, "MkdirAll": 1, "Chmod": 1}

// SecurityAnalyzer applica le regole Go a ogni file .go non di test.
type SecurityAnalyzer struct{}

var _ security.Analyzer = SecurityAnalyzer{}

func (SecurityAnalyzer) Rules() []security.Rule { return goSecurityRules }

func (SecurityAnalyzer) Accepts(relativePath string) bool {
	return path.Ext(relativePath) == ".go" && !strings.HasSuffix(relativePath, "_test.go")
}

func (SecurityAnalyzer) Analyze(relativePath string, content []byte) []security.Finding {
	files := token.NewFileSet()
	file, err := parser.ParseFile(files, relativePath, content, parser.SkipObjectResolution|parser.ParseComments)
	if err != nil || ast.IsGenerated(file) {
		return nil
	}
	checker := &securityChecker{files: files, source: content, imports: importNames(file)}
	for _, declaration := range file.Decls {
		if function, ok := declaration.(*ast.FuncDecl); ok && function.Body != nil {
			checker.checkFunction(function.Type, function.Body)
		}
	}
	ast.Inspect(file, checker.visit)
	return checker.findings
}

// importNames mappa il nome locale (alias compreso) al percorso dell'import.
func importNames(file *ast.File) map[string]string {
	names := map[string]string{}
	for _, spec := range file.Imports {
		importPath, err := strconv.Unquote(spec.Path.Value)
		if err != nil {
			continue
		}
		name := path.Base(importPath)
		if strings.HasPrefix(name, "v") && len(name) <= 3 { // github.com/x/yaml/v3 → yaml
			name = path.Base(path.Dir(importPath))
		}
		if spec.Name != nil {
			name = spec.Name.Name
		}
		names[name] = importPath
	}
	return names
}

type securityChecker struct {
	files    *token.FileSet
	source   []byte
	imports  map[string]string
	findings []security.Finding
	reported map[token.Pos]map[string]bool
}

func (c *securityChecker) report(node ast.Node, rule, message string) {
	if c.reported == nil {
		c.reported = map[token.Pos]map[string]bool{}
	}
	if c.reported[node.Pos()] == nil {
		c.reported[node.Pos()] = map[string]bool{}
	}
	if c.reported[node.Pos()][rule] {
		return
	}
	c.reported[node.Pos()][rule] = true
	position := c.files.Position(node.Pos())
	for _, candidate := range goSecurityRules {
		if candidate.ID == rule {
			c.findings = append(c.findings, security.Finding{Rule: rule, Category: candidate.Category, Severity: candidate.Severity, Title: candidate.Title, Message: message, Line: position.Line, Column: position.Column})
			return
		}
	}
}

func (c *securityChecker) text(node ast.Node) string {
	start, end := c.files.Position(node.Pos()).Offset, c.files.Position(node.End()).Offset
	if start < 0 || end > len(c.source) || start > end {
		return ""
	}
	return string(c.source[start:end])
}

// call riconosce pkg.Func con il percorso reale del package, alias compresi.
func (c *securityChecker) call(expression *ast.CallExpr) (string, string) {
	selector, ok := expression.Fun.(*ast.SelectorExpr)
	if !ok {
		return "", ""
	}
	if identifier, ok := selector.X.(*ast.Ident); ok {
		if importPath, ok := c.imports[identifier.Name]; ok {
			return importPath, selector.Sel.Name
		}
	}
	return "", selector.Sel.Name
}

func (c *securityChecker) visit(node ast.Node) bool {
	switch typed := node.(type) {
	case *ast.KeyValueExpr:
		c.checkTLSField(typed)
	case *ast.AssignStmt:
		c.checkTLSAssign(typed)
	case *ast.CallExpr:
		c.checkCall(typed)
	case *ast.BasicLit:
		c.checkHTTPLiteral(typed)
	}
	return true
}

func (c *securityChecker) checkTLSField(field *ast.KeyValueExpr) {
	key, ok := field.Key.(*ast.Ident)
	if !ok {
		return
	}
	c.checkTLSSetting(field, key.Name, field.Value)
}

func (c *securityChecker) checkTLSAssign(assign *ast.AssignStmt) {
	for index, left := range assign.Lhs {
		selector, ok := left.(*ast.SelectorExpr)
		if !ok || index >= len(assign.Rhs) {
			continue
		}
		c.checkTLSSetting(assign, selector.Sel.Name, assign.Rhs[index])
	}
}

func (c *securityChecker) checkTLSSetting(node ast.Node, name string, value ast.Expr) {
	switch name {
	case "InsecureSkipVerify":
		if identifier, ok := value.(*ast.Ident); ok && identifier.Name == "true" {
			c.report(node, RuleTLSInsecureSkipVerify, "InsecureSkipVerify is true: any TLS certificate is accepted.")
		}
	case "MinVersion", "MaxVersion":
		if selector, ok := value.(*ast.SelectorExpr); ok && oldTLSVersions[selector.Sel.Name] && name == "MinVersion" {
			c.report(node, RuleTLSOldVersion, "MinVersion allows "+strings.TrimPrefix(selector.Sel.Name, "Version")+".")
		}
	}
}

func (c *securityChecker) checkCall(call *ast.CallExpr) {
	importPath, name := c.call(call)
	if algorithm, weak := weakCryptoPackages[importPath]; weak && (name == "Sum" || strings.HasPrefix(name, "New")) {
		c.report(call, RuleWeakCrypto, algorithm+" is used ("+path.Base(importPath)+"."+name+").")
	}
	switch {
	case importPath == "crypto/rsa" && name == "GenerateKey" && len(call.Args) == 2:
		if bits, ok := intLiteral(call.Args[1]); ok && bits < minRSABits {
			c.report(call, RuleWeakRSAKey, "RSA key of "+strconv.Itoa(bits)+" bits.")
		}
	case importPath == "net/http" && (name == "ListenAndServe") && len(call.Args) >= 1:
		if address, ok := stringLiteral(call.Args[0]); !ok || !isLocalAddress(address) {
			c.report(call, RuleInsecureHTTP, "http.ListenAndServe serves plain HTTP.")
		}
	case importPath == "os/exec" && (name == "Command" || name == "CommandContext"):
		c.checkCommand(call, name == "CommandContext")
	case importPath == "os" && permissionCalls[name] > 0, importPath == "io/ioutil" && name == "WriteFile":
		c.checkPermissions(call, permissionCalls[name])
	case importPath == "encoding/gob" && name == "NewDecoder" && len(call.Args) == 1:
		if source := c.text(call.Args[0]); strings.Contains(source, "Body") || strings.Contains(strings.ToLower(source), "conn") {
			c.report(call, RuleUnsafeDeserialization, "gob decodes data from "+source+".")
		}
	case importPath == "path/filepath" && name == "Join" || importPath == "path" && name == "Join":
		c.checkJoin(call)
	case importPath == "os" && (name == "Open" || name == "ReadFile" || name == "Create" || name == "Remove" || name == "RemoveAll" || name == "OpenFile") || importPath == "net/http" && name == "ServeFile":
		c.checkPathArguments(call)
	}
	if index, ok := sqlMethods[name]; ok && importPath == "" && index < len(call.Args) {
		c.checkSQL(call, call.Args[index])
	}
}

func (c *securityChecker) checkHTTPLiteral(literal *ast.BasicLit) {
	if literal.Kind != token.STRING {
		return
	}
	value, err := strconv.Unquote(literal.Value)
	if err != nil || !strings.HasPrefix(value, "http://") || len(value) <= len("http://") {
		return
	}
	host := strings.TrimPrefix(value, "http://")
	host = strings.SplitN(strings.SplitN(host, "/", 2)[0], ":", 2)[0]
	if isLocalAddress(host) || isNamespaceHost(host) || strings.ContainsAny(host, "%{}<$") {
		return
	}
	c.report(literal, RuleInsecureHTTP, "Plain HTTP URL "+value+".")
}

func isLocalAddress(address string) bool {
	host := strings.SplitN(strings.TrimPrefix(address, ":"), ":", 2)[0]
	if strings.HasPrefix(address, ":") || address == "" {
		return false
	}
	return host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "[::1]" || host == "0.0.0.0" || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".test") || strings.HasSuffix(host, ".internal")
}

// isNamespaceHost: URL usati come identificatori (namespace XML, schemi) o esempi, non come endpoint.
func isNamespaceHost(host string) bool {
	for _, known := range []string{"www.w3.org", "schemas.xmlsoap.org", "schemas.microsoft.com", "json-schema.org", "purl.org", "xmlns.com", "ns.adobe.com", "example.com", "example.org", "example.net", "docs.oasis-open.org", "www.apache.org", "go.dev", "golang.org"} {
		if host == known {
			return true
		}
	}
	return false
}

func (c *securityChecker) checkSQL(call *ast.CallExpr, query ast.Expr) {
	built, how := c.dynamicString(query)
	if !built || !looksLikeSQL(c.text(query)) {
		return
	}
	c.report(call, RuleSQLInjection, "The SQL text is built with "+how+".")
}

// dynamicString dice se un'espressione costruisce una stringa da valori non costanti.
func (c *securityChecker) dynamicString(expression ast.Expr) (bool, string) {
	switch typed := expression.(type) {
	case *ast.CallExpr:
		importPath, name := c.call(typed)
		if importPath == "fmt" && name == "Sprintf" && len(typed.Args) > 1 {
			return true, "fmt.Sprintf"
		}
	case *ast.BinaryExpr:
		if typed.Op == token.ADD && !isConstantString(typed) {
			return true, "string concatenation"
		}
	case *ast.ParenExpr:
		return c.dynamicString(typed.X)
	}
	return false, ""
}

func isConstantString(expression ast.Expr) bool {
	switch typed := expression.(type) {
	case *ast.BasicLit:
		return typed.Kind == token.STRING
	case *ast.BinaryExpr:
		return typed.Op == token.ADD && isConstantString(typed.X) && isConstantString(typed.Y)
	case *ast.ParenExpr:
		return isConstantString(typed.X)
	}
	return false
}

func looksLikeSQL(text string) bool {
	upper := strings.ToUpper(text)
	for _, keyword := range sqlKeywords {
		if strings.Contains(upper, keyword) {
			return true
		}
	}
	return false
}

func (c *securityChecker) checkCommand(call *ast.CallExpr, withContext bool) {
	args := call.Args
	if withContext && len(args) > 0 {
		args = args[1:]
	}
	if len(args) < 3 {
		return
	}
	program, ok := stringLiteral(args[0])
	if !ok {
		return
	}
	flag, isShell := shells[strings.ToLower(program)]
	if !isShell {
		return
	}
	switchArg, ok := stringLiteral(args[1])
	if !ok || strings.ToLower(switchArg) != flag {
		return
	}
	if !isConstantString(args[2]) {
		c.report(call, RuleCommandInjection, program+" "+switchArg+" runs a command line built at runtime.")
	}
}

func (c *securityChecker) checkPermissions(call *ast.CallExpr, modeIndex int) {
	if modeIndex >= len(call.Args) {
		return
	}
	mode := call.Args[modeIndex]
	if selector, ok := mode.(*ast.SelectorExpr); ok && selector.Sel.Name == "ModePerm" {
		c.report(call, RuleFilePermissions, "os.ModePerm (0777) makes it writable by every user.")
		return
	}
	if value, ok := intLiteral(mode); ok && value&0o002 != 0 {
		c.report(call, RuleFilePermissions, "Mode "+c.text(mode)+" is writable by every user.")
	}
}

func (c *securityChecker) checkPathArguments(call *ast.CallExpr) {
	for _, argument := range call.Args {
		if marker := requestInput(c.text(argument)); marker != "" {
			c.report(call, RulePathTraversal, "The path uses request input ("+marker+").")
			return
		}
	}
}

func (c *securityChecker) checkJoin(call *ast.CallExpr) {
	for index, argument := range call.Args {
		text := c.text(argument)
		if marker := requestInput(text); marker != "" {
			c.report(call, RulePathTraversal, "filepath.Join uses request input ("+marker+").")
			return
		}
		if index > 0 && c.usesArchives() && (strings.HasSuffix(text, ".Name") || strings.HasSuffix(text, "Header.Name")) {
			c.report(call, RuleZipSlip, "An archive entry name ("+text+") is joined to a destination path.")
			return
		}
	}
}

func (c *securityChecker) usesArchives() bool {
	for _, importPath := range c.imports {
		if importPath == "archive/zip" || importPath == "archive/tar" {
			return true
		}
	}
	return false
}

func requestInput(text string) string {
	for _, marker := range requestInputMarkers {
		if strings.Contains(text, marker) {
			return strings.Trim(marker, ".(")
		}
	}
	return ""
}

// checkFunction cerca body di richieste in arrivo decodificati senza MaxBytesReader nella stessa funzione.
// Solo il body di un *http.Request ricevuto (o c.Request.Body nei framework): le risposte dei client non contano.
func (c *securityChecker) checkFunction(signature *ast.FuncType, body *ast.BlockStmt) {
	source := c.text(body)
	if strings.Contains(source, "MaxBytesReader") {
		return
	}
	requests := c.requestParameters(signature)
	ast.Inspect(body, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		importPath, name := c.call(call)
		if (importPath == "encoding/json" || importPath == "encoding/xml") && name == "NewDecoder" && len(call.Args) == 1 && isRequestBody(c.text(call.Args[0]), requests) {
			c.report(call, RuleUnboundedBody, path.Base(importPath)+".NewDecoder reads "+c.text(call.Args[0])+" without a size limit.")
		}
		return true
	})
}

func stringLiteral(expression ast.Expr) (string, bool) {
	literal, ok := expression.(*ast.BasicLit)
	if !ok || literal.Kind != token.STRING {
		return "", false
	}
	value, err := strconv.Unquote(literal.Value)
	return value, err == nil
}

func intLiteral(expression ast.Expr) (int, bool) {
	literal, ok := expression.(*ast.BasicLit)
	if !ok || literal.Kind != token.INT {
		return 0, false
	}
	value, err := strconv.ParseInt(literal.Value, 0, 64)
	return int(value), err == nil
}

// requestParameters restituisce i nomi dei parametri di tipo *http.Request della funzione.
func (c *securityChecker) requestParameters(signature *ast.FuncType) map[string]bool {
	names := map[string]bool{}
	if signature == nil || signature.Params == nil {
		return names
	}
	for _, field := range signature.Params.List {
		star, ok := field.Type.(*ast.StarExpr)
		if !ok {
			continue
		}
		selector, ok := star.X.(*ast.SelectorExpr)
		if !ok || selector.Sel.Name != "Request" {
			continue
		}
		if identifier, ok := selector.X.(*ast.Ident); !ok || c.imports[identifier.Name] != "net/http" {
			continue
		}
		for _, name := range field.Names {
			names[name.Name] = true
		}
	}
	return names
}

func isRequestBody(argument string, requests map[string]bool) bool {
	if strings.HasSuffix(argument, ".Request.Body") {
		return true
	}
	receiver, found := strings.CutSuffix(argument, ".Body")
	return found && requests[receiver]
}
