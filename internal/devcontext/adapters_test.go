package devcontext

import (
	"os"
	"path/filepath"
	"testing"

	"adomnia/internal/plugins"
)

func TestHintsFromContributions(t *testing.T) {
	contributions := []plugins.Contribution{
		{Kind: "adapter", AdapterKind: "framework", Modules: []string{"m.io/framework"}, HandlerTypes: []string{"*f.Ctx"}, RouteMethods: []string{"Fetch"}},
		{Kind: "adapter", AdapterKind: "broker", Modules: []string{"m.io/broker"}, Broker: "pulsar", TopicMethods: []string{"Produce"}},
		{Kind: "adapter", AdapterKind: "database", Modules: []string{"m.io/db"}, SQLMethods: []string{"QueryRaw"}},
		{Kind: "adapter", AdapterKind: "framework", Modules: []string{"m.io/plain"}}, // no hints: only direct-dependency entities
		{Kind: "command", ID: "not-an-adapter"},
	}
	hints := HintsFromContributions(contributions)
	if len(hints.Frameworks["m.io/framework"].HandlerTypes) != 1 || hints.Frameworks["m.io/framework"].HandlerTypes[0] != "*f.Ctx" ||
		len(hints.Frameworks["m.io/framework"].RouteMethods) != 1 || hints.Frameworks["m.io/framework"].RouteMethods[0] != "Fetch" {
		t.Fatalf("framework hint lost: %+v", hints.Frameworks["m.io/framework"])
	}
	if hints.Brokers["m.io/broker"].Broker != "pulsar" || len(hints.Brokers["m.io/broker"].TopicMethods) != 1 {
		t.Fatalf("broker hint lost: %+v", hints.Brokers["m.io/broker"])
	}
	if len(hints.Databases["m.io/db"].SQLMethods) != 1 || hints.Databases["m.io/db"].SQLMethods[0] != "QueryRaw" {
		t.Fatalf("database hint lost: %+v", hints.Databases["m.io/db"])
	}
	if _, ok := hints.Frameworks["m.io/plain"]; ok {
		t.Fatal("an adapter without hints must not teach detection")
	}
	if !HintsFromContributions(nil).Empty() {
		t.Fatal("no contributions must produce empty hints")
	}
}

func TestFrameworkAdapterTeachesRouteAndHandlerLinking(t *testing.T) {
	hints := AdapterHints{Frameworks: map[string]FrameworkHint{
		"github.com/kataras/iris/v12": {HandlerTypes: []string{"*iris.Context"}, RouteMethods: []string{"Fetch"}},
	}}
	entities, err := detectGoFile("api/routes.go", []byte(`package api

import "github.com/kataras/iris/v12"

func Routes(app *iris.Application, h *handler) {
	app.Fetch("/users/:id", h.GetUser)
}

func (h *handler) GetUser(ctx *iris.Context) {}
`), hints)
	if err != nil {
		t.Fatal(err)
	}
	got := byID(linkHandlers(merge(entities)))
	route, ok := got["route:FETCH /users/{id}"]
	if !ok {
		t.Fatalf("plugin route method not detected: %v", keys(got))
	}
	if route.Attrs["declName"] != "handler.GetUser" || route.Attrs["declFile"] != "api/routes.go" {
		t.Fatalf("plugin handler type did not link the route: %+v", route.Attrs)
	}
}

func TestFrameworkAdapterHandlerTypeOnlyLinking(t *testing.T) {
	hints := AdapterHints{Frameworks: map[string]FrameworkHint{
		"github.com/gofiber/fiber/v2": {HandlerTypes: []string{"*fiber.Ctx"}},
	}}
	// The route method (Get) is built-in; the handler type is what the plugin teaches.
	entities, _ := detectGoFile("api/routes.go", []byte(`package api

import "github.com/gofiber/fiber/v2"

func Routes(app *fiber.App, h *handler) {
	app.Get("/health", h.Health)
}

func (h *handler) Health(c *fiber.Ctx) {}
`), hints)
	got := byID(linkHandlers(merge(entities)))
	if got["route:GET /health"].Attrs["declName"] != "handler.Health" {
		t.Fatalf("plugin handler type did not link: %+v", got["route:GET /health"].Attrs)
	}
}

