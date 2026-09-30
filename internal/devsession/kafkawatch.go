package devsession

import (
	"fmt"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/IBM/sarama"
)

const maxWatchedTopics = 20

// KafkaWatch reads new messages of a service's topics while it runs. It uses
// plain partition consumers from the newest offset and no consumer group, so
// it never commits or moves the offsets of real groups.
// ponytail: plaintext brokers only (local dev); SASL/TLS brokers → reuse the
// Broker Studio connection config when someone needs it.
type KafkaWatch struct {
	Brokers []string `json:"brokers"`
	Topics  []string `json:"topics"`
	stop    chan struct{}
	wg      sync.WaitGroup
	closeFn func()
}

// StartKafkaWatch starts watching; onMessage runs on consumer goroutines.
func StartKafkaWatch(brokers, topics []string, onMessage func(Message)) (*KafkaWatch, error) {
	brokers, topics = cleanList(brokers), cleanList(topics)
	if len(brokers) == 0 || len(topics) == 0 {
		return nil, fmt.Errorf("choose at least one broker and one topic")
	}
	if len(topics) > maxWatchedTopics {
		return nil, fmt.Errorf("watch at most %d topics", maxWatchedTopics)
	}
	config := sarama.NewConfig()
	config.ClientID = "adomnia-devsession"
	config.Net.DialTimeout = 5 * time.Second
	config.Consumer.Return.Errors = false
	config.Version = sarama.V2_1_0_0
	consumer, err := sarama.NewConsumer(brokers, config)
	if err != nil {
		return nil, fmt.Errorf("cannot reach Kafka at %s: %w", strings.Join(brokers, ","), err)
	}
	watch := &KafkaWatch{Brokers: brokers, Topics: topics, stop: make(chan struct{})}
	var partitionConsumers []sarama.PartitionConsumer
	for _, topic := range topics {
		partitions, err := consumer.Partitions(topic)
		if err != nil {
			continue // a topic created later is simply not watched
		}
		for _, partition := range partitions {
			pc, err := consumer.ConsumePartition(topic, partition, sarama.OffsetNewest)
			if err != nil {
				continue
			}
			partitionConsumers = append(partitionConsumers, pc)
			watch.wg.Add(1)
			go watch.read(pc, onMessage)
		}
	}
	if len(partitionConsumers) == 0 {
		_ = consumer.Close()
		return nil, fmt.Errorf("none of the topics exist on %s yet", strings.Join(brokers, ","))
	}
	watch.closeFn = func() {
		close(watch.stop)
		for _, pc := range partitionConsumers {
			pc.AsyncClose()
		}
		watch.wg.Wait()
		_ = consumer.Close()
	}
	return watch, nil
}

func (w *KafkaWatch) read(pc sarama.PartitionConsumer, onMessage func(Message)) {
	defer w.wg.Done()
	for {
		select {
		case <-w.stop:
			return
		case msg, ok := <-pc.Messages():
			if !ok {
				return
			}
			onMessage(messageFromSarama(msg))
		}
	}
}

func messageFromSarama(msg *sarama.ConsumerMessage) Message {
	headers := make(map[string]string, len(msg.Headers))
	for _, header := range msg.Headers {
		if header != nil {
			headers[string(header.Key)] = string(header.Value)
		}
	}
	return Message{
		Broker: "kafka", Topic: msg.Topic, Partition: msg.Partition, Offset: msg.Offset,
		Key: string(msg.Key), Headers: headers, Preview: preview(msg.Value), At: msg.Timestamp,
	}
}

func preview(value []byte) string {
	if !utf8.Valid(value) {
		return fmt.Sprintf("(%d bytes, binary)", len(value))
	}
	text := string(value)
	if len(text) > 500 {
		text = text[:500] + "…"
	}
	return text
}

func cleanList(values []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" && !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	return out
}

// Close stops every partition consumer.
func (w *KafkaWatch) Close() {
	if w.closeFn != nil {
		w.closeFn()
	}
}
