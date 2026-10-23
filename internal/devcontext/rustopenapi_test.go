package devcontext

import "testing"

// Un #[derive(OpenApi)] deve diventare un'entità contract come un file OpenAPI, e le route utoipa
// devono arrivare come route.
func TestDetectRustOpenApi(t *testing.T) {
	src := []byte(`#[derive(OpenApi)]
#[openapi(paths(list_items))]
pub struct ApiDoc;
`)
	entities := detectRustOpenApi("src/api.rs", src)
	if len(entities) != 1 || entities[0].Kind != "contract" || entities[0].Attrs["type"] != "utoipa" {
		t.Fatalf("entities = %+v", entities)
	}
}

func TestUtoipaRouteBecomesRouteEntity(t *testing.T) {
	src := []byte(`#[utoipa::path(get, path = "/items")]
async fn list_items() -> Json<Vec<Item>> { todo!() }
`)
	entities := detectRustFile("src/main.rs", src)
	found := false
	for _, e := range entities {
		if e.Kind == "route" && e.ID == "route:GET /items" {
			found = true
		}
	}
	if !found {
		t.Fatalf("utoipa route missing: %+v", entities)
	}
}
