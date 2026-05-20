package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/IBM/sarama"
)

type KafkaBrokerConfig struct {
	Brokers  []string `json:"brokers"`
	Topic    string   `json:"topic"`
	GroupID  string   `json:"groupId,omitempty"`
	SASL     *SASL    `json:"sasl,omitempty"`
	TLS      bool     `json:"tls"`
	ClientID string   `json:"clientId,omitempty"`
}

type SASL struct {
	Enabled   bool   `json:"enabled"`
	Mechanism string `json:"mechanism"`
	Username  string `json:"username"`
	Password  string `json:"password"`
}

type KafkaProduceRequest struct {
	Config    KafkaBrokerConfig `json:"config"`
	Key       string            `json:"key"`
	Value     string            `json:"value"`
	Headers   map[string]string `json:"headers,omitempty"`
	Partition *int32            `json:"partition,omitempty"`
}

type KafkaConsumeRequest struct {
	Config    KafkaBrokerConfig `json:"config"`
	MaxWait   int               `json:"maxWait"`
	MaxMsgs   int               `json:"maxMsgs"`
	FromStart bool              `json:"fromStart"`
}

type KafkaMessage struct {
	Key       string            `json:"key"`
	Value     string            `json:"value"`
	Partition int32             `json:"partition"`
	Offset    int64             `json:"offset"`
	Timestamp string            `json:"timestamp"`
	Headers   map[string]string `json:"headers,omitempty"`
}

func newSaramaConfig(cfg KafkaBrokerConfig) *sarama.Config {
	sc := sarama.NewConfig()
	sc.Producer.Return.Successes = true
	sc.Producer.Return.Errors = true
	sc.Consumer.Return.Errors = true
	sc.Net.DialTimeout = 10 * time.Second
	sc.Net.ReadTimeout = 10 * time.Second
	sc.Net.WriteTimeout = 10 * time.Second

	if cfg.ClientID != "" {
		sc.ClientID = cfg.ClientID
	} else {
		sc.ClientID = "adomnia"
	}

	if cfg.TLS {
		sc.Net.TLS.Enable = true
	}

	if cfg.SASL != nil && cfg.SASL.Enabled {
		sc.Net.SASL.Enable = true
		sc.Net.SASL.User = cfg.SASL.Username
		sc.Net.SASL.Password = cfg.SASL.Password
		switch cfg.SASL.Mechanism {
		case "SCRAM-SHA-256":
			sc.Net.SASL.Mechanism = sarama.SASLTypeSCRAMSHA256
			sc.Net.SASL.SCRAMClientGeneratorFunc = func() sarama.SCRAMClient {
				return &XDGSCRAMClient{HashGeneratorFcn: SHA256}
			}
		case "SCRAM-SHA-512":
			sc.Net.SASL.Mechanism = sarama.SASLTypeSCRAMSHA512
			sc.Net.SASL.SCRAMClientGeneratorFunc = func() sarama.SCRAMClient {
				return &XDGSCRAMClient{HashGeneratorFcn: SHA512}
			}
		default:
			sc.Net.SASL.Mechanism = sarama.SASLTypePlaintext
		}
	}

	return sc
}

