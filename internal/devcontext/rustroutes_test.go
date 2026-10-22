package devcontext

import "testing"

// Le route Rust devono arrivare al Developer Context nella stessa forma di quelle Go, Spring,
// FastAPI e Flask: kind "route", method/path negli attributi e posizione del simbolo per la CodeLens.
func TestDetectRustFileFindsAxumRoutes(t *testing.T) {
	src := []byte(`use axum::{Router, routing::{get, post}};

let app = Router::new()
    .route("/users", get(list_users).post(create_user))
    .route("/users/:id", get(get_user));
`)
	routes := detectRustFile("src/main.rs", src)
	if len(routes) != 3 {
		t.Fatalf("want 3 routes, got %d: %+v", len(routes), routes)
	}
	byPath := map[string]Entity{}
	for _, route := range routes {
		byPath[route.Attrs["method"]+" "+route.Attrs["path"]] = route
	}
	if _, ok := byPath["GET /users"]; !ok {
		t.Fatalf("missing GET /users: %+v", routes)
	}
	if _, ok := byPath["POST /users"]; !ok {
		t.Fatalf("missing POST /users: %+v", routes)
	}
	got := byPath["GET /users/{id}"]
	if got.Attrs == nil || got.Attrs["language"] != "rust" {
		t.Fatalf("axum :id must normalize to {id} and carry language=rust: %+v", byPath)
	}
	if routes[0].Sources[0].Detector != "rustroutes" || routes[0].Sources[0].Line == 0 {
		t.Fatalf("source missing: %+v", routes[0].Sources)
	}
}

func TestDetectFileRoutesRustSources(t *testing.T) {
	src := []byte(`#[get("/health")]
async fn health() -> impl Responder { "ok" }
`)
	entities, warnings := detectFile("service/main.rs", src, nil, AdapterHints{})
	if len(warnings) != 0 {
		t.Fatalf("warnings: %v", warnings)
	}
	if len(entities) != 1 || entities[0].ID != "route:GET /health" || entities[0].Attrs["declName"] != "health" {
		t.Fatalf("unexpected entities: %+v", entities)
	}
}

func TestDetectRustFileComposesRocketMount(t *testing.T) {
	src := []byte(`#[get("/hello/<name>")]
fn hello(name: &str) -> String { name.into() }

#[launch]
fn rocket() -> _ {
    rocket::build().mount("/base", routes![hello])
}
`)
	entities := detectRustFile("src/main.rs", src)
	if len(entities) != 1 {
		t.Fatalf("the attribute route plus its mount must be one composed route: %+v", entities)
	}
	if entities[0].ID != "route:GET /base/hello/{name}" {
		t.Fatalf("mount prefix not composed: %s", entities[0].ID)
	}
}

func TestInterestingSkipsRustTargetDir(t *testing.T) {
	if interesting("target/debug/build/x/main.rs") {
		t.Error("files under target/ must be skipped")
	}
	if !interesting("src/main.rs") || !interesting("crates/api/src/lib.rs") {
		t.Fatal("Rust sources must stay readable")
	}
}
