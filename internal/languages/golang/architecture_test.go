package golang

import (
	"context"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"golang.org/x/tools/go/packages"
)

var architectureFixture = map[string]string{
	"go.mod":                       "module example.com/shop\n\ngo 1.22\n\nrequire (\n\tgithub.com/IBM/sarama v0.0.0\n\tgoogle.golang.org/grpc v0.0.0\n\tgithub.com/spf13/cobra v0.0.0\n)\n\nreplace github.com/IBM/sarama => ./third_party/sarama\n\nreplace google.golang.org/grpc => ./third_party/grpc\n\nreplace github.com/spf13/cobra => ./third_party/cobra\n",
	"third_party/sarama/go.mod":    "module github.com/IBM/sarama\n\ngo 1.22\n",
	"third_party/sarama/sarama.go": "package sarama\n\ntype ProducerMessage struct{ Topic string }\n\ntype SyncProducer interface{ SendMessage(*ProducerMessage) error }\n",
	"third_party/grpc/go.mod":      "module google.golang.org/grpc\n\ngo 1.22\n",
	"third_party/grpc/grpc.go":     "package grpc\n\ntype ServiceRegistrar interface{ RegisterService() }\n",
	"third_party/cobra/go.mod":     "module github.com/spf13/cobra\n\ngo 1.22\n",
	"third_party/cobra/cobra.go":   "package cobra\n\ntype Command struct{ Use string }\n",
	"store/store.go": `package store

import "database/sql"

type Store interface {
	Get(id string) string
	Put(id, v string)
	Delete(id string)
	List() []string
	Count() int
	Close() error
}

type memStore struct{}

func (memStore) Get(id string) string { return id }
func (memStore) Put(id, v string)     {}
func (memStore) Delete(id string)     {}
func (memStore) List() []string       { return nil }
func (memStore) Count() int           { return 0 }
func (memStore) Close() error         { return nil }

type cacheStore struct{}

func (*cacheStore) Get(id string) string { return id }
func (*cacheStore) Put(id, v string)     {}
func (*cacheStore) Delete(id string)     {}
func (*cacheStore) List() []string       { return nil }

func New() Store { return memStore{} }

type OrderRepository struct{ db *sql.DB }

func (r *OrderRepository) Find() {}
`,
	"service/service.go": `package service

import (
	"github.com/IBM/sarama"
	"google.golang.org/grpc"

	"example.com/shop/store"
)

type Service struct{ store store.Store }

func (s *Service) Lookup(id string) string { return s.store.Get(id) }

func Publish(p sarama.SyncProducer) error {
	return p.SendMessage(&sarama.ProducerMessage{Topic: "orders.created"})
}

type greeter struct{}

func RegisterGreeterServer(s grpc.ServiceRegistrar, impl any) {}

func Wire(s grpc.ServiceRegistrar) { RegisterGreeterServer(s, greeter{}) }
`,
	"cmd/shop/main.go": `package main

import (
	"flag"
	"net/http"
	"time"

	"github.com/spf13/cobra"

	"example.com/shop/service"
	"example.com/shop/store"
)

var root = &cobra.Command{Use: "shop serve"}

func main() {
	flag.Parse()
	svc := &service.Service{}
	http.HandleFunc("GET /orders/{id}", func(w http.ResponseWriter, r *http.Request) { _ = svc.Lookup("x") })
	_ = store.New()
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
}
`,
}

