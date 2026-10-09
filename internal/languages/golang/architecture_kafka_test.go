package golang

import (
	"context"
	"go/token"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/tools/go/packages"
)

var kafkaFixture = map[string]string{
	"go.mod":                       "module example.com/billing\n\ngo 1.22\n\nrequire github.com/segmentio/kafka-go v0.0.0\n\nreplace github.com/segmentio/kafka-go => ./third_party/kafka\n",
	"third_party/kafka/go.mod":     "module github.com/segmentio/kafka-go\n\ngo 1.22\n",
	"third_party/kafka/kafka.go":   "package kafka\n\nimport \"context\"\n\ntype Message struct{ Topic string; Value []byte }\ntype ReaderConfig struct{ Brokers []string; GroupID, Topic string }\ntype Reader struct{}\nfunc NewReader(ReaderConfig) *Reader { return &Reader{} }\nfunc (*Reader) ReadMessage(context.Context) (Message, error) { return Message{}, nil }\ntype Writer struct{ Topic string }\nfunc (*Writer) WriteMessages(context.Context, ...Message) error { return nil }\n",
	"worker/worker.go": `package worker

import (
	"context"
	"encoding/json"

	kafka "github.com/segmentio/kafka-go"
)

type Invoice struct{ ID int }

func NewReader() *kafka.Reader {
	return kafka.NewReader(kafka.ReaderConfig{GroupID: "billing-worker", Topic: "invoices"})
}

func Consume(ctx context.Context, r *kafka.Reader) (Invoice, error) {
	m, err := r.ReadMessage(ctx)
	var inv Invoice
	if err == nil {
		err = json.Unmarshal(m.Value, &inv)
	}
	return inv, err
}

func Fail(ctx context.Context, w *kafka.Writer, body []byte) error {
	return w.WriteMessages(ctx, kafka.Message{Topic: "invoices.retry.1", Value: body}, kafka.Message{Topic: "invoices.DLQ", Value: body})
}
`,
}

func TestKafkaGroupsSerializersAndTopicRoles(t *testing.T) {
	root := t.TempDir()
	for name, content := range kafkaFixture {
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
	byKind := map[string]ArchEntry{}
	for _, entry := range report.Entries {
		byKind[entry.Kind] = entry
	}
	consumer, producer := byKind["kafka-consumer"], byKind["kafka-producer"]
	if consumer.Group != "billing-worker" || consumer.Serializer != "JSON" {
		t.Fatalf("consumer: %+v", consumer)
	}
	if producer.Group != "" || producer.TopicRoles["invoices.retry.1"] != "retry" || producer.TopicRoles["invoices.DLQ"] != "dead-letter" {
		t.Fatalf("producer: %+v", producer)
	}
	for topic, want := range map[string]string{"orders": "", "orders-dlt": "dead-letter", "orders_dead_letter": "dead-letter", "orders.retries": "retry", "retry-5m": "retry", "retrieve": ""} {
		if got := kafkaTopicRole(topic); got != want {
			t.Errorf("kafkaTopicRole(%q) = %q, want %q", topic, got, want)
		}
	}
}
