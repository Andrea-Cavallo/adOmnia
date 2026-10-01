package devsession

import (
	"testing"
)

func TestBuildRuntimeEnrichment(t *testing.T) {
	runs := []RequestRun{
		{ID: "r1", Method: "GET", URL: "http://localhost:8080/users?active=1", Status: 200, DurationMs: 20, Hits: []Hit{{Frame: Frame{Function: "example.com/app/handler.List", RelativePath: "internal/handler/users.go"}}}},
		{ID: "r2", Method: "GET", URL: "http://localhost:8080/users?active=1", Status: 200, DurationMs: 40, Hits: []Hit{{Frame: Frame{Function: "example.com/app/handler.List", RelativePath: "internal/handler/users.go"}}}},
		{ID: "r3", Method: "POST", URL: "http://localhost:8080/users", Status: 500, DurationMs: 60, Error: "boom"},
	}
	queries := []Query{
		{RequestRunID: "r1", Datasource: "postgres"},
	}
	messages := []Message{
		{RequestRunID: "r3", Broker: "kafka", Topic: "user.created"},
	}

	enrichment := buildRuntimeEnrichment("go-1", "users-service", runs, queries, messages)

	if enrichment.Service != "users-service" || enrichment.GoSessionID != "go-1" {
		t.Fatalf("identità inattesa: %+v", enrichment)
	}
	if enrichment.TotalRequests != 3 || enrichment.TotalErrors != 1 {
		t.Fatalf("totali inattesi: requests=%d errors=%d", enrichment.TotalRequests, enrichment.TotalErrors)
	}

	byKey := map[string]RuntimeComponent{}
	for _, component := range enrichment.Components {
		byKey[component.Key+"|"+component.Kind] = component
	}
	route := byKey["GET /users|route"]
	if route.Calls != 2 || route.AvgMs != 30 || route.MaxMs != 40 {
		t.Fatalf("route GET /users inattesa: %+v", route)
	}
	if route := byKey["POST /users|route"]; route.Calls != 1 || route.Errors != 1 {
		t.Fatalf("route POST /users inattesa: %+v", route)
	}
	if _, ok := byKey["internal/handler/users.go|file"]; !ok {
		t.Fatal("file colpito non rilevato")
	}
	if _, ok := byKey["postgres|datasource"]; !ok {
		t.Fatal("datasource non rilevato")
	}
	if _, ok := byKey["kafka/user.created|topic"]; !ok {
		t.Fatal("topic non rilevato")
	}

	kinds := map[string]bool{}
	for _, edge := range enrichment.Edges {
		kinds[edge.Kind] = true
	}
	for _, want := range []string{"hit", "query", "message"} {
		if !kinds[want] {
			t.Fatalf("edge dinamico %q mancante: %+v", want, enrichment.Edges)
		}
	}
	if len(enrichment.UsedFunctions) == 0 {
		t.Fatal("funzioni usate non raccolte")
	}
}

func TestMarkUnusedModules(t *testing.T) {
	enrichment := RuntimeEnrichment{UsedFunctions: []string{"github.com/used/lib.Fn", "example.com/app/handler.List"}}
	MarkUnusedModules(&enrichment, []string{"github.com/used/lib", "github.com/never/used", "example.com/app"})

	if len(enrichment.UnusedModules) != 1 || enrichment.UnusedModules[0] != "github.com/never/used" {
		t.Fatalf("moduli inutilizzati inattesi: %v", enrichment.UnusedModules)
	}
}

func TestRouteKey(t *testing.T) {
	if got := routeKey("get", "http://localhost:8080/users/123?active=1"); got != "GET /users/123" {
		t.Fatalf("routeKey = %q", got)
	}
	if got := routeKey("post", "not a url"); got != "POST not a url" {
		t.Fatalf("routeKey = %q", got)
	}
}

func TestManagerRuntimeEnrichmentScopesToProject(t *testing.T) {
	manager, _ := testManager(Hooks{})
	manager.RunStarted("go-1", "run-1", "run", "app", 1)
	manager.RunStarted("go-2", "run-2", "run", "other", 2)
	if err := manager.SetPort("run:run-1", 8080); err != nil {
		t.Fatal(err)
	}
	if err := manager.SetPort("run:run-2", 8081); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Begin(BeginRequest{SessionID: "run:run-1", Method: "GET", URL: "http://localhost:8080/ping"}); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Begin(BeginRequest{SessionID: "run:run-2", Method: "GET", URL: "http://localhost:8081/ping"}); err != nil {
		t.Fatal(err)
	}

	enrichment := manager.RuntimeEnrichment("go-1")
	if enrichment.TotalRequests != 1 {
		t.Fatalf("richieste di go-1 attese 1, ottenute %d", enrichment.TotalRequests)
	}
	if len(enrichment.Components) == 0 {
		t.Fatal("nessun componente per go-1")
	}
	for _, component := range enrichment.Components {
		if component.Kind == "route" && component.Key != "GET /ping" {
			t.Fatalf("route estranea a go-1: %s", component.Key)
		}
	}
}
