package declared

import (
	"regexp"
	"slices"
	"strings"
	"testing"
)

// colonParam is the :id form; the Developer Context normalizes it to {id}, so the tests do too.
var colonParam = regexp.MustCompile(`/:(\w+)`)

// routeKeys renders endpoints as "METHOD /path" for compact assertions.
func routeKeys(endpoints []Endpoint) []string {
	keys := make([]string, 0, len(endpoints))
	for _, endpoint := range endpoints {
		keys = append(keys, endpoint.Method+" "+colonParam.ReplaceAllString(endpoint.Path, "/{$1}"))
	}
	return keys
}

func expectRoutes(t *testing.T, got []Endpoint, want ...string) {
	t.Helper()
	keys := routeKeys(got)
	for _, route := range want {
		if !slices.Contains(keys, route) {
			t.Errorf("missing %q in %v", route, keys)
		}
	}
}

func TestASPNetMinimalAPIAndControllers(t *testing.T) {
	source := `var app = builder.Build();
app.MapGet("/health", () => "ok");
var api = app.MapGroup("/api");
var todos = api.MapGroup("/todos");
todos.MapPost("/", CreateTodo);
todos.MapDelete("/{id:int}", DeleteTodo);
app.MapMethods("/legacy", new[] { "GET", "HEAD" }, Legacy);

[ApiController]
[Route("api/[controller]")]
public class ProductsController : ControllerBase
{
    [HttpGet]
    public IEnumerable<Product> List() => _store.All();

    [HttpGet("{id}")]
    public ActionResult<Product> Get(int id) => _store.Find(id);

    [HttpPut("{id?}"), Authorize]
    public IActionResult Update(int id, Product p) => NoContent();

    [HttpPost("/absolute/import")]
    public IActionResult Import() => Ok();
}`
	got := EndpointsInFile("Program.cs", []byte(source))
	expectRoutes(t, got, "GET /health", "POST /api/todos", "DELETE /api/todos/{id}", "ANY /legacy",
		"GET /api/Products", "GET /api/Products/{id}", "PUT /api/Products/{id}", "POST /absolute/import")
	if len(got) != 8 {
		t.Fatalf("unexpected routes: %v", routeKeys(got))
	}
	for _, endpoint := range got {
		if endpoint.Language != "csharp" || endpoint.Line == 0 {
			t.Fatalf("endpoint without language or line: %+v", endpoint)
		}
		if endpoint.Path == "/api/Products/{id}" && endpoint.Method == "GET" && endpoint.Handler != "ProductsController.Get" {
			t.Fatalf("handler = %q", endpoint.Handler)
		}
	}
}

func TestLaravelRoutesGroupsAndResources(t *testing.T) {
	source := `<?php
use Illuminate\Support\Facades\Route;

Route::get('/users/{id}', [UserController::class, 'show']);
Route::match(['get', 'post'], '/search', SearchController::class);
Route::prefix('admin')->middleware('auth')->group(function () {
    Route::post('/reports', [ReportController::class, 'store']);
    Route::apiResource('photos', PhotoController::class)->only(['index', 'show']);
});
Route::delete('/after/{post?}', fn () => null);
`
	got := EndpointsInFile("routes/api.php", []byte(source))
	expectRoutes(t, got, "GET /api/users/{id}", "GET /api/search", "POST /api/search", "POST /api/admin/reports",
		"GET /api/admin/photos", "GET /api/admin/photos/{photo}", "DELETE /api/after/{post}")
	if slices.Contains(routeKeys(got), "DELETE /api/admin/photos/{photo}") {
		t.Fatalf("->only() must filter the resource: %v", routeKeys(got))
	}
	web := EndpointsInFile("routes/web.php", []byte(`<?php Route::get('/', HomeController::class);`))
	expectRoutes(t, web, "GET /")
}

func TestSymfonyAttributeRoutes(t *testing.T) {
	source := `<?php
#[Route('/blog')]
class BlogController extends AbstractController
{
    #[Route('/{slug}', name: 'blog_show', methods: ['GET'])]
    public function show(string $slug): Response {}

    #[Route('/new', methods: ['GET', 'POST'])]
    public function create(): Response {}
}`
	got := EndpointsInFile("src/Controller/BlogController.php", []byte(source))
	expectRoutes(t, got, "GET /blog/{slug}", "GET /blog/new", "POST /blog/new")
	if got[0].Handler != "BlogController::show" || got[0].Framework != "symfony" {
		t.Fatalf("first = %+v", got[0])
	}
}

