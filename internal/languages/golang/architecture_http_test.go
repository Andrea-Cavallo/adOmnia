package golang

import (
	"context"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/tools/go/packages"
)

var httpFixture = map[string]string{
	"go.mod":                 "module example.com/api\n\ngo 1.22\n\nrequire github.com/gin-gonic/gin v0.0.0\n\nreplace github.com/gin-gonic/gin => ./third_party/gin\n",
	"third_party/gin/go.mod": "module github.com/gin-gonic/gin\n\ngo 1.22\n",
	"third_party/gin/gin.go": `package gin

type Context struct{}

func (c *Context) ShouldBindJSON(v any) error { return nil }
func (c *Context) JSON(code int, v any)        {}

type HandlerFunc func(*Context)

type RouterGroup struct{}

func (g *RouterGroup) Group(path string, h ...HandlerFunc) *RouterGroup { return g }
func (g *RouterGroup) Use(h ...HandlerFunc)                             {}
func (g *RouterGroup) GET(path string, h ...HandlerFunc)                {}
func (g *RouterGroup) POST(path string, h ...HandlerFunc)               {}

type Engine struct{ RouterGroup }

func New() *Engine { return &Engine{} }
`,
	"api/api.go": `package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

type Address struct {
	City string ` + "`json:\"city\"`" + `
}

type CreateOrder struct {
	Item     string    ` + "`json:\"item\"`" + `
	Quantity int       ` + "`json:\"quantity,omitempty\"`" + `
	Tags     []string  ` + "`json:\"tags\"`" + `
	Ship     *Address  ` + "`json:\"ship\"`" + `
	At       time.Time ` + "`json:\"at\"`" + `
	secret   string
	Skip     string ` + "`json:\"-\"`" + `
}

type Order struct {
	ID int64 ` + "`json:\"id\"`" + `
}

func Auth() gin.HandlerFunc    { return func(c *gin.Context) {} }
func Logging() gin.HandlerFunc { return func(c *gin.Context) {} }

type Handlers struct{}

func (h *Handlers) Create(c *gin.Context) {
	var body CreateOrder
	if err := c.ShouldBindJSON(&body); err != nil {
		return
	}
	c.JSON(201, Order{ID: 1})
}

func (h *Handlers) List() gin.HandlerFunc {
	return func(c *gin.Context) { c.JSON(200, []Order{}) }
}

func Routes(r *gin.Engine, h *Handlers) {
	r.Use(Logging())
	api := r.Group("/api")
	v1 := api.Group("/v1")
	v1.POST("/orders", Auth(), h.Create)
	v1.GET("/orders", h.List())
}

func withTrace(next http.Handler) http.Handler { return next }

func health(w http.ResponseWriter, r *http.Request) {
	var probe Address
	_ = json.NewDecoder(r.Body).Decode(&probe)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func Std(mux *http.ServeMux) {
	mux.Handle("POST /health", withTrace(http.HandlerFunc(health)))
}
`,
}

func TestArchitectureHTTPRoutes(t *testing.T) {
	root := t.TempDir()
	for name, content := range httpFixture {
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	fset := token.NewFileSet()
	config := &packages.Config{Context: context.Background(), Dir: root, Tests: true, Fset: fset, Env: append(os.Environ(), "GOFLAGS=-mod=mod", "GOPROXY=off"),
		Mode: packages.NeedName | packages.NeedFiles | packages.NeedCompiledGoFiles | packages.NeedSyntax | packages.NeedTypes | packages.NeedTypesInfo | packages.NeedImports | packages.NeedModule}
	loaded, err := packages.Load(config, "./...")
	if err != nil {
		t.Skipf("go/packages unavailable: %v", err)
	}
	for _, pkg := range loaded {
		if len(pkg.Errors) > 0 {
			t.Fatalf("fixture does not compile: %v", pkg.Errors)
		}
	}
	read := func(path string) ([]byte, error) {
		if !strings.HasPrefix(filepath.Clean(path), filepath.Join(root, "api")) {
			return nil, os.ErrNotExist
		}
		return os.ReadFile(path)
	}
	report := AnalyzeArchitecture(fset, loaded, read)
	routes := map[string]ArchEntry{}
	middleware := []string{}
	for _, entry := range report.Entries {
		switch entry.Kind {
		case "http":
			routes[entry.Name] = entry
		case "middleware":
			middleware = append(middleware, entry.Name)
		}
	}
	create, ok := routes["POST /api/v1/orders"]
	if !ok {
		t.Fatalf("routes: %v", routes)
	}
	if create.Handler != "Handlers.Create" || create.HandlerSite == nil || strings.Join(create.Middleware, ",") != "Logging,Auth" || create.Detail != "gin" {
		t.Fatalf("create: %+v", create)
	}
	if create.Request == nil || create.Request.Ref != "CreateOrder" || create.Response == nil || create.Response.Ref != "Order" || create.Response.Array {
		t.Fatalf("create bodies: %+v %+v", create.Request, create.Response)
	}
	list := routes["GET /api/v1/orders"]
	if list.Handler != "Handlers.List" || list.Response == nil || !list.Response.Array || list.Response.Ref != "Order" {
		t.Fatalf("list: %+v %+v", list, list.Response)
	}
	health := routes["POST /health"]
	if health.Handler != "health" || strings.Join(health.Middleware, ",") != "withTrace" || health.Request == nil || health.Request.Ref != "Address" || health.Response == nil || health.Response.Type != "map[string]string" {
		t.Fatalf("health: %+v req %+v res %+v", health, health.Request, health.Response)
	}
	if strings.Join(middleware, ",") != "Logging" {
		t.Fatalf("middleware entries: %v", middleware)
	}
	schemas := map[string]ArchSchema{}
	for _, schema := range report.Schemas {
		schemas[schema.Name] = schema
	}
	order := schemas["CreateOrder"]
	got := []string{}
	for _, field := range order.Fields {
		label := field.Name + ":" + field.Type
		if field.Format != "" {
			label += "/" + field.Format
		}
		if field.Ref != "" {
			label += "->" + field.Ref
		}
		if field.Items != "" {
			label += "[" + field.Items + "]"
		}
		if field.Required {
			label += "!"
		}
		got = append(got, label)
	}
	if strings.Join(got, " ") != "item:string! quantity:integer tags:array[string]! ship:object->Address at:string/date-time!" {
		t.Fatalf("CreateOrder fields: %s", strings.Join(got, " "))
	}
	if _, ok := schemas["Address"]; !ok || len(schemas) != 3 {
		t.Fatalf("schemas: %v", schemas)
	}
}
