package devcontext

import (
	"go/parser"
	"go/token"
	"testing"
)

func routesOf(t *testing.T, src string) map[string]Entity {
	t.Helper()
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "api/routes.go", src, parser.SkipObjectResolution)
	if err != nil {
		t.Fatal(err)
	}
	return byID(detectRoutes("api/routes.go", fset, file))
}

func TestDetectRoutesStdlibAndGorilla(t *testing.T) {
	got := routesOf(t, `package api
func register(mux *http.ServeMux, r *mux.Router) {
	mux.HandleFunc("POST /payments", h.createPayment)
	mux.Handle("/health", healthHandler)
	mux.HandleFunc("GET example.com/skip", skip)
	r.HandleFunc("/orders/{id:[0-9]+}", getOrder).Methods("GET", "DELETE")
	api := r.PathPrefix("/v2").Subrouter()
	api.HandleFunc("/refunds", listRefunds).Methods("GET")
}`)
	post := got["route:POST /payments"]
	if post.Attrs["handler"] != "h.createPayment" || post.Attrs["handlerLine"] != "3" || post.Confidence != ConfidenceInferred {
		t.Fatalf("stdlib route: %+v", post)
	}
	for _, id := range []string{"route:ANY /health", "route:GET /orders/{id}", "route:DELETE /orders/{id}", "route:GET /v2/refunds"} {
		if _, ok := got[id]; !ok {
			t.Errorf("missing %s in %v", id, keys(got))
		}
	}
	if _, ok := got["route:ANY /orders/{id}"]; ok {
		t.Error("a HandleFunc wrapped in .Methods must not also be emitted as ANY")
	}
	if len(got) != 5 {
		t.Errorf("host patterns must be skipped; got %v", keys(got))
	}
}

func TestDetectRoutesGinEchoChiWithPrefixes(t *testing.T) {
	got := routesOf(t, `package api
func gin(r *gin.Engine) {
	v1 := r.Group("/api/v1")
	v1.GET("/users/:id", getUser)
	admin := v1.Group(prefix)
	admin.DELETE("/users/:id", deleteUser)
}
func chi(r chi.Router) {
	r.Route("/accounts", func(r chi.Router) {
		r.Get("/", listAccounts)
		r.Post("/{id}/close", closeAccount)
	})
	r.Method("PATCH", "/limits", patchLimits)
}
func fresh(r chi.Router) {
	v1.GET("/not-prefixed", x)
}`)
	for _, id := range []string{"route:GET /api/v1/users/{id}", "route:GET /accounts", "route:POST /accounts/{id}/close", "route:PATCH /limits", "route:GET /not-prefixed"} {
		if _, ok := got[id]; !ok {
			t.Errorf("missing %s in %v", id, keys(got))
		}
	}
	del := got["route:DELETE /users/{id}"]
	if del.Attrs["partialPrefix"] != "true" {
		t.Fatalf("non-literal group prefix must set partialPrefix: %+v", del)
	}
}

func keys(m map[string]Entity) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