func kafkaProduceHandler(w http.ResponseWriter, r *http.Request) {
	dlog("kafkaProduceHandler", "richiesta produce Kafka ricevuta", map[string]any{"remote": r.RemoteAddr})
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}

	var req KafkaProduceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		dlogErr("kafkaProduceHandler", "decode JSON fallito", err, nil)
		jsonError(w, "invalid JSON: "+err.Error(), 400)
		return
	}
	dlog("kafkaProduceHandler", "payload decodificato", map[string]any{"brokers": req.Config.Brokers, "topic": req.Config.Topic, "key": req.Key})

	if len(req.Config.Brokers) == 0 || req.Config.Topic == "" {
		jsonError(w, "brokers and topic required", 400)
		return
	}

	sc := newSaramaConfig(req.Config)
	producer, err := sarama.NewSyncProducer(req.Config.Brokers, sc)
	if err != nil {
		dlogErr("kafkaProduceHandler", "connessione al broker Kafka fallita", err, map[string]any{"brokers": req.Config.Brokers})
		jsonError(w, "connect failed: "+err.Error(), 502)
		return
	}
	defer producer.Close()

	msg := &sarama.ProducerMessage{
		Topic: req.Config.Topic,
		Value: sarama.StringEncoder(req.Value),
	}
	if req.Key != "" {
		msg.Key = sarama.StringEncoder(req.Key)
	}
	if req.Partition != nil {
		msg.Partition = *req.Partition
	}
	for k, v := range req.Headers {
		msg.Headers = append(msg.Headers, sarama.RecordHeader{
			Key:   []byte(k),
			Value: []byte(v),
		})
	}

	partition, offset, err := producer.SendMessage(msg)
	if err != nil {
		jsonError(w, "produce failed: "+err.Error(), 502)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":        true,
		"partition": partition,
		"offset":    offset,
		"topic":     req.Config.Topic,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

type KafkaBulkProduceRequest struct {
	Config    KafkaBrokerConfig `json:"config"`
	Key       string            `json:"key"`
	Value     string            `json:"value"`
	Headers   map[string]string `json:"headers,omitempty"`
	Count     int               `json:"count"`
	DelayMs   int               `json:"delayMs"`
	VaryField string            `json:"varyField"`
}

func kafkaBulkProduceHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}

	var req KafkaBulkProduceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid JSON: "+err.Error(), 400)
		return
	}

	if len(req.Config.Brokers) == 0 || req.Config.Topic == "" {
		jsonError(w, "brokers and topic required", 400)
		return
	}
	if req.Count < 1 {
		req.Count = 10
	}
	if req.Count > 10000 {
		req.Count = 10000
	}

	sc := newSaramaConfig(req.Config)
	producer, err := sarama.NewSyncProducer(req.Config.Brokers, sc)
	if err != nil {
		jsonError(w, "connect failed: "+err.Error(), 502)
		return
	}
	defer producer.Close()

	start := time.Now()
	successes := 0
	failures := 0
	var lastPartition int32
	var lastOffset int64

	delay := time.Duration(req.DelayMs) * time.Millisecond

	for i := 0; i < req.Count; i++ {
		value := req.Value
		key := req.Key

		if req.VaryField != "" {
			value = varyJsonField(value, req.VaryField, i)
		}
		if key != "" {
			key = fmt.Sprintf("%s-%d", key, i)
		}

		msg := &sarama.ProducerMessage{
			Topic: req.Config.Topic,
			Value: sarama.StringEncoder(value),
		}
		if key != "" {
			msg.Key = sarama.StringEncoder(key)
		}
		for k, v := range req.Headers {
			msg.Headers = append(msg.Headers, sarama.RecordHeader{
				Key:   []byte(k),
				Value: []byte(v),
			})
		}

		partition, offset, err := producer.SendMessage(msg)
		if err != nil {
			failures++
		} else {
			successes++
			lastPartition = partition
			lastOffset = offset
		}

		if delay > 0 && i < req.Count-1 {
			time.Sleep(delay)
		}
	}

	totalMs := float64(time.Since(start).Microseconds()) / 1000.0
	throughput := 0.0
	if totalMs > 0 {
		throughput = float64(req.Count) / (totalMs / 1000.0)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":            true,
		"count":         req.Count,
		"successes":     successes,
		"failures":      failures,
		"totalMs":       int64(totalMs),
		"throughput":    int64(throughput),
		"lastPartition": lastPartition,
		"lastOffset":    lastOffset,
		"topic":         req.Config.Topic,
	})
}

func varyJsonField(jsonStr, field string, idx int) string {
	var data map[string]interface{}
	if err := json.Unmarshal([]byte(jsonStr), &data); err != nil {
		return jsonStr
	}

	if _, exists := data[field]; exists {
		switch v := data[field].(type) {
		case string:
			data[field] = fmt.Sprintf("%s-%d", v, idx)
		case float64:
			data[field] = v + float64(idx)
		default:
			data[field] = fmt.Sprintf("%v-%d", v, idx)
		}
	} else {
		data[field] = fmt.Sprintf("item-%d", idx)
	}

	out, err := json.Marshal(data)
	if err != nil {
		return jsonStr
	}
	return string(out)
}

