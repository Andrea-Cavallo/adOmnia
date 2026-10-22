package rust

import (
	"strings"
	"testing"
)

func endpointsOf(t *testing.T, source string) []HTTPEndpoint {
	t.Helper()
	return EndpointsInFile("main.rs", []byte(source))
}

func paths(t *testing.T, source string) []string {
	t.Helper()
	var out []string
	for _, e := range endpointsOf(t, source) {
		out = append(out, e.Method+" "+e.Path)
	}
	return out
}

func containsAll(t *testing.T, got []string, want ...string) {
	t.Helper()
	set := map[string]bool{}
	for _, g := range got {
		set[g] = true
	}
	for _, w := range want {
		if !set[w] {
			t.Fatalf("missing %q in %v", w, got)
		}
	}
}

func TestAxumRouteBuilder(t *testing.T) {
	got := paths(t, `use axum::{Router, routing::{get, post}};
let app = Router::new()
    .route("/users", get(list_users).post(create_user))
    .route("/users/:id", get(get_user))
    .route("/users/{id}", get(get_user))
    .route("/health", get(health));
`)
	containsAll(t, got, "GET /users", "POST /users", "GET /users/:id", "GET /users/{id}", "GET /health")
}

func TestAxumAnyAndNest(t *testing.T) {
	got := paths(t, `let app = Router::new()
    .route("/proxy", any(proxy))
    .nest("/api", api_routes);
`)
	containsAll(t, got, "ANY /proxy")
}

func TestActixAttributes(t *testing.T) {
	got := paths(t, `use actix_web::{get, post, web};

#[get("/users/{id}")]
async fn get_user(path: web::Path<u32>) -> impl Responder { todo!() }

#[post("/users")]
async fn create_user() -> impl Responder { todo!() }

#[route("/users", method = "PATCH")]
async fn patch_users() -> impl Responder { todo!() }
`)
	containsAll(t, got, "GET /users/{id}", "POST /users", "PATCH /users")
}

func TestRocketAttributesAndMount(t *testing.T) {
	source := `#[get("/")]
fn index() -> &'static str { "hi" }

#[get("/hello/<name>")]
fn hello(name: &str) -> String { name.into() }

#[launch]
fn rocket() -> _ {
    rocket::build()
        .mount("/", routes![index])
        .mount("/base", routes![hello])
}
`
	got := paths(t, source)
	// index è montato alla radice (/), hello solo sotto /base: nessuna route "fantasma" non montata.
	if len(got) != 2 {
		t.Fatalf("want 2 composed routes, got %v", got)
	}
	containsAll(t, got, "GET /", "GET /base/hello/{name}")
}

func TestActixScopeAndResource(t *testing.T) {
	got := paths(t, `App::new()
    .service(web::scope("/api").route("/users", web::get().to(list_users)))
    .service(web::resource("/health").route(web::get().to(health)));
`)
	containsAll(t, got, "GET /api/users", "GET /health")
	for _, g := range got {
		if g == "ANY /health" {
			t.Fatalf("a resource with a route must not also be ANY: %v", got)
		}
	}
}

func TestActixBareResource(t *testing.T) {
	got := paths(t, `web::resource("/x")`)
	containsAll(t, got, "ANY /x")
}

func TestCommentsAndStringsDoNotBecomeRoutes(t *testing.T) {
	got := paths(t, `// #[get("/fake")]
/*
#[post("/also-fake")]
*/
#[get("/real")]
async fn real() { todo!() }
`)
	if len(got) != 1 || got[0] != "GET /real" {
		t.Fatalf("got %v", got)
	}
}

func TestRocketParamNormalization(t *testing.T) {
	got := paths(t, `#[get("/users/<id>")]
fn user(id: u32) {}
#[get("/files/<path..>")]
fn files(path: std::path::PathBuf) {}
`)
	containsAll(t, got, "GET /users/{id}", "GET /files/{path}")
}

func TestMultiLineRouteChain(t *testing.T) {
	got := paths(t, `let app = Router::new().route(
    "/deep",
    get(handler)
);
`)
	containsAll(t, got, "GET /deep")
}

func TestUtoipaPathAttribute(t *testing.T) {
	got := paths(t, `#[utoipa::path(get, path = "/items", responses((status = 200, body = Item)))]
#[get("/items")]
async fn list_items() -> Json<Vec<Item>> { todo!() }
`)
	containsAll(t, got, "GET /items")
}

func TestRustCodeLinesStripsLineComments(t *testing.T) {
	lines := rustCodeLines("let x = 1; // #[get(\"/nope\")]\n#[get(\"/yes\")]")
	if len(lines) != 2 || !strings.Contains(lines[1].text, `#[get("/yes")]`) {
		t.Fatalf("%#v", lines)
	}
	if strings.Contains(lines[0].text, "#[get") {
		t.Fatalf("comment not stripped: %q", lines[0].text)
	}
}