func loadArchitectureFixture(t *testing.T) ArchitectureReport {
	t.Helper()
	root := t.TempDir()
	for name, content := range architectureFixture {
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	fset := token.NewFileSet()
	config := &packages.Config{Context: context.Background(), Dir: root, Tests: true, Fset: fset, Env: append(os.Environ(), "GOFLAGS=-mod=mod", "GOPROXY=off"),
		Mode: packages.NeedName | packages.NeedFiles | packages.NeedCompiledGoFiles | packages.NeedSyntax | packages.NeedTypes | packages.NeedTypesInfo | packages.NeedImports | packages.NeedModule}
	loaded, err := packages.Load(config, "./...")
	if err != nil {
		t.Skipf("go/packages unavailable: %v", err)
	}
	for _, pkg := range loaded {
		if len(pkg.Errors) > 0 {
			t.Fatalf("fixture does not compile: %v", pkg.Errors)
		}
	}
	read := func(path string) ([]byte, error) {
		if !strings.HasPrefix(filepath.Clean(path), filepath.Clean(root)) {
			return nil, os.ErrNotExist
		}
		return os.ReadFile(path)
	}
	return AnalyzeArchitecture(fset, loaded, read)
}

func TestAnalyzeArchitectureGraphs(t *testing.T) {
	report := loadArchitectureFixture(t)
	paths := []string{}
	for _, pkg := range report.Packages {
		paths = append(paths, pkg.Path)
	}
	if strings.Join(paths, ",") != "example.com/shop/cmd/shop,example.com/shop/service,example.com/shop/store" {
		t.Fatalf("packages: %v", paths)
	}
	edges := []string{}
	for _, edge := range report.Imports {
		edges = append(edges, edge.From[strings.LastIndex(edge.From, "/")+1:]+"->"+edge.To[strings.LastIndex(edge.To, "/")+1:])
	}
	if strings.Join(edges, ",") != "shop->service,shop->store,service->store" {
		t.Fatalf("imports: %v", edges)
	}
	calls := map[string]bool{}
	for _, edge := range report.Calls {
		calls[edge.From+" -> "+edge.To] = true
	}
	if !calls["(*example.com/shop/service.Service).Lookup -> (example.com/shop/store.Store).Get"] {
		t.Fatalf("interface call missing: %v", calls)
	}
	if len(report.PackageCalls) == 0 || len(report.Modules) != 1 || len(report.Modules[0].External) != 3 {
		t.Fatalf("package calls %v modules %+v", report.PackageCalls, report.Modules)
	}
}

func TestAnalyzeArchitectureInterfaces(t *testing.T) {
	report := loadArchitectureFixture(t)
	if len(report.Interfaces) != 1 {
		t.Fatalf("interfaces: %+v", report.Interfaces)
	}
	store := report.Interfaces[0]
	if store.Name != "Store" || len(store.Methods) != 6 || len(store.Implementations) != 1 || store.Implementations[0].Type != "memStore" {
		t.Fatalf("store: %+v", store)
	}
	if len(store.NearMisses) != 1 || store.NearMisses[0].Type != "cacheStore" || strings.Join(store.NearMisses[0].Missing, ",") != "Close,Count" {
		t.Fatalf("near misses: %+v", store.NearMisses)
	}
	kinds := []string{}
	for _, hint := range store.Hints {
		kinds = append(kinds, hint.Kind)
	}
	if strings.Join(kinds, ",") != "too-broad,single-implementation,consumer-side" {
		t.Fatalf("hints: %+v", store.Hints)
	}
	roles := map[string]int{}
	for _, user := range store.Users {
		roles[user.Kind]++
	}
	if roles["field"] != 1 || roles["result"] != 1 {
		t.Fatalf("users: %+v", store.Users)
	}
}

func TestAnalyzeArchitectureEntries(t *testing.T) {
	report := loadArchitectureFixture(t)
	got := []string{}
	for _, entry := range report.Entries {
		label := entry.Kind + ":" + entry.Name
		if entry.Detail != "" {
			label += "(" + entry.Detail + ")"
		}
		if len(entry.Topics) > 0 {
			label += strings.Join(entry.Topics, "+")
		}
		got = append(got, label)
	}
	sort.Strings(got)
	want := []string{
		"cli:example.com/shop/cmd/shop(flag)",
		"cli:shop(cobra)",
		"grpc:Greeter(greeter)",
		"http:GET /orders/{id}(net/http)",
		"job:main(NewTicker(5 * time.Minute))",
		"kafka-producer:Publish(sarama)orders.created",
		"main:example.com/shop/cmd/shop",
		"repository:OrderRepository(database/sql · 1 method)",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("entries:\n%s", strings.Join(got, "\n"))
	}
}
