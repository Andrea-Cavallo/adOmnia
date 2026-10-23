package golang

import (
	"go/ast"
	"go/parser"
	"go/token"
	"strings"
	"testing"
)

const (
	httpHandlerSource = `package api

import "net/http"

func Health(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(200)
}
`
	ginHandlerSource = `package api

import "github.com/gin-gonic/gin"

func List(c *gin.Context) {
}
`
	echoHandlerSource = `package api

import echo "github.com/labstack/echo/v4"

func Get(c echo.Context) error {
	return nil
}
`
	plainHandlerSource = `package api

func Plain(x int) {
}
`
	genericHandlerSource = `package api

import "net/http"

func Generic[T any](w http.ResponseWriter, r *http.Request) {
}
`
)

func TestValidateHandlerTestInput(t *testing.T) {
	valid := HandlerTestInput{Method: "GET", Path: "/users/42?x=1", ExpectedStatus: 200}
	tests := []struct {
		name   string
		source string
		input  HandlerTestInput
		want   string
	}{
		{name: "valid", source: "package api", input: valid},
		{name: "source too large", source: strings.Repeat("a", (2<<20)+1), input: valid, want: "exceeds generation limits"},
		{name: "body too large", source: "package api", input: func() HandlerTestInput {
			in := valid
			in.Body = strings.Repeat("b", (1<<20)+1)
			return in
		}(), want: "exceeds generation limits"},
		{name: "setup too large", source: "package api", input: func() HandlerTestInput {
			in := valid
			in.Setup = strings.Repeat("c", (64<<10)+1)
			return in
		}(), want: "exceeds generation limits"},
		{name: "status too low", source: "package api", input: withStatus(valid, 99), want: "expected HTTP status"},
		{name: "status too high", source: "package api", input: withStatus(valid, 600), want: "expected HTTP status"},
		{name: "method lowercase", source: "package api", input: withMethod(valid, "get"), want: "invalid HTTP method"},
		{name: "method with space", source: "package api", input: withMethod(valid, "GET POST"), want: "invalid HTTP method"},
		{name: "path not absolute", source: "package api", input: withPath(valid, "users/42"), want: "local HTTP path"},
		{name: "path with newline", source: "package api", input: withPath(valid, "/users\r\nX-Evil: 1"), want: "local HTTP path"},
		{name: "path not a request URI", source: "package api", input: withPath(valid, "/users/%zz"), want: "invalid fixture path"},
		{name: "unresolved variable in path", source: "package api", input: withPath(valid, "/users/{{id}}"), want: "unresolved variables"},
		{name: "redacted value in body", source: "package api", input: func() HandlerTestInput {
			in := valid
			in.Body = `{"token":"<redacted>"}`
			return in
		}(), want: "redacted values"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := validateHandlerTestInput(tc.source, tc.input)
			if tc.want == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error = %v, want substring %q", err, tc.want)
			}
		})
	}
}

func withStatus(in HandlerTestInput, status int) HandlerTestInput {
	in.ExpectedStatus = status
	return in
}

func withMethod(in HandlerTestInput, method string) HandlerTestInput {
	in.Method = method
	return in
}

func withPath(in HandlerTestInput, p string) HandlerTestInput {
	in.Path = p
	return in
}

