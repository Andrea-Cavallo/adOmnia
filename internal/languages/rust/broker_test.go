package rust

import "testing"

func TestKafkaTopics(t *testing.T) {
	got := BrokerTopicsInFile("src/main.rs", []byte(`let producer: FutureProducer = config.create().unwrap();
producer.send(FutureRecord::to("orders").payload(&data).key("k"), Timeout::Never).await?;

consumer.subscribe(&["orders", "payments"]).unwrap();
`))
	topics := map[string]string{}
	for _, r := range got {
		topics[r.Name] = r.Broker
	}
	if topics["orders"] != "kafka" || topics["payments"] != "kafka" {
		t.Fatalf("topics = %#v (got %+v)", topics, got)
	}
}

func TestRabbitMQQueues(t *testing.T) {
	got := BrokerTopicsInFile("src/main.rs", []byte(`channel.queue_declare("jobs", QueueDeclareOptions::default(), FieldTable::default()).await?;
`))
	if len(got) != 1 || got[0].Broker != "amqp" || got[0].Name != "jobs" {
		t.Fatalf("got = %+v", got)
	}
}

func TestNatsAndRedisPubSub(t *testing.T) {
	nats := BrokerTopicsInFile("src/main.rs", []byte(`let client = async_nats::connect("nats://localhost").await?;
client.subscribe("events").unwrap();
`))
	if len(nats) != 1 || nats[0].Broker != "nats" || nats[0].Name != "events" {
		t.Fatalf("nats = %+v", nats)
	}

	redis := BrokerTopicsInFile("src/main.rs", []byte(`let mut conn = redis::Client::open("redis://localhost").unwrap();
let mut pubsub = conn.get_async_pubsub().await?;
pubsub.subscribe("updates").await?;
`))
	if len(redis) != 1 || redis[0].Broker != "redis" || redis[0].Name != "updates" {
		t.Fatalf("redis = %+v", redis)
	}
}

func TestDeduplicatesTopics(t *testing.T) {
	got := BrokerTopicsInFile("src/main.rs", []byte(`producer.send(FutureRecord::to("orders"), Timeout::Never).await?;
producer.send(FutureRecord::to("orders"), Timeout::Never).await?;
`))
	if len(got) != 1 {
		t.Fatalf("got = %+v", got)
	}
}

func TestNoTopicsWithoutBrokerCalls(t *testing.T) {
	got := BrokerTopicsInFile("src/main.rs", []byte("fn main() {}\n"))
	if len(got) != 0 {
		t.Fatalf("got = %+v", got)
	}
}
