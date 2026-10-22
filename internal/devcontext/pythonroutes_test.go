package devcontext

import "testing"

// Le route Python devono arrivare al Developer Context nella stessa forma di quelle Go e Spring:
// kind "route", method/path negli attributi e posizione del simbolo per la CodeLens.
func TestDetectPythonFileFindsFastAPIRoutes(t *testing.T) {
	src := []byte(`from fastapi import FastAPI

app = FastAPI()

@app.get("/items/{item_id}")
async def read_item(item_id: int):
    return {}

@app.post("/items")
def create_item():
    return {}
`)
	routes := detectPythonFile("app/main.py", src)
	if len(routes) != 2 {
		t.Fatalf("want 2 routes, got %d: %+v", len(routes), routes)
	}
	if routes[0].ID != "route:GET /items/{item_id}" || routes[1].Attrs["method"] != "POST" {
		t.Fatalf("unexpected routes: %+v", routes)
	}
	if routes[0].Attrs["declFile"] != "app/main.py" || routes[0].Attrs["declLine"] == "0" || routes[0].Attrs["declName"] != "read_item" {
		t.Fatalf("handler location missing: %+v", routes[0].Attrs)
	}
	if routes[0].Sources[0].Detector != "pythonroutes" || routes[0].Sources[0].Line == 0 {
		t.Fatalf("source missing: %+v", routes[0].Sources)
	}
	if got := detectPythonFile("app/models.py", []byte("class Item:\n    name: str\n")); len(got) != 0 {
		t.Fatalf("a plain module must give no routes: %+v", got)
	}
}

func TestDetectFileRoutesPythonSources(t *testing.T) {
	src := []byte(`from flask import Flask
app = Flask(__name__)

@app.route("/health")
def health():
    return "ok"
`)
	entities, warnings := detectFile("service/api.py", src, nil, AdapterHints{})
	if len(warnings) != 0 {
		t.Fatalf("warnings: %v", warnings)
	}
	if len(entities) != 1 || entities[0].ID != "route:GET /health" || entities[0].Attrs["language"] != "python" {
		t.Fatalf("unexpected entities: %+v", entities)
	}
	// I file Python dentro un ambiente virtuale non vengono letti affatto.
	if interesting(".venv/lib/python3.11/site-packages/pkg/api.py") {
		t.Fatal("files inside .venv must be skipped")
	}
}

func TestDetectPythonFileFindsDjangoURLs(t *testing.T) {
	src := []byte(`from django.urls import path
from . import views

urlpatterns = [
    path("items/<int:pk>/", views.item_detail),
]
`)
	routes := detectPythonFile("config/urls.py", src)
	if len(routes) != 1 {
		t.Fatalf("want 1 route, got %d: %+v", len(routes), routes)
	}
	if routes[0].Attrs["method"] != "ANY" || routes[0].Attrs["path"] != "/items/{pk}" || routes[0].Attrs["declName"] != "views.item_detail" {
		t.Fatalf("unexpected route: %+v", routes[0].Attrs)
	}
}

func TestDetectPythonFileComposesPrefixesAndFindsWebSockets(t *testing.T) {
	src := []byte(`from fastapi import FastAPI, APIRouter

app = FastAPI()
router = APIRouter(prefix="/api/v1")

@router.get("/users/{uid}")
async def get_user(uid: int): ...

@app.websocket("/ws")
async def feed(socket): ...

app.include_router(router)
`)
	entities := detectPythonFile("main.py", src)
	if len(entities) != 2 {
		t.Fatalf("want a route and a websocket, got %+v", entities)
	}
	if entities[0].ID != "route:GET /api/v1/users/{uid}" {
		t.Fatalf("prefix not composed: %s", entities[0].ID)
	}
	if entities[1].Kind != "websocket" || entities[1].Attrs["role"] != "server" || entities[1].Attrs["path"] != "/ws" {
		t.Fatalf("unexpected websocket: %+v", entities[1])
	}
}

func TestInterestingSkipsPythonEnvironments(t *testing.T) {
	for _, rel := range []string{"venv/lib/python3.11/site-packages/flask/app.py", "Lib/site-packages/x/y.py", "svc/site-packages/z.py"} {
		if interesting(rel) {
			t.Errorf("%s belongs to an installed environment", rel)
		}
	}
	if !interesting("internal/env/env.go") || !interesting("app/api.py") {
		t.Fatal("project sources must stay readable")
	}
}