func TestFindEnclosingFunc(t *testing.T) {
	const source = `package api

func First() {}

func Second() {}
`
	fs := token.NewFileSet()
	file, err := parser.ParseFile(fs, "handlers.go", source, 0)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if fn := findEnclosingFunc(fs, file, 5); fn == nil || fn.Name.Name != "Second" {
		t.Fatalf("line 5 should be inside Second, got %v", fn)
	}
	if fn := findEnclosingFunc(fs, file, 3); fn == nil || fn.Name.Name != "First" {
		t.Fatalf("line 3 should be inside First, got %v", fn)
	}
	for _, line := range []int{0, 1, 100} {
		if fn := findEnclosingFunc(fs, file, line); fn != nil {
			t.Fatalf("line %d should not be inside a function, got %s", line, fn.Name.Name)
		}
	}

	// A body-less declaration (assembly stub) has no span to select.
	const stub = `package api

func External(x int)
`
	fs = token.NewFileSet()
	file, err = parser.ParseFile(fs, "stub.go", stub, 0)
	if err != nil {
		t.Fatalf("parse stub: %v", err)
	}
	if fn := findEnclosingFunc(fs, file, 3); fn != nil {
		t.Fatalf("body-less declaration must be ignored, got %s", fn.Name.Name)
	}
}

func TestHandlerImportNames(t *testing.T) {
	const source = `package api

import (
	"net/http"
	web "net/http"
	_ "embed"
)

func H(w web.ResponseWriter) {}
`
	fs := token.NewFileSet()
	file, err := parser.ParseFile(fs, "handlers.go", source, 0)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	got := handlerImportNames(file)
	want := map[string]string{"http": "net/http", "web": "net/http", "_": "embed"}
	if len(got) != len(want) {
		t.Fatalf("imports = %v, want %v", got, want)
	}
	for name, pkg := range want {
		if got[name] != pkg {
			t.Fatalf("imports[%q] = %q, want %q (all: %v)", name, got[name], pkg, got)
		}
	}
}

// A major-version suffix is not part of the package name: `echo/v4` is referenced as `echo`, so
// deriving the identifier from path.Base alone would leave the handler undetected.
func TestHandlerImportNamesUsesThePackageNameForVersionedPaths(t *testing.T) {
	const source = `package api

import (
	"github.com/labstack/echo/v4"
	"github.com/go-chi/chi/v5"
)

func H(c echo.Context) error { return nil }
`
	fs := token.NewFileSet()
	file, err := parser.ParseFile(fs, "handlers.go", source, 0)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	got := handlerImportNames(file)
	for name, pkg := range map[string]string{
		"echo": "github.com/labstack/echo/v4",
		"chi":  "github.com/go-chi/chi/v5",
	} {
		if got[name] != pkg {
			t.Fatalf("imports[%q] = %q, want %q (all: %v)", name, got[name], pkg, got)
		}
	}
}

func TestHandlerParams(t *testing.T) {
	const source = `package api

import "net/http"

func P(a, b string, c int, w http.ResponseWriter, rest ...int) {}
`
	fs := token.NewFileSet()
	file, err := parser.ParseFile(fs, "params.go", source, 0)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	fn := findEnclosingFunc(fs, file, 5)
	if fn == nil {
		t.Fatal("handler not found")
	}
	params := handlerParams(fn)
	if len(params) != 5 {
		t.Fatalf("params = %d, want 5 (grouped names expanded)", len(params))
	}
	if params[0] != params[1] {
		t.Fatal("grouped parameters must share the same type expression")
	}
	if id, ok := params[0].(*ast.Ident); !ok || id.Name != "string" {
		t.Fatalf("first param = %#v, want string", params[0])
	}
	if _, ok := params[4].(*ast.Ellipsis); !ok {
		t.Fatalf("last param = %#v, want variadic", params[4])
	}

	const noParams = `package api

func None() {}
`
	fs = token.NewFileSet()
	file, err = parser.ParseFile(fs, "none.go", noParams, 0)
	if err != nil {
		t.Fatalf("parse none: %v", err)
	}
	if got := handlerParams(findEnclosingFunc(fs, file, 3)); len(got) != 0 {
		t.Fatalf("params = %v, want none", got)
	}

	// Unnamed parameters count once each.
	const unnamed = `package api

func H(nethttp.ResponseWriter, *nethttp.Request) {}
`
	fs = token.NewFileSet()
	file, err = parser.ParseFile(fs, "unnamed.go", unnamed, 0)
	if err != nil {
		t.Fatalf("parse unnamed: %v", err)
	}
	if got := handlerParams(findEnclosingFunc(fs, file, 3)); len(got) != 2 {
		t.Fatalf("params = %d, want 2 unnamed parameters", len(got))
	}
}

