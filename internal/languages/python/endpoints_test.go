package python

import (
	"strings"
	"testing"
)

// FastAPI, Flask e Django dichiarano gli endpoint in forme statiche riconoscibili: sono le stesse
// route che l'API client di adOmnia deve poter aprire, come per Go e Java.
func TestEndpointsInFileFindsFastAPIRoutes(t *testing.T) {
	source := []byte(`from fastapi import APIRouter, FastAPI

app = FastAPI()
router = APIRouter(prefix="/api")

@app.get("/items/{item_id}")
async def read_item(item_id: int):
    return {}

@router.post("/orders")
def create_order():
    return {}

@app.api_route("/health", methods=["GET", "HEAD"])
@decorator_that_is_not_a_route
def health():
    return {}
`)
	endpoints := EndpointsInFile("app/main.py", source)
	want := []HTTPEndpoint{
		{Method: "GET", Path: "/items/{item_id}", Handler: "read_item", Line: 6},
		{Method: "POST", Path: "/api/orders", Handler: "create_order", Line: 10},
		{Method: "GET", Path: "/health", Handler: "health", Line: 14},
		{Method: "HEAD", Path: "/health", Handler: "health", Line: 14},
	}
	if len(endpoints) != len(want) {
		t.Fatalf("want %d endpoints, got %d: %+v", len(want), len(endpoints), endpoints)
	}
	for i, expected := range want {
		if endpoints[i] != expected {
			t.Fatalf("endpoint %d: %+v, want %+v", i, endpoints[i], expected)
		}
	}
}

func TestEndpointsInFileFindsFlaskRoutesAndMethods(t *testing.T) {
	source := []byte(`from flask import Flask, Blueprint
app = Flask(__name__)
bp = Blueprint("orders", __name__)

@app.route("/ping")
def ping():
    return "pong"

@bp.route("/orders", methods=["POST", "put"])
def orders():
    return {}

@app.get("/readonly")
def readonly():
    return {}
`)
	endpoints := EndpointsInFile("service/app.py", source)
	if len(endpoints) != 4 {
		t.Fatalf("want 4 endpoints, got %d: %+v", len(endpoints), endpoints)
	}
	if endpoints[0].Method != "GET" || endpoints[0].Path != "/ping" || endpoints[0].Handler != "ping" {
		t.Fatalf("default method for @app.route must be GET: %+v", endpoints[0])
	}
	if endpoints[1].Method != "POST" || endpoints[2].Method != "PUT" {
		t.Fatalf("methods list not expanded: %+v", endpoints[1:3])
	}
	if endpoints[3].Method != "GET" || endpoints[3].Path != "/readonly" {
		t.Fatalf("Flask 2 verb decorator not read: %+v", endpoints[3])
	}
}

func TestEndpointsInFileFindsDjangoURLPatterns(t *testing.T) {
	source := []byte(`from django.urls import path, re_path, include

urlpatterns = [
    path("items/<int:pk>/", views.item_detail, name="item-detail"),
    re_path(r"^orders/$", views.order_list),
    path("api/", include("api.urls")),
]
`)
	endpoints := EndpointsInFile("config/urls.py", source)
	if len(endpoints) != 2 {
		t.Fatalf("want 2 endpoints (include excluded), got %d: %+v", len(endpoints), endpoints)
	}
	if endpoints[0].Method != "ANY" || endpoints[0].Path != "/items/{pk}/" || endpoints[0].Handler != "views.item_detail" {
		t.Fatalf("django path not read: %+v", endpoints[0])
	}
	if endpoints[1].Path != "/orders/" || endpoints[1].Handler != "views.order_list" {
		t.Fatalf("django re_path not read: %+v", endpoints[1])
	}
	// Le stesse righe fuori da urls.py non sono route: path() è anche una funzione comune.
	if got := EndpointsInFile("app/views.py", source); len(got) != 0 {
		t.Fatalf("path() outside urls.py must not produce routes: %+v", got)
	}
}