func TestBrokerAdapterTeachesTopicDetection(t *testing.T) {
	hints := AdapterHints{Brokers: map[string]BrokerHint{
		"github.com/apache/pulsar-client-go/pulsar": {Broker: "pulsar", TopicMethods: []string{"Produce", "Subscribe"}},
	}}
	entities, _ := detectGoFile("events/publish.go", []byte(`package events

import "github.com/apache/pulsar-client-go/pulsar"

func publish(client *pulsar.Client) {
	client.Produce("orders.created", msg)
	client.Subscribe("orders.updated")
}
`), hints)
	got := byID(entities)
	if got["topic:orders.created"].Attrs["broker"] != "pulsar" {
		t.Fatalf("producer topic not detected: %+v", keys(got))
	}
	if got["topic:orders.updated"].Attrs["broker"] != "pulsar" {
		t.Fatalf("subscriber topic not detected: %+v", keys(got))
	}
}

func TestBrokerAdapterNeedsTheImport(t *testing.T) {
	hints := AdapterHints{Brokers: map[string]BrokerHint{
		"github.com/apache/pulsar-client-go/pulsar": {Broker: "pulsar", TopicMethods: []string{"Produce"}},
	}}
	entities, _ := detectGoFile("events/publish.go", []byte(`package events
func publish(client *Client) { client.Produce("not.a.topic", msg) }
`), hints)
	if got := byID(entities); len(got) != 0 {
		t.Fatalf("no pulsar import → no topics, got %v", keys(got))
	}
}

func TestDatabaseAdapterTeachesTablesByImport(t *testing.T) {
	hints := AdapterHints{Databases: map[string]DatabaseHint{
		"example.com/orm": {SQLMethods: []string{"QueryRaw"}},
	}}
	withImport, _ := detectGoFile("store/query.go", []byte(`package store

import "example.com/orm"

func run(db *orm.DB) {
	db.QueryRaw("SELECT id FROM payments")
}
`), hints)
	if _, ok := byID(withImport)["table:payments"]; !ok {
		t.Fatalf("plugin sql method not detected when the module is imported: %v", keys(byID(withImport)))
	}
	withoutImport, _ := detectGoFile("store/query.go", []byte(`package store
func run(db *DB) { db.QueryRaw("SELECT id FROM payments") }
`), hints)
	if got := byID(withoutImport); len(got) != 0 {
		t.Fatalf("plugin sql method must be scoped to the importing module, got %v", keys(got))
	}
}

func TestManagerSetAdaptersRescans(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "publish.go"), []byte(`package events

import "github.com/apache/pulsar-client-go/pulsar"

func publish(client *pulsar.Client) { client.Produce("orders.created", msg) }
`), 0o644); err != nil {
		t.Fatal(err)
	}
	m, _ := newTestManager(root)
	if snap, _ := m.Get("s1"); byID(snap.Entities)["topic:orders.created"].Kind == "topic" {
		t.Fatal("before the adapter is set the topic must be absent")
	}
	m.SetAdapters([]plugins.Contribution{
		{Kind: "adapter", AdapterKind: "broker", Broker: "pulsar", TopicMethods: []string{"Produce"}, Modules: []string{"github.com/apache/pulsar-client-go/pulsar"}},
	})
	snap, _ := m.Get("s1")
	if byID(snap.Entities)["topic:orders.created"].Attrs["broker"] != "pulsar" {
		t.Fatalf("setting the adapter must rescan with the new hints: %v", keys(byID(snap.Entities)))
	}
	m.SetAdapters(nil)
	snap, _ = m.Get("s1")
	if byID(snap.Entities)["topic:orders.created"].Kind == "topic" {
		t.Fatal("removing the adapter must drop the plugin-taught topic")
	}
}