func kafkaConsumeHandler(w http.ResponseWriter, r *http.Request) {
	dlog("kafkaConsumeHandler", "richiesta consume Kafka ricevuta", map[string]any{"remote": r.RemoteAddr})
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}

	var req KafkaConsumeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		dlogErr("kafkaConsumeHandler", "decode JSON fallito", err, nil)
		jsonError(w, "invalid JSON: "+err.Error(), 400)
		return
	}
	dlog("kafkaConsumeHandler", "parametri consume decodificati", map[string]any{
		"brokers":   req.Config.Brokers,
		"topic":     req.Config.Topic,
		"maxMsgs":   req.MaxMsgs,
		"fromStart": req.FromStart,
	})

	if len(req.Config.Brokers) == 0 || req.Config.Topic == "" {
		jsonError(w, "brokers and topic required", 400)
		return
	}

	maxWait := req.MaxWait
	if maxWait <= 0 || maxWait > 30 {
		maxWait = 5
	}
	maxMsgs := req.MaxMsgs
	if maxMsgs <= 0 || maxMsgs > 100 {
		maxMsgs = 10
	}

	sc := newSaramaConfig(req.Config)
	if req.FromStart {
		sc.Consumer.Offsets.Initial = sarama.OffsetOldest
	} else {
		sc.Consumer.Offsets.Initial = sarama.OffsetNewest
	}

	groupID := req.Config.GroupID
	if groupID == "" {
		groupID = fmt.Sprintf("adomnia-consumer-%d", time.Now().UnixNano())
	}

	group, err := sarama.NewConsumerGroup(req.Config.Brokers, groupID, sc)
	if err != nil {
		jsonError(w, "connect failed: "+err.Error(), 502)
		return
	}
	defer group.Close()

	ctx, cancel := context.WithTimeout(r.Context(), time.Duration(maxWait)*time.Second)
	defer cancel()

	handler := &consumerGroupHandler{
		maxMsgs:  maxMsgs,
		messages: make([]KafkaMessage, 0, maxMsgs),
		done:     make(chan struct{}),
	}

	go func() {
		_ = group.Consume(ctx, []string{req.Config.Topic}, handler)
	}()

	select {
	case <-handler.done:
	case <-ctx.Done():
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":       true,
		"messages": handler.getMessages(),
		"count":    len(handler.getMessages()),
	})
}

func kafkaTopicsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}

	var cfg KafkaBrokerConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		jsonError(w, "invalid JSON: "+err.Error(), 400)
		return
	}

	if len(cfg.Brokers) == 0 {
		jsonError(w, "brokers required", 400)
		return
	}

	sc := newSaramaConfig(cfg)
	client, err := sarama.NewClient(cfg.Brokers, sc)
	if err != nil {
		jsonError(w, "connect failed: "+err.Error(), 502)
		return
	}
	defer client.Close()

	topics, err := client.Topics()
	if err != nil {
		jsonError(w, "list topics failed: "+err.Error(), 502)
		return
	}

	brokerList := make([]map[string]interface{}, 0)
	for _, b := range client.Brokers() {
		brokerList = append(brokerList, map[string]interface{}{
			"id":   b.ID(),
			"addr": b.Addr(),
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":      true,
		"topics":  topics,
		"brokers": brokerList,
	})
}

func jsonError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":    false,
		"error": msg,
	})
}

type consumerGroupHandler struct {
	maxMsgs  int
	mu       sync.Mutex
	messages []KafkaMessage
	done     chan struct{}
	closed   bool
}

func (h *consumerGroupHandler) Setup(_ sarama.ConsumerGroupSession) error   { return nil }
func (h *consumerGroupHandler) Cleanup(_ sarama.ConsumerGroupSession) error { return nil }
func (h *consumerGroupHandler) ConsumeClaim(session sarama.ConsumerGroupSession, claim sarama.ConsumerGroupClaim) error {
	for msg := range claim.Messages() {
		h.mu.Lock()
		if len(h.messages) >= h.maxMsgs {
			h.mu.Unlock()
			if !h.closed {
				h.closed = true
				close(h.done)
			}
			return nil
		}

		headers := make(map[string]string)
		for _, hdr := range msg.Headers {
			headers[string(hdr.Key)] = string(hdr.Value)
		}

		h.messages = append(h.messages, KafkaMessage{
			Key:       string(msg.Key),
			Value:     string(msg.Value),
			Partition: msg.Partition,
			Offset:    msg.Offset,
			Timestamp: msg.Timestamp.UTC().Format(time.RFC3339),
			Headers:   headers,
		})
		h.mu.Unlock()
		session.MarkMessage(msg, "")
	}
	return nil
}

func (h *consumerGroupHandler) getMessages() []KafkaMessage {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.messages
}
