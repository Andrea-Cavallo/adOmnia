package devcontext

import (
	"strings"
	"testing"
)

func TestGoHandlerRequestShapeAndBodyExample(t *testing.T) {
	router := []byte(`package api

import "github.com/gin-gonic/gin"

func Register(r *gin.Engine, h *UserHandler) {
	r.POST("/users/:id", h.CreateUser)
}
`)
	handler := []byte(`package api

import "github.com/gin-gonic/gin"

type UserHandler struct{}

func (h *UserHandler) CreateUser(c *gin.Context) {
	id := c.Param("id")
	query := c.Query("q")
	limit := c.DefaultQuery("limit", "10")
	token := c.GetHeader("X-Token")
	var body CreateUserRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		return
	}
	_, _, _, _ = id, query, limit, token
}
`)
	body := []byte(`package api

type CreateUserRequest struct {
	Name   string            ` + "`json:\"name\"`" + `
	Age    int               ` + "`json:\"age\"`" + `
	Active bool              ` + "`json:\"active\"`" + `
	Tags   []string          ` + "`json:\"tags,omitempty\"`" + `
	Meta   map[string]string ` + "`json:\"meta\"`" + `
	Secret string            ` + "`json:\"-\"`" + `
}
`)
	a, _ := detectGoFile("internal/api/routes.go", router, AdapterHints{})
	b, _ := detectGoFile("internal/api/user_handler.go", handler, AdapterHints{})
	d, _ := detectGoFile("internal/api/dto.go", body, AdapterHints{})
	entities := linkHandlers(merge(a, b, d))
	var route Entity
	for _, entity := range entities {
		if entity.Kind == bodyDeclKind || entity.Kind == handlerDeclKind {
			t.Fatalf("internal entities must not reach the snapshot: %+v", entity)
		}
		if entity.ID == "route:POST /users/{id}" {
			route = entity
		}
	}
	if route.Attrs["declName"] != "UserHandler.CreateUser" {
		t.Fatalf("route not linked: %+v", route.Attrs)
	}
	params := route.Attrs["requestParams"]
	for _, want := range []string{`"name":"id"`, `"in":"path"`, `"name":"q"`, `"name":"limit"`, `"default":"10"`, `"name":"X-Token"`, `"in":"header"`} {
		if !strings.Contains(params, want) {
			t.Errorf("requestParams missing %s: %s", want, params)
		}
	}
	if route.Attrs["requestContentType"] != "application/json" {
		t.Fatalf("content type: %+v", route.Attrs)
	}
	wantBody := `{"name":"","age":0,"active":false,"tags":[],"meta":{}}`
	if route.Attrs["requestBody"] != wantBody {
		t.Fatalf("requestBody = %s, want %s", route.Attrs["requestBody"], wantBody)
	}
}

func TestGoSliceBodyIsWrapped(t *testing.T) {
	source := []byte(`package api

import "github.com/gin-gonic/gin"

type Item struct {
	ID string ` + "`json:\"id\"`" + `
}

func bulk(c *gin.Context) {
	var items []Item
	if err := c.BindJSON(&items); err != nil { return }
	_ = items
}

func Register(r *gin.Engine) {
	r.POST("/items/bulk", bulk)
}
`)
	out, _ := detectGoFile("internal/api/bulk.go", source, AdapterHints{})
	entities := linkHandlers(merge(out))
	for _, entity := range entities {
		if entity.ID != "route:POST /items/bulk" {
			continue
		}
		if entity.Attrs["requestBody"] != `[{"id":""}]` {
			t.Fatalf("array body = %s", entity.Attrs["requestBody"])
		}
		return
	}
	t.Fatal("bulk route not found")
}

func TestGoNestedDTOsAreInlined(t *testing.T) {
	source := []byte(`package api

import "github.com/gin-gonic/gin"

type Address struct {
	City string ` + "`json:\"city\"`" + `
}

type User struct {
	Name    string   ` + "`json:\"name\"`" + `
	Address Address  ` + "`json:\"address\"`" + `
	Home    *Address ` + "`json:\"home\"`" + `
}

func create(c *gin.Context) {
	var user User
	_ = c.ShouldBindJSON(&user)
}

func Register(r *gin.Engine) {
	r.POST("/users", create)
}
`)
	out, _ := detectGoFile("internal/api/users.go", source, AdapterHints{})
	for _, entity := range linkHandlers(merge(out)) {
		if entity.ID != "route:POST /users" {
			continue
		}
		want := `{"name":"","address":{"city":""},"home":{"city":""}}`
		if entity.Attrs["requestBody"] != want {
			t.Fatalf("nested body = %s", entity.Attrs["requestBody"])
		}
		return
	}
	t.Fatal("users route not found")
}

func TestGoHandlerWrappersAndClosures(t *testing.T) {
	source := []byte(`package api

import "net/http"

func wrapped(w http.ResponseWriter, r *http.Request) {}

func Register(mux *http.ServeMux) {
	mux.Handle("GET /wrapped", http.HandlerFunc(wrapped))
	mux.HandleFunc("GET /closure", func(w http.ResponseWriter, r *http.Request) {})
}
`)
	out, _ := detectGoFile("internal/api/routes.go", source, AdapterHints{})
	for _, entity := range linkHandlers(merge(out)) {
		switch entity.ID {
		case "route:GET /wrapped":
			if entity.Attrs["declName"] != "wrapped" {
				t.Fatalf("wrapped handler: %+v", entity.Attrs)
			}
		case "route:GET /closure":
			if entity.Attrs["declName"] != "(closure)" || entity.Attrs["declLine"] == "" {
				t.Fatalf("closure handler: %+v", entity.Attrs)
			}
		}
	}
}