func TestIsImportedType(t *testing.T) {
	imports := map[string]string{"http": "net/http", "other": "example.com/other"}
	tests := []struct {
		name string
		expr string
		ptr  bool
		pkg  string
		typ  string
		want bool
	}{
		{name: "pointer match", expr: "*http.Request", ptr: true, pkg: "net/http", typ: "Request", want: true},
		{name: "pointer required", expr: "http.Request", ptr: true, pkg: "net/http", typ: "Request", want: false},
		{name: "pointer rejected when value expected", expr: "*http.Request", ptr: false, pkg: "net/http", typ: "Request", want: false},
		{name: "type name mismatch", expr: "http.ResponseWriter", ptr: false, pkg: "net/http", typ: "Request", want: false},
		{name: "import path mismatch", expr: "other.Request", ptr: false, pkg: "net/http", typ: "Request", want: false},
		{name: "not a selector", expr: "http", ptr: false, pkg: "net/http", typ: "Request", want: false},
		{name: "qualified selector", expr: "pkg.Sub.Request", ptr: false, pkg: "net/http", typ: "Request", want: false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			expr, err := parser.ParseExpr(tc.expr)
			if err != nil {
				t.Fatalf("parse expr: %v", err)
			}
			if got := isImportedType(imports, expr, tc.ptr, tc.pkg, tc.typ); got != tc.want {
				t.Fatalf("isImportedType(%s) = %v, want %v", tc.expr, got, tc.want)
			}
		})
	}
}

func TestDetectHandlerFramework(t *testing.T) {
	tests := []struct {
		name       string
		source     string
		framework  string
		importPath string
	}{
		{name: "net/http", source: httpHandlerSource, framework: "net/http"},
		{name: "net/http with alias", source: `package api

import web "net/http"

func H(w web.ResponseWriter, r *web.Request) {}
`, framework: "net/http"},
		{name: "gin", source: ginHandlerSource, framework: "gin", importPath: "github.com/gin-gonic/gin"},
		{name: "echo", source: echoHandlerSource, framework: "echo", importPath: "github.com/labstack/echo/v4"},
		{name: "echo without an import alias", source: `package api

import "github.com/labstack/echo/v4"

func Get(c echo.Context) error {
	return nil
}
`, framework: "echo", importPath: "github.com/labstack/echo/v4"},
		{name: "echo without error result", source: `package api

import echo "github.com/labstack/echo/v4"

func H(c echo.Context) {}
`, framework: ""},
		{name: "unsupported", source: plainHandlerSource, framework: ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			fs := token.NewFileSet()
			file, err := parser.ParseFile(fs, "handlers.go", tc.source, 0)
			if err != nil {
				t.Fatalf("parse: %v", err)
			}
			fn := soleFuncDecl(t, file)
			framework, importPath := detectHandlerFramework(fn, handlerImportNames(file))
			if framework != tc.framework || importPath != tc.importPath {
				t.Fatalf("detect = (%q, %q), want (%q, %q)", framework, importPath, tc.framework, tc.importPath)
			}
		})
	}
}

func soleFuncDecl(t *testing.T, file *ast.File) *ast.FuncDecl {
	t.Helper()
	for _, decl := range file.Decls {
		if fn, ok := decl.(*ast.FuncDecl); ok {
			return fn
		}
	}
	t.Fatal("no function declaration")
	return nil
}

func TestSortedMapKeys(t *testing.T) {
	if got := sortedMapKeys(nil); len(got) != 0 {
		t.Fatalf("keys of nil map = %v, want empty", got)
	}
	got := sortedMapKeys(map[string]string{"b": "2", "a": "1", "c": "3"})
	if strings.Join(got, ",") != "a,b,c" {
		t.Fatalf("keys = %v, want sorted a,b,c", got)
	}
}

