package golang

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"adomnia/internal/ide/graph"
)

func TestNATSAndAMQPTopics(t *testing.T) {
	report, root := loadFixture(t, map[string]string{
		"go.mod":                 "module example.com/events\n\ngo 1.22\n\nrequire (\n\tgithub.com/nats-io/nats.go v0.0.0\n\tgithub.com/rabbitmq/amqp091-go v0.0.0\n)\n\nreplace github.com/nats-io/nats.go => ./third_party/nats\n\nreplace github.com/rabbitmq/amqp091-go => ./third_party/amqp\n",
		"third_party/nats/go.mod": "module github.com/nats-io/nats.go\n\ngo 1.22\n",
		"third_party/nats/nats.go": "package nats\n\ntype Msg struct{}\ntype Conn struct{}\ntype Subscription struct{}\nfunc (*Conn) Publish(subject string, data []byte) error { return nil }\nfunc (*Conn) QueueSubscribe(subject, queue string, cb func(*Msg)) (*Subscription, error) { return nil, nil }\n",
		"third_party/amqp/go.mod": "module github.com/rabbitmq/amqp091-go\n\ngo 1.22\n",
		"third_party/amqp/amqp.go": "package amqp091\n\nimport \"context\"\n\ntype Publishing struct{}\ntype Delivery struct{}\ntype Channel struct{}\nfunc (*Channel) PublishWithContext(ctx context.Context, exchange, key string, mandatory, immediate bool, msg Publishing) error { return nil }\nfunc (*Channel) Consume(queue, consumer string, autoAck, exclusive, noLocal, noWait bool, args map[string]any) (<-chan Delivery, error) { return nil, nil }\n",
		"events/events.go": `package events

import (
	"context"

	"github.com/nats-io/nats.go"
	amqp "github.com/rabbitmq/amqp091-go"
)

const subject = "orders.created"

func Announce(nc *nats.Conn) { nc.Publish(subject, nil) }

func Listen(nc *nats.Conn) { nc.QueueSubscribe("orders.created", "billing", func(*nats.Msg) {}) }

func Ship(ctx context.Context, ch *amqp.Channel) { ch.PublishWithContext(ctx, "", "shipping", false, false, amqp.Publishing{}) }

func Work(ch *amqp.Channel) { ch.Consume("shipping", "", false, false, false, false, nil) }
`,
	})
	got := map[string]string{}
	for _, entry := range report.Entries {
		if len(entry.Topics) > 0 {
			got[entry.Kind] = entry.Function + ":" + entry.Topics[0]
		}
	}
	want := map[string]string{"nats-producer": "Announce:orders.created", "nats-consumer": "Listen:orders.created", "amqp-producer": "Ship:shipping", "amqp-consumer": "Work:shipping"}
	for kind, value := range want {
		if got[kind] != value {
			t.Fatalf("%s = %q; all %v", kind, got[kind], got)
		}
	}
	report.Resolve(func(path string, offset int) (string, int, int) {
		data, _ := os.ReadFile(path)
		rel, _ := filepath.Rel(root, path)
		return filepath.ToSlash(rel), bytes.Count(data[:min(offset, len(data))], []byte("\n")) + 1, 1
	})
	g := GraphFromArchitecture(report).Graph()
	index := graph.NewIndex(&g)
	if node, ok := index.Node("topic:nats:orders.created"); !ok || node.Attrs["broker"] != "nats" {
		t.Fatalf("nats topic node: %+v %v", node, ok)
	}
	if len(index.In("topic:amqp:shipping", graph.EdgeProduces)) != 1 || len(index.Out("topic:amqp:shipping", "")) != 0 {
		t.Fatal("amqp producer edge missing")
	}
}
