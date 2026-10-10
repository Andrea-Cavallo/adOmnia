package devcontext

import "testing"

func TestRoutesLinkToHandlerDeclarations(t *testing.T) {
	router := []byte(`package api

import "github.com/gin-gonic/gin"

func Routes(r *gin.Engine, h *UserHandler) {
	r.PUT("/users/:id", h.UpdateUser)
	r.GET("/health", Health)
}
`)
	handlers := []byte(`package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

type UserHandler struct{}

func (h *UserHandler) UpdateUser(c *gin.Context) {}

func Health(w http.ResponseWriter, r *http.Request) {}

func helper(x int) {}
`)
	a, _ := detectGoFile("internal/api/routes.go", router, AdapterHints{})
	b, _ := detectGoFile("internal/api/user_handler.go", handlers, AdapterHints{})
	entities := linkHandlers(merge(a, b))
	found := map[string]Entity{}
	for _, e := range entities {
		if e.Kind == handlerDeclKind {
			t.Fatalf("internal handler entities must not reach the snapshot: %+v", e)
		}
		if e.Kind == "route" {
			found[e.Attrs["method"]+" "+e.Attrs["path"]] = e
		}
	}
	update := found["PUT /users/{id}"]
	if update.Attrs["declName"] != "UserHandler.UpdateUser" || update.Attrs["declFile"] != "internal/api/user_handler.go" || update.Attrs["declLine"] != "11" {
		t.Fatalf("PUT route not linked: %+v", update.Attrs)
	}
	if health := found["GET /health"]; health.Attrs["declLine"] != "13" {
		t.Fatalf("GET route not linked: %+v", health.Attrs)
	}
}
