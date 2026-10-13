package golang

import (
	"fmt"
	"go/ast"
	"go/format"
	"go/parser"
	"go/token"
	"net/url"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

type HandlerTestInput struct {
	Line              int               `json:"line"`
	Method            string            `json:"method"`
	Path              string            `json:"path"`
	RoutePattern      string            `json:"routePattern"`
	Body              string            `json:"body"`
	Headers           map[string]string `json:"headers"`
	PathParams        map[string]string `json:"pathParams"`
	ExpectedStatus    int               `json:"expectedStatus"`
	ExpectedBody      *string           `json:"expectedBody"`
	HandlerExpression string            `json:"handlerExpression"`
	Setup             string            `json:"setup"`
}
type HandlerTestPreview struct {
	RelativePath string `json:"relativePath"`
	Content      string `json:"content"`
	Handler      string `json:"handler"`
	Framework    string `json:"framework"`
}

// GenerateHandlerTest renders an in-process test of the declared handler; never executes source.
func GenerateHandlerTest(filename, source string, input HandlerTestInput) (HandlerTestPreview, error) {
	if len(source) > 2<<20 || len(input.Body) > 1<<20 || len(input.Setup) > 64<<10 {
		return HandlerTestPreview{}, fmt.Errorf("handler or fixture exceeds generation limits")
	}
	if input.ExpectedStatus < 100 || input.ExpectedStatus > 599 {
		return HandlerTestPreview{}, fmt.Errorf("choose an expected HTTP status from 100 to 599")
	}
	if !regexp.MustCompile(`^[A-Z]+$`).MatchString(input.Method) {
		return HandlerTestPreview{}, fmt.Errorf("invalid HTTP method")
	}
	if !strings.HasPrefix(input.Path, "/") || strings.ContainsAny(input.Path, "\r\n") {
		return HandlerTestPreview{}, fmt.Errorf("fixture path must be a local HTTP path")
	}
	if _, err := url.ParseRequestURI(input.Path); err != nil {
		return HandlerTestPreview{}, fmt.Errorf("invalid fixture path: %w", err)
	}
	for _, value := range []string{input.Path, input.Body} {
		if strings.Contains(value, "{{") || strings.Contains(value, "<redacted>") {
			return HandlerTestPreview{}, fmt.Errorf("replace unresolved variables and redacted values with safe test fixtures")
		}
	}
	fs := token.NewFileSet()
	file, err := parser.ParseFile(fs, filename, source, 0)
	if err != nil {
		return HandlerTestPreview{}, err
	}
	var handler *ast.FuncDecl
	for _, decl := range file.Decls {
		if fn, ok := decl.(*ast.FuncDecl); ok && fn.Body != nil && fs.Position(fn.Pos()).Line <= input.Line && input.Line <= fs.Position(fn.End()).Line {
			handler = fn
			break
		}
	}
	if handler == nil {
		return HandlerTestPreview{}, fmt.Errorf("select a handler declaration, not its route registration")
	}
	if handler.Type.TypeParams != nil {
		return HandlerTestPreview{}, fmt.Errorf("generic handlers require a concrete test adapter")
	}
	imports := map[string]string{}
	for _, spec := range file.Imports {
		value, _ := strconv.Unquote(spec.Path.Value)
		name := path.Base(value)
		if spec.Name != nil {
			name = spec.Name.Name
		}
		imports[name] = value
	}
	var params []ast.Expr
	for _, field := range handler.Type.Params.List {
		count := len(field.Names)
		if count == 0 {
			count = 1
		}
		for i := 0; i < count; i++ {
			params = append(params, field.Type)
		}
	}
	typ := func(expr ast.Expr, ptr bool, pkg, name string) bool {
		if ptr {
			star, ok := expr.(*ast.StarExpr)
			if !ok {
				return false
			}
			expr = star.X
		}
		sel, ok := expr.(*ast.SelectorExpr)
		if !ok || sel.Sel.Name != name {
			return false
		}
		id, ok := sel.X.(*ast.Ident)
		return ok && imports[id.Name] == pkg
	}
	noResults := handler.Type.Results == nil || len(handler.Type.Results.List) == 0
	framework := ""
	frameworkImport := ""
	if len(params) == 2 && noResults && typ(params[0], false, "net/http", "ResponseWriter") && typ(params[1], true, "net/http", "Request") {
		framework = "net/http"
	}
	if len(params) == 1 && noResults && typ(params[0], true, "github.com/gin-gonic/gin", "Context") {
		framework = "gin"
		frameworkImport = "github.com/gin-gonic/gin"
	}
	if len(params) == 1 && typ(params[0], false, "github.com/labstack/echo/v4", "Context") && handler.Type.Results != nil && len(handler.Type.Results.List) == 1 {
		if id, ok := handler.Type.Results.List[0].Type.(*ast.Ident); ok && id.Name == "error" {
			framework = "echo"
			frameworkImport = "github.com/labstack/echo/v4"
		}
	}
	if framework == "" {
		return HandlerTestPreview{}, fmt.Errorf("supported handler signatures: net/http, Gin Context or Echo v4 Context; this declaration requires a test adapter")
	}
	expression := input.HandlerExpression
	if expression == "" {
		if handler.Recv != nil {
			return HandlerTestPreview{}, fmt.Errorf("provide a handler expression for this receiver, such as NewServer().ServeHTTP")
		}
		expression = handler.Name.Name
	}
	if _, err := parser.ParseExpr(expression); err != nil {
		return HandlerTestPreview{}, fmt.Errorf("invalid handler expression: %w", err)
	}
	var code strings.Builder
	fmt.Fprintf(&code, "// Generated by adOmnia. Arrange dependencies in this test; no external server is used.\npackage %s\n\nimport (\n\"testing\"\n\"net/http/httptest\"\n\"strings\"\n", file.Name.Name)
	if frameworkImport != "" {
		fmt.Fprintf(&code, "adapter %q\n", frameworkImport)
	}
	fmt.Fprintf(&code, ")\n\nfunc TestAdOmnia_%s(t *testing.T) {\n%s\n req := httptest.NewRequest(%q,%q,strings.NewReader(%q))\n rec := httptest.NewRecorder()\n", handler.Name.Name, input.Setup, input.Method, input.Path, input.Body)
	keys := make([]string, 0, len(input.Headers))
	for key := range input.Headers {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	secret := regexp.MustCompile(`(?i)^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token)$`)
	for _, key := range keys {
		value := input.Headers[key]
		if secret.MatchString(key) {
			continue
		}
		if strings.ContainsAny(key+value, "\r\n") || strings.Contains(value, "{{") {
			return HandlerTestPreview{}, fmt.Errorf("invalid or unresolved header")
		}
		fmt.Fprintf(&code, "req.Header.Set(%q,%q)\n", key, value)
	}
	switch framework {
	case "net/http":
		keys = nil
		for key := range input.PathParams {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			fmt.Fprintf(&code, "req.SetPathValue(%q,%q)\n", key, input.PathParams[key])
		}
		fmt.Fprintf(&code, "(%s)(rec,req)\n", expression)
	case "gin":
		pattern := input.RoutePattern
		if pattern == "" {
			pattern = strings.Split(input.Path, "?")[0]
		}
		pattern = regexp.MustCompile(`\{([^}]+)\}`).ReplaceAllString(pattern, ":$1")
		fmt.Fprintf(&code, "router := adapter.New()\nrouter.Handle(%q,%q,%s)\nrouter.ServeHTTP(rec,req)\n", input.Method, pattern, expression)
	case "echo":
		fmt.Fprintf(&code, "router := adapter.New()\nctx := router.NewContext(req,rec)\nctx.SetPath(%q)\n", input.RoutePattern)
		keys = nil
		for key := range input.PathParams {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		if len(keys) > 0 {
			var names, values []string
			for _, key := range keys {
				names = append(names, strconv.Quote(key))
				values = append(values, strconv.Quote(input.PathParams[key]))
			}
			fmt.Fprintf(&code, "ctx.SetParamNames(%s)\nctx.SetParamValues(%s)\n", strings.Join(names, ","), strings.Join(values, ","))
		}
		fmt.Fprintf(&code, "if err := (%s)(ctx); err != nil { router.HTTPErrorHandler(err,ctx) }\n", expression)
	}
	fmt.Fprintf(&code, "if rec.Code != %d { t.Fatalf(\"status = %%d, want %d; body = %%s\",rec.Code,rec.Body.String()) }\n", input.ExpectedStatus, input.ExpectedStatus)
	if input.ExpectedBody != nil {
		fmt.Fprintf(&code, "if got := rec.Body.String(); got != %q {t.Fatalf(\"body = %%q, want %%q\",got,%q)}\n", *input.ExpectedBody, *input.ExpectedBody)
	}
	code.WriteString("}\n")
	formatted, err := format.Source([]byte(code.String()))
	if err != nil {
		return HandlerTestPreview{}, fmt.Errorf("invalid test setup: %w", err)
	}
	return HandlerTestPreview{RelativePath: path.Join(path.Dir(strings.ReplaceAll(filename, "\\", "/")), "adomnia_"+strings.ToLower(handler.Name.Name)+"_test.go"), Content: string(formatted), Handler: handler.Name.Name, Framework: framework}, nil
}
