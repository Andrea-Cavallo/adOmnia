package rust

import "testing"

func TestNestPrefixOnlyAppliesToFollowingRoutes(t *testing.T) {
	src := `let app = Router::new().route("/health", get(h)).nest("/api", Router::new().route("/users", get(u)));`
	got := map[string]bool{}
	for _, e := range EndpointsInFile("main.rs", []byte(src)) {
		got[e.Method+" "+e.Path] = true
	}
	if !got["GET /health"] || !got["GET /api/users"] || got["GET /api/health"] {
		t.Fatalf("unexpected endpoints: %v", got)
	}
}

func TestQualifiedAttributeRoute(t *testing.T) {
	src := "#[actix_web::get(\"/ping\")]\nasync fn ping() {}\n"
	eps := EndpointsInFile("main.rs", []byte(src))
	if len(eps) != 1 || eps[0].Method != "GET" || eps[0].Path != "/ping" || eps[0].Handler != "ping" {
		t.Fatalf("unexpected endpoints: %+v", eps)
	}
}

func endpointSet(src string) map[string]bool {
	got := map[string]bool{}
	for _, e := range EndpointsInFile("main.rs", []byte(src)) {
		got[e.Method+" "+e.Path] = true
	}
	return got
}

// Il prefisso di .nest vale per l'argomento del nest, non per ciò che segue: la route scritta dopo
// appartiene al router esterno (prima veniva inventato GET /api/health).
func TestAxumNestPrefixDoesNotLeakForward(t *testing.T) {
	got := endpointSet(`let app = Router::new().nest("/api", Router::new().route("/users", get(u))).route("/health", get(h));`)
	if !got["GET /api/users"] || !got["GET /health"] || got["GET /api/health"] || got["GET /users"] {
		t.Fatalf("unexpected endpoints: %v", got)
	}
}

func TestAxumNestedAndSiblingNestsCompose(t *testing.T) {
	got := endpointSet(`let app = Router::new()
    .nest("/v1", Router::new().nest("/admin", Router::new().route("/stats", get(s))).route("/ping", get(p)))
    .nest("/v2", Router::new().route("/ping", get(p2)))
    .route("/", get(root));`)
	for _, want := range []string{"GET /v1/admin/stats", "GET /v1/ping", "GET /v2/ping", "GET /"} {
		if !got[want] {
			t.Errorf("missing %s in %v", want, got)
		}
	}
	for _, bad := range []string{"GET /v2/admin/stats", "GET /v1/v2/ping", "GET /v2/", "GET /v1/"} {
		if got[bad] {
			t.Errorf("unexpected %s in %v", bad, got)
		}
	}
}

func TestActixScopeStopsAtItsServiceGroup(t *testing.T) {
	got := endpointSet(`App::new()
    .service(web::scope("/a").route("/x", web::get().to(x)))
    .service(web::scope("/b").route("/y", web::post().to(y)))
    .route("/z", web::get().to(z));`)
	if !got["GET /a/x"] || !got["POST /b/y"] || !got["GET /z"] || got["POST /a/y"] || got["GET /b/z"] {
		t.Fatalf("unexpected endpoints: %v", got)
	}
}
