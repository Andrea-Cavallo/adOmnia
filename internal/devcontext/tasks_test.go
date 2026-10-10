package devcontext

import "testing"

func TestTaskRole(t *testing.T) {
	for name, want := range map[string]string{
		"migrate": "migration", "migrations": "migration", "db-migrate": "migration", "migrator": "migration", "migrate-up": "migration",
		"seed": "seed", "db_seed": "seed", "seeder": "seed", "fixtures": "seed",
		"api": "", "migrations-tool-x": "", "seedling": "",
	} {
		if got := taskRole(name); got != want {
			t.Errorf("taskRole(%q) = %q, want %q", name, got, want)
		}
	}
}

func TestDetectTasks(t *testing.T) {
	main := []byte("package main\n\nfunc main() {}\n")
	migrate, _ := detectFile("cmd/migrate/main.go", main, nil)
	if len(migrate) != 1 || migrate[0].Kind != "task" || migrate[0].Attrs["role"] != "migration" || migrate[0].Attrs["runner"] != "go" || migrate[0].Attrs["dir"] != "cmd/migrate" {
		t.Fatalf("cmd/migrate must be a migration task, not a service: %#v", migrate)
	}
	api, _ := detectFile("cmd/api/main.go", main, nil)
	if len(api) == 0 || api[0].Kind != "service" {
		t.Fatalf("cmd/api stays a service: %#v", api)
	}

	makefile := []byte(".PHONY: migrate seed\nVAR := x\nbuild:\n\tgo build ./...\nmigrate: build\n\tgo run ./cmd/migrate\ndb-seed:\n\t./seed.sh\n")
	tasks, _ := detectFile("Makefile", makefile, nil)
	if len(tasks) != 2 || tasks[0].Attrs["target"] != "migrate" || tasks[1].Attrs["role"] != "seed" || tasks[1].Sources[0].Line != 7 {
		t.Fatalf("make targets: %#v", tasks)
	}

	up, _ := detectFile("db/migrations/0001_init.up.sql", []byte("create table t(id int);"), nil)
	if len(up) != 1 || up[0].Attrs["runner"] != "golang-migrate" || up[0].Attrs["dir"] != "db/migrations" {
		t.Fatalf("golang-migrate folder: %#v", up)
	}
	goose, _ := detectFile("sql/20240101_init.sql", []byte("-- +goose Up\ncreate table t(id int);\n"), nil)
	if len(goose) != 1 || goose[0].Attrs["runner"] != "goose" {
		t.Fatalf("goose folder: %#v", goose)
	}
	plain, _ := detectFile("queries/report.sql", []byte("select 1"), nil)
	if len(plain) != 0 {
		t.Fatalf("plain SQL is not a migration: %#v", plain)
	}
}
