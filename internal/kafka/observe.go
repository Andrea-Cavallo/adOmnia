package kafka

import (
	"context"
	"time"

	"github.com/IBM/sarama"
)

// TopicMarks is a cursor over some topics: the next offset of every partition when it was taken.
type TopicMarks map[string]map[int32]int64

// MarkTopics records where each partition of topics ends now, so MessagesSince can return
// only what was produced afterwards (an Agent Task verification observing the code under test).
func MarkTopics(brokers, topics []string) (TopicMarks, error) {
	client, err := sarama.NewClient(brokers, newSaramaConfig(KafkaBrokerConfig{Brokers: brokers}))
	if err != nil {
		return nil, err
	}
	defer client.Close()
	marks := make(TopicMarks, len(topics))
	for _, topic := range topics {
		partitions, err := client.Partitions(topic)
		if err != nil {
			return nil, err
		}
		marks[topic] = make(map[int32]int64, len(partitions))
		for _, partition := range partitions {
			next, err := client.GetOffset(topic, partition, sarama.OffsetNewest)
			if err != nil {
				return nil, err
			}
			marks[topic][partition] = next
		}
	}
	return marks, nil
}

// ObservedMessage is a message produced on a watched topic after the marks.
type ObservedMessage struct {
	Topic string `json:"topic"`
	KafkaMessage
}

// MessagesSince reads the messages produced after marks, at most limit, oldest offset first per
// partition. dropped counts messages beyond limit that were produced but not read.
func MessagesSince(ctx context.Context, brokers []string, marks TopicMarks, limit int) (messages []ObservedMessage, dropped int64, err error) {
	client, err := sarama.NewClient(brokers, newSaramaConfig(KafkaBrokerConfig{Brokers: brokers}))
	if err != nil {
		return nil, 0, err
	}
	defer client.Close()
	consumer, err := sarama.NewConsumerFromClient(client)
	if err != nil {
		return nil, 0, err
	}
	defer consumer.Close()
	for topic, partitions := range marks {
		for partition, from := range partitions {
			end, err := client.GetOffset(topic, partition, sarama.OffsetNewest)
			if err != nil {
				return messages, dropped, err
			}
			wanted := end - from
			if wanted <= 0 {
				continue
			}
			room := int64(limit - len(messages))
			if wanted > room {
				dropped += wanted - room
				wanted = room
			}
			if wanted <= 0 {
				continue
			}
			read, err := readRange(ctx, consumer, topic, partition, from, wanted)
			messages = append(messages, read...)
			if err != nil {
				return messages, dropped, err
			}
		}
	}
	return messages, dropped, nil
}

func readRange(ctx context.Context, consumer sarama.Consumer, topic string, partition int32, from, count int64) ([]ObservedMessage, error) {
	pc, err := consumer.ConsumePartition(topic, partition, from)
	if err != nil {
		return nil, err
	}
	defer pc.Close()
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	read := make([]ObservedMessage, 0, count)
	for int64(len(read)) < count {
		select {
		case msg := <-pc.Messages():
			if msg == nil {
				return read, nil
			}
			read = append(read, ObservedMessage{Topic: topic, KafkaMessage: kafkaMessageFromSarama(msg)})
		case <-ctx.Done():
			return read, ctx.Err()
		}
	}
	return read, nil
}
