package golang

import (
	"context"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/tools/go/packages"
)

var contextFixture = map[string]string{
	"go.mod": "module example.com/ctx\n\ngo 1.22\n",
	"repo/repo.go": `package repo

import "context"

func Find(ctx context.Context, id string) string { return id }
`,
	"api/api.go": `package api

import (
	"context"
	"time"

	"example.com/ctx/repo"
)

func Handle(ctx context.Context) {
	repo.Find(ctx, "a")
	bg := context.Background()
	repo.Find(bg, "b")
	tctx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	repo.Find(tctx, "c")
	repo.Find(context.WithoutCancel(ctx), "d")
}
`,
}

func TestArchitectureContextFlow(t *testing.T) {
	root := t.TempDir()
	for name, content := range contextFixture {
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	fset := token.NewFileSet()
	config := &packages.Config{Context: context.Background(), Dir: root, Fset: fset, Env: append(os.Environ(), "GOFLAGS=-mod=mod", "GOPROXY=off"),
		Mode: packages.NeedName | packages.NeedFiles | packages.NeedCompiledGoFiles | packages.NeedSyntax | packages.NeedTypes | packages.NeedTypesInfo | packages.NeedImports | packages.NeedModule}
	loaded, err := packages.Load(config, "./...")
	if err != nil {
		t.Skipf("go/packages unavailable: %v", err)
	}
	report := AnalyzeArchitecture(fset, loaded, os.ReadFile)
	got := []string{}
	for _, call := range report.ContextCalls {
		label := call.From[strings.LastIndex(call.From, "/")+1:] + "->" + call.To[strings.LastIndex(call.To, "/")+1:] + " " + call.Origin
		if call.Timeout {
			label += " timeout"
		}
		got = append(got, label)
	}
	want := "api.Handle->repo.Find param|api.Handle->repo.Find root|api.Handle->repo.Find param timeout|api.Handle->repo.Find root"
	if strings.Join(got, "|") != want {
		t.Fatalf("got %v", got)
	}
	for _, function := range report.Functions {
		if !function.Context {
			t.Errorf("%s should be marked as taking a context", function.ID)
		}
	}
}
