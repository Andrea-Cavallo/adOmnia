package devcontext

import "testing"

func TestDeclaredRoutesBecomeRouteEntities(t *testing.T) {
	cases := []struct{ rel, source, key, language string }{
		{"Api/Program.cs", `app.MapGet("/orders/{id:int}", GetOrder);`, "GET /orders/{id}", "csharp"},
		{"routes/api.php", `<?php Route::post('/users', [UserController::class, 'store']);`, "POST /api/users", "php"},
		{"config/routes.rb", "Rails.application.routes.draw do\n  get '/posts/:id', to: 'posts#show'\nend\n", "GET /posts/{id}", "ruby"},
		{"lib/app_web/router.ex", "use AppWeb, :router\nscope \"/api\" do\n  get \"/items/:id\", ItemController, :show\nend\n", "GET /api/items/{id}", "elixir"},
		{"Sources/App/routes.swift", "import Vapor\napp.get(\"todos\", \":id\", use: show)\n", "GET /todos/{id}", "swift"},
	}
	for _, tc := range cases {
		if !interesting(tc.rel) {
			t.Fatalf("%s must be scanned", tc.rel)
		}
		entities, warnings := detectFile(tc.rel, []byte(tc.source), nil, AdapterHints{})
		if len(entities) != 1 || len(warnings) != 0 {
			t.Fatalf("%s: %+v %v", tc.rel, entities, warnings)
		}
		got := entities[0]
		if got.Kind != "route" || got.Attrs["method"]+" "+got.Attrs["path"] != tc.key || got.Attrs["language"] != tc.language || got.Attrs["declFile"] != tc.rel {
			t.Fatalf("%s: %+v", tc.rel, got)
		}
	}
	if interesting("deps/phoenix/lib/router.ex") || interesting("_build/dev/lib/x.ex") {
		t.Fatal("Elixir dependencies and build output are not the project")
	}
}
