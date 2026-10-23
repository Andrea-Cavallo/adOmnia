package rust

import (
	"regexp"
	"strings"
)

// BrokerRef è un topic o una coda dichiarata staticamente in un sorgente Rust (rdkafka, lapin,
// async-nats, redis pub/sub). Solo letterali risolvibili staticamente.
type BrokerRef struct {
	Broker string // "kafka" | "amqp" | "nats" | "redis"
	Name   string
	Line   int
}

var (
	// kafkaRecord è `FutureRecord::to("topic")`.
	kafkaRecord = regexp.MustCompile(`FutureRecord::to\s*\(\s*"([^"]*)"`)
	// kafkaSubscribe è `subscribe(&["topic1", "topic2"])`.
	kafkaSubscribe = regexp.MustCompile(`subscribe\s*\(\s*&\s*\[([^\]]*)\]`)
	// stringLiteral è una stringa `"…"` dentro un array di topic.
	stringLiteral = regexp.MustCompile(`"([^"]*)"`)
	// amqpQueue è `queue_declare("queue", ...)` (lapin).
	amqpQueue = regexp.MustCompile(`queue_declare\s*\(\s*"([^"]*)"`)
	// pubSub è `subscribe("channel")` / `publish("channel", ...)` (async-nats, redis).
	pubSub = regexp.MustCompile(`\b(?:subscribe|publish)\s*\(\s*"([^"]*)"`)
)

// BrokerTopicsInFile estrae topic e code dichiarati staticamente. Il broker di subscribe/publish
// (nats vs redis) si deduce dagli import/uso nel file; kafka e rabbitmq sono inequivocabili.
func BrokerTopicsInFile(relativePath string, data []byte) []BrokerRef {
	source := string(data)
	var refs []BrokerRef
	seen := map[string]bool{}
	emit := func(broker, name string, offset int) {
		if name == "" || seen[broker+":"+name] {
			return
		}
		seen[broker+":"+name] = true
		refs = append(refs, BrokerRef{Broker: broker, Name: name, Line: lineAt(source, offset)})
	}

	for _, loc := range kafkaRecord.FindAllStringSubmatchIndex(source, -1) {
		emit("kafka", source[loc[2]:loc[3]], loc[0])
	}
	for _, loc := range kafkaSubscribe.FindAllStringSubmatchIndex(source, -1) {
		for _, m := range stringLiteral.FindAllStringSubmatch(source[loc[2]:loc[3]], -1) {
			emit("kafka", m[1], loc[0])
		}
	}
	for _, loc := range amqpQueue.FindAllStringSubmatchIndex(source, -1) {
		emit("amqp", source[loc[2]:loc[3]], loc[0])
	}
	pubsubBroker := "nats"
	if strings.Contains(source, "redis") {
		pubsubBroker = "redis"
	}
	for _, loc := range pubSub.FindAllStringSubmatchIndex(source, -1) {
		emit(pubsubBroker, source[loc[2]:loc[3]], loc[0])
	}
	return refs
}
