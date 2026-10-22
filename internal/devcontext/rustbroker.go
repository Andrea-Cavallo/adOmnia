package devcontext

import (
	"bytes"
	"strconv"

	"adomnia/internal/languages/rust"
)

// detectRustBroker: topic e code di rdkafka/lapin/async-nats/redis diventano entità topic come
// quelle Go, così il KafkaPanel e il Broker Studio li leggono a prescindere dal linguaggio.
func detectRustBroker(rel string, data []byte) []Entity {
	if !bytes.Contains(data, []byte("FutureRecord")) && !bytes.Contains(data, []byte("queue_declare")) &&
		!bytes.Contains(data, []byte("subscribe")) && !bytes.Contains(data, []byte("publish")) {
		return nil
	}
	var out []Entity
	for _, ref := range rust.BrokerTopicsInFile(rel, data) {
		out = append(out, entity("topic", ref.Name, ref.Name, ConfidenceInferred,
			map[string]string{"broker": ref.Broker, "language": "rust", "declFile": rel, "declLine": strconv.Itoa(ref.Line)},
			Source{"rustbroker", rel, ref.Line}))
	}
	return out
}