func TestRailsRoutes(t *testing.T) {
	source := `Rails.application.routes.draw do
  root "pages#home"
  get "/about", to: "pages#about"
  namespace :api do
    scope "/v1" do
      resources :users, only: [:index, :show] do
        resources :posts
        member do
          post :ban
        end
        collection do
          get :search
        end
      end
      resource :profile, except: [:destroy]
    end
  end
  match "/hook", to: "hooks#receive", via: [:get, :post]
end`
	got := EndpointsInFile("config/routes.rb", []byte(source))
	expectRoutes(t, got, "GET /", "GET /about", "GET /api/v1/users", "GET /api/v1/users/{id}",
		"GET /api/v1/users/{user_id}/posts", "DELETE /api/v1/users/{user_id}/posts/{id}",
		"POST /api/v1/users/{id}/ban", "GET /api/v1/users/search",
		"GET /api/v1/profile", "PATCH /api/v1/profile", "GET /hook", "POST /hook")
	keys := routeKeys(got)
	for _, unexpected := range []string{"POST /api/v1/users", "DELETE /api/v1/profile", "GET /api/v1/profile/{id}"} {
		if slices.Contains(keys, unexpected) {
			t.Fatalf("%s must be filtered: %v", unexpected, keys)
		}
	}
}

func TestSinatraOnlyWhenTheFileUsesSinatra(t *testing.T) {
	app := "require 'sinatra'\n\nget '/hello/:name' do\n  \"Hi #{params[:name]}\"\nend\n\npost '/items' do\nend\n"
	expectRoutes(t, EndpointsInFile("app.rb", []byte(app)), "GET /hello/{name}", "POST /items")
	spec := "RSpec.describe 'Users' do\n  it 'lists' do\n    get '/users'\n  end\nend\n"
	if got := EndpointsInFile("spec/requests/users_spec.rb", []byte(spec)); len(got) != 0 {
		t.Fatalf("a request spec is not a route file: %v", routeKeys(got))
	}
}

func TestPhoenixRouter(t *testing.T) {
	source := `defmodule MyAppWeb.Router do
  use MyAppWeb, :router

  pipeline :api do
    plug :accepts, ["json"]
  end

  scope "/api", MyAppWeb do
    pipe_through :api
    get "/health", HealthController, :index
    resources "/users", UserController, except: [:new, :edit] do
      post "/avatar", AvatarController, :create
    end
    live "/dashboard", DashboardLive
  end
end`
	got := EndpointsInFile("lib/my_app_web/router.ex", []byte(source))
	expectRoutes(t, got, "GET /api/health", "GET /api/users", "DELETE /api/users/{id}",
		"POST /api/users/{user_id}/avatar", "GET /api/dashboard")
	if slices.Contains(routeKeys(got), "GET /api/users/new") || slices.Contains(routeKeys(got), "POST /accepts") {
		t.Fatalf("unexpected: %v", routeKeys(got))
	}
}

func TestVaporRoutes(t *testing.T) {
	source := `import Vapor

func routes(_ app: Application) throws {
    app.get("hello", ":name") { req async throws -> String in
        let name = req.parameters.get("name")!
        return "Hello, \(name)"
    }
    let api = app.grouped("api", "v1")
    api.post("todos", use: create)
    app.group("users") { users in
        users.delete(":id", use: delete)
    }
}`
	got := EndpointsInFile("Sources/App/routes.swift", []byte(source))
	expectRoutes(t, got, "GET /hello/{name}", "POST /api/v1/todos", "DELETE /users/{id}")
	if len(got) != 3 {
		t.Fatalf("req.parameters.get is not a route: %v", routeKeys(got))
	}
}

func TestEndpointsIgnoreOtherFiles(t *testing.T) {
	for _, file := range []string{"main.go", "notes.md", "lib/util.ex", "Sources/App/Model.swift"} {
		if got := EndpointsInFile(file, []byte(`get "/x", C, :a`)); len(got) != 0 {
			t.Fatalf("%s: %v", file, routeKeys(got))
		}
	}
	if !strings.HasPrefix(joinRoute("/api/", "/x/"), "/api/x") || joinRoute("", "") != "/" {
		t.Fatal("joinRoute")
	}
}
