package devcontext

import "testing"

// I topic Rust devono arrivare al Developer Context come entità topic, nella stessa forma di quelle Go.
func TestDetectRustBroker(t *testing.T) {
	src := []byte(`let producer: FutureProducer = config.create().unwrap();
producer.send(FutureRecord::to("orders").payload(&data), Timeout::Never).await?;
`)
	entities := detectRustBroker("src/main.rs", src)
	if len(entities) != 1 || entities[0].Kind != "topic" || entities[0].ID != "topic:orders" {
		t.Fatalf("entities = %+v", entities)
	}
	if entities[0].Attrs["broker"] != "kafka" || entities[0].Attrs["language"] != "rust" {
		t.Fatalf("attrs = %+v", entities[0].Attrs)
	}
}

func TestDetectRustFileYieldsTopics(t *testing.T) {
	src := []byte(`channel.queue_declare("jobs", QueueDeclareOptions::default(), FieldTable::default()).await?;
`)
	entities := detectRustFile("src/main.rs", src)
	kinds := map[string]bool{}
	for _, e := range entities {
		kinds[e.Kind] = true
	}
	if !kinds["topic"] {
		t.Fatalf("a Rust file with a queue must yield a topic: %+v", kinds)
	}
}