// Un decoratore dentro una docstring o un commento non è un endpoint, e un decoratore che non è una
// rotta non lo diventa per assonanza.
func TestEndpointsInFileIgnoresStringsCommentsAndOtherDecorators(t *testing.T) {
	source := []byte(`"""
Example:
    @app.get("/documented/only")
"""

# @app.post("/commented/out")
@app.websocket("/ws")
def socket():
    pass

@functools.lru_cache(maxsize=8)
def cached():
    pass

@logger.get("/not-a-route")
def logging_helper():
    pass
`)
	endpoints := EndpointsInFile("app/main.py", source)
	want := []HTTPEndpoint{
		{Method: "WS", Path: "/ws", Handler: "socket", Line: 7, WebSocket: true},
		{Method: "GET", Path: "/not-a-route", Handler: "logging_helper", Line: 15},
	}
	if len(endpoints) != len(want) || endpoints[0] != want[0] || endpoints[1] != want[1] {
		t.Fatalf("want %+v, got %+v", want, endpoints)
	}
}

// Una rotta con percorso non letterale non viene inventata: meglio nessun endpoint che uno sbagliato.
func TestEndpointsInFileSkipsDynamicPaths(t *testing.T) {
	source := []byte(`prefix = "/api"
@app.get(prefix + "/items")
def dynamic():
    pass

@app.get(route_path())
def computed():
    pass
`)
	if got := EndpointsInFile("app/main.py", source); len(got) != 0 {
		t.Fatalf("dynamic paths must not become endpoints: %+v", got)
	}
}

func TestIsDjangoURLs(t *testing.T) {
	for path, want := range map[string]bool{
		"config/urls.py":          true,
		"config\\urls.py":         true,
		"urls.py":                 true,
		"app/views.py":            false,
		"app/urls_helpers.py":     false,
		"app/urls.pyc/tests.py":   false,
		"myapp/api/urls.py":       true,
		strings.ToUpper("a/B.py"): false,
	} {
		if got := isDjangoURLs(path); got != want {
			t.Fatalf("%s: %v, want %v", path, got, want)
		}
	}
}

// Il prefisso di un APIRouter/Blueprint fa parte dell'URL: senza, API Workspace e Mock colpirebbero
// un percorso che il servizio non serve.
func TestEndpointsInFileComposesRouterPrefixes(t *testing.T) {
	source := []byte(`from fastapi import FastAPI, APIRouter
from flask import Blueprint

app = FastAPI()
users = APIRouter(prefix="/users")
orders = APIRouter(
    prefix="/orders",
)
admin = Blueprint("admin", __name__, url_prefix="/old")

@users.get("")
def list_users(): ...

@users.get("/{uid}")
def get_user(uid): ...

@orders.post("/")
def create_order(): ...

@admin.route("/stats")
def stats(): ...

app.include_router(users, prefix="/api/v1")
app.include_router(orders)
app.register_blueprint(admin, url_prefix="/admin")
`)
	got := map[string]bool{}
	for _, endpoint := range EndpointsInFile("main.py", source) {
		got[endpoint.Method+" "+endpoint.Path] = true
	}
	for _, want := range []string{"GET /api/v1/users", "GET /api/v1/users/{uid}", "POST /orders", "GET /admin/stats"} {
		if !got[want] {
			t.Errorf("missing %q in %v", want, got)
		}
	}
}

func TestEndpointsInFileReadsRegexURLsAndEmptyDjangoRoot(t *testing.T) {
	source := []byte(`urlpatterns = [
    path("", views.index),
    re_path(r"^articles/(?P<year>[0-9]{4})/$", views.year),
]`)
	endpoints := EndpointsInFile("shop/urls.py", source)
	if len(endpoints) != 2 || endpoints[0].Path != "/" || endpoints[1].Path != "/articles/{year}/" {
		t.Fatalf("unexpected django routes: %+v", endpoints)
	}
}
