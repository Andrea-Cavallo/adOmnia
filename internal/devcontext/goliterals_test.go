package devcontext

import (
	"go/parser"
	"go/token"
	"testing"
)

func literalsOf(t *testing.T, src string) map[string]Entity {
	t.Helper()
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "internal/store.go", src, parser.SkipObjectResolution)
	if err != nil {
		t.Fatal(err)
	}
	return byID(detectLiterals("internal/store.go", fset, file))
}

func TestDetectEnvAndSQL(t *testing.T) {
	got := literalsOf(t, `package store
import "os"
const listQuery = "SELECT id FROM payments p JOIN accounts a ON a.id = p.account_id"
type Config struct {
	DSN  string `+"`env:\"DATABASE_URL,required\"`"+`
	Skip string `+"`env:\"-\"`"+`
}
func run(ctx context.Context, db *sql.DB, name string) {
	_ = os.Getenv("PAYMENT_API_URL")
	_, _ = os.LookupEnv("PORT")
	db.QueryContext(ctx, listQuery)
	db.Exec("INSERT INTO ledger_entries (id) VALUES ($1) ON CONFLICT (id) DO UPDATE SET id = excluded.id")
	db.Query("select * from unnest($1)")
	db.Query("SELECT * FROM " + name)
	db.Exec(fmt.Sprintf("DELETE FROM %s", name))
}`)
	for _, id := range []string{"envvar:PAYMENT_API_URL", "envvar:PORT", "envvar:DATABASE_URL", "table:payments", "table:accounts", "table:ledger_entries"} {
		if e, ok := got[id]; !ok || e.Confidence != ConfidenceInferred {
			t.Errorf("missing inferred %s in %v", id, keys(got))
		}
	}
	for _, id := range []string{"table:SET", "table:unnest", "envvar:-"} {
		if _, ok := got[id]; ok {
			t.Errorf("%s must not be detected", id)
		}
	}
	if len(got) != 6 {
		t.Errorf("dynamic SQL must be ignored; got %v", keys(got))
	}
}

func TestDetectTopicsByImportedLibrary(t *testing.T) {
	got := literalsOf(t, `package events
import (
	"github.com/IBM/sarama"
	"github.com/twmb/franz-go/pkg/kgo"
	kafkago "github.com/segmentio/kafka-go"
	amqp "github.com/rabbitmq/amqp091-go"
	"github.com/nats-io/nats.go"
)
func publish(ch *amqp.Channel, nc *nats.Conn) {
	_ = &sarama.ProducerMessage{Topic: "payment.created"}
	_ = &kgo.Record{Topic: "payment.settled"}
	_ = kgo.ConsumeTopics("ledger.updated", "ledger.closed")
	_ = kafkago.Writer{Topic: "audit.events"}
	_ = ch.PublishWithContext(ctx, "payments", "payment.refunded", false, false, msg)
	_ = nc.Publish("notifications.email", data)
}`)
	want := map[string]string{
		"topic:payment.created": "kafka", "topic:payment.settled": "kafka", "topic:ledger.updated": "kafka",
		"topic:ledger.closed": "kafka", "topic:audit.events": "kafka", "topic:payment.refunded": "amqp",
		"topic:notifications.email": "nats",
	}
	for id, broker := range want {
		if got[id].Attrs["broker"] != broker {
			t.Errorf("%s broker = %q, want %q (all: %v)", id, got[id].Attrs["broker"], broker, keys(got))
		}
	}
}

func TestTopicsNeedTheLibraryImport(t *testing.T) {
	got := literalsOf(t, `package x
func f(bus *Bus) { bus.Publish("not.a.topic", nil); _ = Msg{Topic: "nope"} }`)
	if len(got) != 0 {
		t.Fatalf("no broker import → no topics, got %v", keys(got))
	}
}

func TestKafkaTopicRolesSurviveMerge(t *testing.T) {
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "events.go", `package events
import (
  s "github.com/Shopify/sarama"
  k "github.com/segmentio/kafka-go"
  f "github.com/twmb/franz-go/pkg/kgo"
)
func run() {
  _ = s.ProducerMessage{Topic: "shared"}
  _ = k.ReaderConfig{Topic: "shared"}
  _ = k.Writer{Topic: "written"}
  _ = f.ConsumeTopics("consumed")
  _ = f.Record{Topic: "ambiguous-record"}
  _ = k.Message{Topic: "ambiguous-message"}
  _ = k.Writer{Topic: dynamic}
}`, parser.SkipObjectResolution)
	if err != nil {
		t.Fatal(err)
	}
	got := byID(merge(detectLiterals("events.go", fset, file)))
	for topic, roles := range map[string][2]string{
		"shared": {"true", "true"}, "written": {"true", ""},
		"consumed": {"", "true"}, "ambiguous-record": {"", ""},
		"ambiguous-message": {"", ""},
	} {
		e, ok := got["topic:"+topic]
		if !ok || e.Attrs["producer"] != roles[0] || e.Attrs["consumer"] != roles[1] {
			t.Errorf("topic %s: got %+v, want producer=%q consumer=%q", topic, e, roles[0], roles[1])
		}
	}
	if len(got) != 5 || len(got["topic:shared"].Sources) != 2 {
		t.Fatalf("dynamic topics must be ignored and both role sources retained: %+v", got)
	}
}

func TestDetectGoFileMainAndBrokenSource(t *testing.T) {
	got, err := detectGoFile("cmd/api/main.go", []byte("package main\nfunc main() {}\n"))
	if err != nil || byID(got)["service:go:cmd/api"].Label != "api" {
		t.Fatalf("main package must become a service: %v %+v", err, got)
	}
	got, err = detectGoFile("api/routes.go", []byte("package api\nfunc r(m *http.ServeMux) {\n\tm.HandleFunc(\"GET /ok\", ok)\n\tm.HandleFunc(\"GET /half\", \n"))
	if err != nil {
		t.Fatalf("syntax errors must not produce a warning: %v", err)
	}
	if _, ok := byID(got)["route:GET /ok"]; !ok {
		t.Fatalf("the parsed part of a broken file must still be used: %+v", got)
	}
	if _, err := detectGoFile("x.go", []byte("not go at all {{{")); err != nil {
		t.Fatalf("garbage must be ignored silently, got %v", err)
	}
}
