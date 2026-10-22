package devcontext

import "testing"

// Le variabili d'ambiente Rust devono arrivare al Developer Context come entità envvar, così il form
// di Run propone di compilarle (stesso ruolo delle application.yml di Spring).
func TestDetectRustEnv(t *testing.T) {
	src := []byte(`let port = std::env::var("PORT").unwrap();
let db = env!("DATABASE_URL");
`)
	entities := detectRustEnv("src/main.rs", src)
	names := map[string]bool{}
	for _, e := range entities {
		if e.Kind == "envvar" {
			names[e.ID] = true
		}
	}
	if !names["envvar:PORT"] || !names["envvar:DATABASE_URL"] {
		t.Fatalf("missing env vars in %+v", entities)
	}
	if entities[0].Attrs["language"] != "rust" || entities[0].Attrs["declFile"] != "src/main.rs" {
		t.Fatalf("attrs = %+v", entities[0].Attrs)
	}
}

func TestDetectRustFileYieldsEnvVarsAlongsideRoutes(t *testing.T) {
	src := []byte(`#[get("/health")]
async fn health() -> impl Responder { "ok" }

fn main() {
    let _ = std::env::var("PORT").unwrap();
}
`)
	entities := detectRustFile("src/main.rs", src)
	kinds := map[string]bool{}
	for _, e := range entities {
		kinds[e.Kind] = true
	}
	if !kinds["route"] || !kinds["envvar"] {
		t.Fatalf("a Rust file must yield routes and env vars: %+v", kinds)
	}
}