func TestWriteFixtureHeaders(t *testing.T) {
	var code strings.Builder
	err := writeFixtureHeaders(&code, map[string]string{
		"Accept":        "application/json",
		"Authorization": "Bearer secret",
		"X-Api-Key":     "key",
		"Cookie":        "session=1",
		"X-Trace":       "abc",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	out := code.String()
	if !strings.Contains(out, `req.Header.Set("Accept","application/json")`) || !strings.Contains(out, `req.Header.Set("X-Trace","abc")`) {
		t.Fatalf("safe headers missing from %q", out)
	}
	for _, secret := range []string{"Bearer secret", "session=1", `"key"`, "X-Api-Key"} {
		if strings.Contains(out, secret) {
			t.Fatalf("secret %q leaked into %q", secret, out)
		}
	}
	if strings.Index(out, "Accept") > strings.Index(out, "X-Trace") {
		t.Fatalf("headers not emitted in key order: %q", out)
	}

	for name, headers := range map[string]map[string]string{
		"newline in value":   {"X-Trace": "a\r\nb"},
		"unresolved value":   {"X-Trace": "{{trace}}"},
		"unresolved with {{": {"X-Trace": "prefix {{value}}"},
	} {
		t.Run(name, func(t *testing.T) {
			var builder strings.Builder
			if err := writeFixtureHeaders(&builder, headers); err == nil {
				t.Fatalf("expected error, got %q", builder.String())
			}
		})
	}
}

func TestWriteHandlerInvocation(t *testing.T) {
	tests := []struct {
		name       string
		framework  string
		expression string
		input      HandlerTestInput
		want       []string
	}{
		{
			name:       "net/http with path params",
			framework:  "net/http",
			expression: "Health",
			input:      HandlerTestInput{PathParams: map[string]string{"id": "42", "kind": "user"}},
			want: []string{
				`req.SetPathValue("id","42")`,
				`req.SetPathValue("kind","user")`,
				"(Health)(rec,req)",
				`SetPathValue("id"`,
			},
		},
		{
			name:       "gin uses route pattern",
			framework:  "gin",
			expression: "List",
			input:      HandlerTestInput{Method: "GET", Path: "/users/42", RoutePattern: "/users/{id}"},
			want: []string{
				"router := adapter.New()",
				`router.Handle("GET","/users/:id",List)`,
				"router.ServeHTTP(rec,req)",
			},
		},
		{
			name:       "gin falls back to path without query",
			framework:  "gin",
			expression: "List",
			input:      HandlerTestInput{Method: "POST", Path: "/users?page=2"},
			want:       []string{`router.Handle("POST","/users",List)`},
		},
		{
			name:       "echo with params",
			framework:  "echo",
			expression: "Get",
			input:      HandlerTestInput{RoutePattern: "/users/:id", PathParams: map[string]string{"id": "42"}},
			want: []string{
				"ctx := router.NewContext(req,rec)",
				`ctx.SetPath("/users/:id")`,
				`ctx.SetParamNames("id")`,
				`ctx.SetParamValues("42")`,
				"if err := (Get)(ctx); err != nil { router.HTTPErrorHandler(err,ctx) }",
			},
		},
		{
			name:       "echo without params",
			framework:  "echo",
			expression: "Ping",
			input:      HandlerTestInput{RoutePattern: "/ping"},
			want:       []string{`ctx.SetPath("/ping")`},
		},
		{
			name:      "unknown framework emits nothing",
			framework: "",
			input:     HandlerTestInput{PathParams: map[string]string{"id": "42"}},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var code strings.Builder
			writeHandlerInvocation(&code, tc.framework, tc.expression, tc.input)
			out := code.String()
			for _, want := range tc.want {
				if !strings.Contains(out, want) {
					t.Fatalf("missing %q in:\n%s", want, out)
				}
			}
			if tc.framework != "echo" && strings.Contains(out, "SetParamNames") {
				t.Fatalf("unexpected echo params in:\n%s", out)
			}
			if tc.framework == "" && out != "" {
				t.Fatalf("unknown framework generated %q", out)
			}
		})
	}
}

func TestHandlerCallExpression(t *testing.T) {
	fs := token.NewFileSet()
	file, err := parser.ParseFile(fs, "handlers.go", httpHandlerSource, 0)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	fn := findEnclosingFunc(fs, file, 5)
	if fn == nil {
		t.Fatal("handler not found")
	}
	expression, err := handlerCallExpression(fn, HandlerTestInput{})
	if err != nil || expression != "Health" {
		t.Fatalf("expression = %q, err = %v; want Health", expression, err)
	}
	expression, err = handlerCallExpression(fn, HandlerTestInput{HandlerExpression: "Server{}.Health"})
	if err != nil || expression != "Server{}.Health" {
		t.Fatalf("explicit expression = %q, err = %v", expression, err)
	}
	if _, err := handlerCallExpression(fn, HandlerTestInput{HandlerExpression: "not a call("}); err == nil || !strings.Contains(err.Error(), "invalid handler expression") {
		t.Fatalf("err = %v, want invalid handler expression", err)
	}

	const methodSource = `package api

import "net/http"

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {}
`
	fs = token.NewFileSet()
	file, err = parser.ParseFile(fs, "server.go", methodSource, 0)
	if err != nil {
		t.Fatalf("parse method: %v", err)
	}
	method := findEnclosingFunc(fs, file, 5)
	if method == nil || method.Recv == nil {
		t.Fatal("method handler not found")
	}
	if _, err := handlerCallExpression(method, HandlerTestInput{}); err == nil || !strings.Contains(err.Error(), "provide a handler expression") {
		t.Fatalf("err = %v, want receiver guidance", err)
	}
	if _, err := handlerCallExpression(method, HandlerTestInput{HandlerExpression: "NewServer().ServeHTTP"}); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestGenerateHandlerTestNetHTTP(t *testing.T) {
	expectedBody := `{"status":"ok"}`
	preview, err := GenerateHandlerTest("api/handlers.go", httpHandlerSource, HandlerTestInput{
		Line:           5,
		Method:         "GET",
		Path:           "/users/42",
		Body:           `{"name":"ada"}`,
		Headers:        map[string]string{"Accept": "application/json", "Authorization": "Bearer secret"},
		PathParams:     map[string]string{"id": "42"},
		ExpectedStatus: 200,
		ExpectedBody:   &expectedBody,
		Setup:          "srv := NewServer()",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if preview.Handler != "Health" || preview.Framework != "net/http" {
		t.Fatalf("preview = %+v", preview)
	}
	if preview.RelativePath != "api/adomnia_health_test.go" {
		t.Fatalf("relative path = %q", preview.RelativePath)
	}
	for _, want := range []string{
		"package api",
		"srv := NewServer()",
		`httptest.NewRequest("GET", "/users/42", strings.NewReader("{\"name\":\"ada\"}"))`,
		`req.Header.Set("Accept", "application/json")`,
		`req.SetPathValue("id", "42")`,
		"(Health)(rec, req)",
		"if rec.Code != 200",
		`\"status\":\"ok\"`,
	} {
		if !strings.Contains(preview.Content, want) {
			t.Fatalf("missing %q in:\n%s", want, preview.Content)
		}
	}
	if strings.Contains(preview.Content, "Bearer secret") {
		t.Fatalf("secret header leaked into generated test:\n%s", preview.Content)
	}
}

func TestGenerateHandlerTestFrameworks(t *testing.T) {
	tests := []struct {
		name      string
		filename  string
		source    string
		input     HandlerTestInput
		want      []string
		relative  string
		framework string
	}{
		{
			name:      "gin",
			filename:  `api\handlers.go`,
			source:    ginHandlerSource,
			input:     HandlerTestInput{Line: 5, Method: "GET", Path: "/users/42", RoutePattern: "/users/{id}", ExpectedStatus: 200, HandlerExpression: "List"},
			relative:  "api/adomnia_list_test.go",
			framework: "gin",
			want: []string{
				`adapter "github.com/gin-gonic/gin"`,
				`router.Handle("GET", "/users/:id", List)`,
			},
		},
		{
			name:      "echo",
			filename:  "api/handlers.go",
			source:    echoHandlerSource,
			input:     HandlerTestInput{Line: 5, Method: "GET", Path: "/users/42", RoutePattern: "/users/:id", PathParams: map[string]string{"id": "42"}, ExpectedStatus: 204, HandlerExpression: "Get"},
			relative:  "api/adomnia_get_test.go",
			framework: "echo",
			want: []string{
				`adapter "github.com/labstack/echo/v4"`,
				`ctx.SetParamValues("42")`,
				"if err := (Get)(ctx); err != nil",
			},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			preview, err := GenerateHandlerTest(tc.filename, tc.source, tc.input)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if preview.Framework != tc.framework || preview.RelativePath != tc.relative {
				t.Fatalf("preview = %+v", preview)
			}
			for _, want := range tc.want {
				if !strings.Contains(preview.Content, want) {
					t.Fatalf("missing %q in:\n%s", want, preview.Content)
				}
			}
		})
	}
}

func TestGenerateHandlerTestErrors(t *testing.T) {
	valid := HandlerTestInput{Line: 5, Method: "GET", Path: "/health", ExpectedStatus: 200}
	tests := []struct {
		name     string
		filename string
		source   string
		input    HandlerTestInput
		want     string
	}{
		{name: "validation", filename: "api/handlers.go", source: httpHandlerSource, input: withStatus(valid, 42), want: "expected HTTP status"},
		{name: "unparsable source", filename: "api/handlers.go", source: "package api\nfunc {", input: valid, want: "expected"},
		{name: "route registration line", filename: "api/handlers.go", source: httpHandlerSource, input: withLine(valid, 1), want: "select a handler declaration"},
		{name: "generic handler", filename: "api/handlers.go", source: genericHandlerSource, input: valid, want: "generic handlers require a concrete test adapter"},
		{name: "unsupported signature", filename: "api/handlers.go", source: plainHandlerSource, input: withLine(valid, 3), want: "supported handler signatures"},
		{name: "invalid handler expression", filename: "api/handlers.go", source: httpHandlerSource, input: withExpression(valid, "bad("), want: "invalid handler expression"},
		{name: "invalid header", filename: "api/handlers.go", source: httpHandlerSource, input: withHeaders(valid, map[string]string{"X-Trace": "{{trace}}"}), want: "invalid or unresolved header"},
		{name: "invalid setup", filename: "api/handlers.go", source: httpHandlerSource, input: withSetup(valid, "func("), want: "invalid test setup"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			preview, err := GenerateHandlerTest(tc.filename, tc.source, tc.input)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("err = %v, want substring %q", err, tc.want)
			}
			if preview != (HandlerTestPreview{}) {
				t.Fatalf("preview = %+v, want zero value", preview)
			}
		})
	}
}

func withLine(in HandlerTestInput, line int) HandlerTestInput {
	in.Line = line
	return in
}

func withExpression(in HandlerTestInput, expression string) HandlerTestInput {
	in.HandlerExpression = expression
	return in
}

func withHeaders(in HandlerTestInput, headers map[string]string) HandlerTestInput {
	in.Headers = headers
	return in
}

func withSetup(in HandlerTestInput, setup string) HandlerTestInput {
	in.Setup = setup
	return in
}
