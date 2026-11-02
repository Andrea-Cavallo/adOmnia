package kafka

import (
	"context"
	"testing"

	"github.com/IBM/sarama"
)

func TestMessagesSinceReturnsOnlyWhatWasProducedAfterTheMarks(t *testing.T) {
	broker := sarama.NewMockBroker(t, 1)
	defer broker.Close()
	// Advertise every API so the client skips no request (the default mock lists only two).
	keys := make([]sarama.ApiVersionsResponseKey, 0, 70)
	for key := range int16(70) {
		keys = append(keys, sarama.ApiVersionsResponseKey{ApiKey: key, MaxVersion: 20})
	}
	apiVersions := sarama.NewMockApiVersionsResponse(t).SetApiKeys(keys)
	metadata := sarama.NewMockMetadataResponse(t).SetBroker(broker.Addr(), broker.BrokerID()).SetLeader("orders", 0, broker.BrokerID())
	broker.SetHandlerByMap(map[string]sarama.MockResponse{
		"ApiVersionsRequest": apiVersions,
		"MetadataRequest":    metadata,
		"OffsetRequest":      sarama.NewMockOffsetResponse(t).SetOffset("orders", 0, sarama.OffsetNewest, 5).SetOffset("orders", 0, sarama.OffsetOldest, 0),
	})
	brokers := []string{broker.Addr()}
	marks, err := MarkTopics(brokers, []string{"orders"})
	if err != nil || marks["orders"][0] != 5 {
		t.Fatalf("marks = %v, %v", marks, err)
	}

	// The service under test produces two messages: offsets 5 and 6.
	broker.SetHandlerByMap(map[string]sarama.MockResponse{
		"ApiVersionsRequest": apiVersions,
		"MetadataRequest":    metadata,
		"OffsetRequest":      sarama.NewMockOffsetResponse(t).SetOffset("orders", 0, sarama.OffsetNewest, 7).SetOffset("orders", 0, sarama.OffsetOldest, 0),
		"FetchRequest": sarama.NewMockFetchResponse(t, 1).
			SetMessage("orders", 0, 5, sarama.StringEncoder(`{"id":1}`)).
			SetMessage("orders", 0, 6, sarama.StringEncoder(`{"id":2}`)).
			SetHighWaterMark("orders", 0, 7),
	})
	messages, dropped, err := MessagesSince(context.Background(), brokers, marks, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 1 || messages[0].Offset != 5 || messages[0].Value != `{"id":1}` || dropped != 1 {
		t.Fatalf("messages = %+v, dropped = %d", messages, dropped)
	}
}
