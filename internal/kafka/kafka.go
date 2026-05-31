package kafka

import (
	"adomnia/internal/devlog"
	"adomnia/internal/httputil"
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	hdr "github.com/HdrHistogram/hdrhistogram-go"
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

type KafkaAdminRequest struct {
	Config KafkaBrokerConfig `json:"config"`
}

type KafkaTopicAdminRequest struct {
	Config            KafkaBrokerConfig `json:"config"`
	Topic             string            `json:"topic"`
	Partitions        int32             `json:"partitions,omitempty"`
	ReplicationFactor int16             `json:"replicationFactor,omitempty"`
	Configs           map[string]string `json:"configs,omitempty"`
	DeleteConfigs     []string          `json:"deleteConfigs,omitempty"`
	ValidateOnly      bool              `json:"validateOnly,omitempty"`
}

type KafkaConsumerGroupRequest struct {
	Config KafkaBrokerConfig `json:"config"`
	Group  string            `json:"group,omitempty"`
	Topic  string            `json:"topic,omitempty"`
}

type KafkaResetOffsetRequest struct {
	Config    KafkaBrokerConfig `json:"config"`
	Group     string            `json:"group"`
	Topic     string            `json:"topic"`
	Partition int32             `json:"partition"`
	Mode      string            `json:"mode"`
	Offset    int64             `json:"offset,omitempty"`
}

type KafkaBrowseRequest struct {
	Config        KafkaBrokerConfig `json:"config"`
	Topic         string            `json:"topic"`
	Partition     *int32            `json:"partition,omitempty"`
	Offset        *int64            `json:"offset,omitempty"`
	TimestampMs   *int64            `json:"timestampMs,omitempty"`
	MaxMsgs       int               `json:"maxMsgs"`
	Tail          bool              `json:"tail"`
	MaxWait       int               `json:"maxWait"`
	KeyContains   string            `json:"keyContains,omitempty"`
	ValueContains string            `json:"valueContains,omitempty"`
	HeaderKey     string            `json:"headerKey,omitempty"`
	HeaderValue   string            `json:"headerValue,omitempty"`
}

func newSaramaConfig(cfg KafkaBrokerConfig) *sarama.Config {
	sc := sarama.NewConfig()
	sc.Version = sarama.V2_8_0_0
	sc.Metadata.Full = true
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
	devlog.Log("kafkaProduceHandler", "richiesta produce Kafka ricevuta", map[string]any{"remote": r.RemoteAddr})
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}

	var req KafkaProduceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		devlog.Err("kafkaProduceHandler", "decode JSON fallito", err, nil)
		httputil.JSONError(w, "invalid JSON: "+err.Error(), 400)
		return
	}
	devlog.Log("kafkaProduceHandler", "payload decodificato", map[string]any{"brokers": req.Config.Brokers, "topic": req.Config.Topic, "key": req.Key})

	if len(req.Config.Brokers) == 0 || req.Config.Topic == "" {
		httputil.JSONError(w, "brokers and topic required", 400)
		return
	}

	sc := newSaramaConfig(req.Config)
	producer, err := sarama.NewSyncProducer(req.Config.Brokers, sc)
	if err != nil {
		devlog.Err("kafkaProduceHandler", "connessione al broker Kafka fallita", err, map[string]any{"brokers": req.Config.Brokers})
		httputil.JSONError(w, "connect failed: "+err.Error(), 502)
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
		httputil.JSONError(w, "produce failed: "+err.Error(), 502)
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

type KafkaLoadTestRequest struct {
	Config      KafkaBrokerConfig `json:"config"`
	Key         string            `json:"key"`
	Value       string            `json:"value"`
	Headers     map[string]string `json:"headers,omitempty"`
	Concurrency int               `json:"concurrency"`
	TotalMsgs   int               `json:"totalMsgs"`
	DurationS   int               `json:"durationS"`
	RampUpMs    int               `json:"rampUpMs"`
	VaryField   string            `json:"varyField"`
}

type KafkaLoadTestResult struct {
	OK                 bool               `json:"ok"`
	Topic              string             `json:"topic"`
	Concurrency        int                `json:"concurrency"`
	TotalMessages      int                `json:"totalMessages"`
	Successful         int                `json:"successes"`
	Failed             int                `json:"failures"`
	TotalMs            float64            `json:"totalMs"`
	AvgMs              float64            `json:"avgMs"`
	P50Ms              float64            `json:"p50Ms"`
	P95Ms              float64            `json:"p95Ms"`
	P99Ms              float64            `json:"p99Ms"`
	Throughput         float64            `json:"throughput"`
	ErrorRate          float64            `json:"errorRate"`
	ThroughputTimeline []throughputBucket `json:"throughputTimeline,omitempty"`
	Errors             []string           `json:"errors,omitempty"`
}

type throughputBucket struct {
	Second int     `json:"second"`
	Reqs   int     `json:"reqs"`
	AvgMs  float64 `json:"avgMs"`
}

func kafkaBulkProduceHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}

	var req KafkaBulkProduceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.JSONError(w, "invalid JSON: "+err.Error(), 400)
		return
	}

	if len(req.Config.Brokers) == 0 || req.Config.Topic == "" {
		httputil.JSONError(w, "brokers and topic required", 400)
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
		httputil.JSONError(w, "connect failed: "+err.Error(), 502)
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

func kafkaLoadTestHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}

	var req KafkaLoadTestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.JSONError(w, "invalid JSON: "+err.Error(), 400)
		return
	}
	if len(req.Config.Brokers) == 0 || req.Config.Topic == "" {
		httputil.JSONError(w, "brokers and topic required", 400)
		return
	}
	if req.Concurrency < 1 {
		req.Concurrency = 1
	}
	if req.Concurrency > 100 {
		req.Concurrency = 100
	}
	if req.DurationS < 0 {
		req.DurationS = 0
	}
	if req.DurationS > 300 {
		req.DurationS = 300
	}
	if req.DurationS == 0 {
		if req.TotalMsgs < 1 {
			req.TotalMsgs = 1000
		}
		if req.TotalMsgs > 100000 {
			req.TotalMsgs = 100000
		}
	}
	if req.RampUpMs < 0 {
		req.RampUpMs = 0
	}

	producer, err := sarama.NewSyncProducer(req.Config.Brokers, newSaramaConfig(req.Config))
	if err != nil {
		httputil.JSONError(w, "connect failed: "+err.Error(), 502)
		return
	}
	defer producer.Close()

	start := time.Now()
	var sequence atomic.Int64
	var mu sync.Mutex
	hist := hdr.New(1, 60000, 3)
	successes := 0
	failures := 0
	errorSamples := make([]string, 0, 3)
	buckets := make(map[int]struct {
		count   int
		totalMs float64
	})
	var deadline time.Time
	if req.DurationS > 0 {
		deadline = start.Add(time.Duration(req.DurationS) * time.Second)
	}

	var wg sync.WaitGroup
	for worker := 0; worker < req.Concurrency; worker++ {
		wg.Add(1)
		go func(workerIndex int) {
			defer wg.Done()
			if req.RampUpMs > 0 && req.Concurrency > 1 {
				delay := time.Duration(req.RampUpMs*workerIndex/(req.Concurrency-1)) * time.Millisecond
				time.Sleep(delay)
			}
			for {
				if req.DurationS > 0 && time.Now().After(deadline) {
					return
				}
				var idx int
				if req.DurationS == 0 {
					var ok bool
					idx, ok = reserveKafkaMessageIndex(&sequence, req.TotalMsgs)
					if !ok {
						return
					}
				} else {
					idx = int(sequence.Add(1) - 1)
				}

				value := req.Value
				key := req.Key
				if req.VaryField != "" {
					value = varyJsonField(value, req.VaryField, idx)
				}
				if key != "" {
					key = fmt.Sprintf("%s-%d", key, idx)
				}
				msg := &sarama.ProducerMessage{Topic: req.Config.Topic, Value: sarama.StringEncoder(value)}
				if key != "" {
					msg.Key = sarama.StringEncoder(key)
				}
				for k, v := range req.Headers {
					msg.Headers = append(msg.Headers, sarama.RecordHeader{Key: []byte(k), Value: []byte(v)})
				}

				msgStart := time.Now()
				_, _, sendErr := producer.SendMessage(msg)
				latencyMs := float64(time.Since(msgStart).Microseconds()) / 1000
				if latencyMs < 1 {
					latencyMs = 1
				}
				second := int(time.Since(start).Seconds())

				mu.Lock()
				_ = hist.RecordValue(int64(latencyMs))
				bucket := buckets[second]
				bucket.count++
				bucket.totalMs += latencyMs
				buckets[second] = bucket
				if sendErr != nil {
					failures++
					if len(errorSamples) < cap(errorSamples) {
						errorSamples = append(errorSamples, sendErr.Error())
					}
				} else {
					successes++
				}
				mu.Unlock()
			}
		}(worker)
	}
	wg.Wait()

	totalMs := float64(time.Since(start).Microseconds()) / 1000
	total := successes + failures
	timeline := make([]throughputBucket, 0, len(buckets))
	for second := 0; second <= int(totalMs/1000); second++ {
		if bucket, ok := buckets[second]; ok {
			timeline = append(timeline, throughputBucket{
				Second: second,
				Reqs:   bucket.count,
				AvgMs:  math.Round(bucket.totalMs/float64(bucket.count)*100) / 100,
			})
		}
	}
	result := KafkaLoadTestResult{
		OK:                 failures == 0,
		Topic:              req.Config.Topic,
		Concurrency:        req.Concurrency,
		TotalMessages:      total,
		Successful:         successes,
		Failed:             failures,
		TotalMs:            math.Round(totalMs*100) / 100,
		ThroughputTimeline: timeline,
		Errors:             errorSamples,
	}
	if total > 0 {
		result.AvgMs = math.Round(hist.Mean()*100) / 100
		result.P50Ms = float64(hist.ValueAtQuantile(50))
		result.P95Ms = float64(hist.ValueAtQuantile(95))
		result.P99Ms = float64(hist.ValueAtQuantile(99))
		result.ErrorRate = math.Round(float64(failures)/float64(total)*10000) / 100
	}
	if totalMs > 0 {
		result.Throughput = math.Round(float64(total)/(totalMs/1000)*100) / 100
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func reserveKafkaMessageIndex(sequence *atomic.Int64, total int) (int, bool) {
	for {
		current := sequence.Load()
		if current >= int64(total) {
			return 0, false
		}
		if sequence.CompareAndSwap(current, current+1) {
			return int(current), true
		}
	}
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
	devlog.Log("kafkaConsumeHandler", "richiesta consume Kafka ricevuta", map[string]any{"remote": r.RemoteAddr})
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}

	var req KafkaConsumeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		devlog.Err("kafkaConsumeHandler", "decode JSON fallito", err, nil)
		httputil.JSONError(w, "invalid JSON: "+err.Error(), 400)
		return
	}
	devlog.Log("kafkaConsumeHandler", "parametri consume decodificati", map[string]any{
		"brokers":   req.Config.Brokers,
		"topic":     req.Config.Topic,
		"maxMsgs":   req.MaxMsgs,
		"fromStart": req.FromStart,
	})

	if len(req.Config.Brokers) == 0 || req.Config.Topic == "" {
		httputil.JSONError(w, "brokers and topic required", 400)
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
		httputil.JSONError(w, "connect failed: "+err.Error(), 502)
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
		httputil.JSONError(w, "invalid JSON: "+err.Error(), 400)
		return
	}

	if len(cfg.Brokers) == 0 {
		httputil.JSONError(w, "brokers required", 400)
		return
	}

	sc := newSaramaConfig(cfg)
	client, err := sarama.NewClient(cfg.Brokers, sc)
	if err != nil {
		httputil.JSONError(w, "connect failed: "+err.Error(), 502)
		return
	}
	defer client.Close()

	topics, err := client.Topics()
	if err != nil {
		httputil.JSONError(w, "list topics failed: "+err.Error(), 502)
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

func kafkaAdminAndClient(cfg KafkaBrokerConfig) (sarama.ClusterAdmin, sarama.Client, error) {
	sc := newSaramaConfig(cfg)
	client, err := sarama.NewClient(cfg.Brokers, sc)
	if err != nil {
		return nil, nil, err
	}
	admin, err := sarama.NewClusterAdminFromClient(client)
	if err != nil {
		_ = client.Close()
		return nil, nil, err
	}
	return admin, client, nil
}

func kafkaClusterOverviewHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req KafkaAdminRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.JSONError(w, "invalid JSON: "+err.Error(), 400)
		return
	}
	if len(req.Config.Brokers) == 0 {
		httputil.JSONError(w, "brokers required", 400)
		return
	}

	admin, client, err := kafkaAdminAndClient(req.Config)
	if err != nil {
		httputil.JSONError(w, "connect failed: "+err.Error(), 502)
		return
	}
	defer admin.Close()
	defer client.Close()

	clusterBrokers, controllerID, err := admin.DescribeCluster()
	if err != nil {
		httputil.JSONError(w, "cluster overview failed: "+err.Error(), 502)
		return
	}
	topics, err := admin.ListTopics()
	if err != nil {
		httputil.JSONError(w, "list topics failed: "+err.Error(), 502)
		return
	}

	partitionCount := 0
	internalTopics := 0
	underReplicated := 0
	offlinePartitions := 0
	topicNames := make([]string, 0, len(topics))
	for name, detail := range topics {
		topicNames = append(topicNames, name)
		if len(name) > 0 && name[0] == '_' {
			internalTopics++
		}
		partitionCount += int(detail.NumPartitions)
	}
	sort.Strings(topicNames)
	metadata, _ := admin.DescribeTopics(topicNames)
	for _, topic := range metadata {
		for _, partition := range topic.Partitions {
			if partition.Leader < 0 || len(partition.OfflineReplicas) > 0 {
				offlinePartitions++
			}
			if len(partition.Isr) < len(partition.Replicas) {
				underReplicated++
			}
		}
	}

	brokers := make([]map[string]interface{}, 0, len(clusterBrokers))
	for _, broker := range clusterBrokers {
		brokers = append(brokers, map[string]interface{}{
			"id":         broker.ID(),
			"addr":       broker.Addr(),
			"controller": broker.ID() == controllerID,
		})
	}

	health := "healthy"
	if offlinePartitions > 0 {
		health = "critical"
	} else if underReplicated > 0 {
		health = "degraded"
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":                 true,
		"health":             health,
		"controllerId":       controllerID,
		"brokerCount":        len(brokers),
		"topicCount":         len(topics),
		"internalTopicCount": internalTopics,
		"partitionCount":     partitionCount,
		"underReplicated":    underReplicated,
		"offlinePartitions":  offlinePartitions,
		"brokers":            brokers,
		"topics":             topicNames,
	})
}

func kafkaTopicDetailHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req KafkaTopicAdminRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.JSONError(w, "invalid JSON: "+err.Error(), 400)
		return
	}
	if len(req.Config.Brokers) == 0 || req.Topic == "" {
		httputil.JSONError(w, "brokers and topic required", 400)
		return
	}

	admin, client, err := kafkaAdminAndClient(req.Config)
	if err != nil {
		httputil.JSONError(w, "connect failed: "+err.Error(), 502)
		return
	}
	defer admin.Close()
	defer client.Close()

	metadata, err := admin.DescribeTopics([]string{req.Topic})
	if err != nil {
		httputil.JSONError(w, "describe topic failed: "+err.Error(), 502)
		return
	}
	if len(metadata) == 0 || metadata[0].Err != sarama.ErrNoError {
		httputil.JSONError(w, "topic not found or unavailable", 404)
		return
	}

	offsetReq := map[string]map[int32]int64{req.Topic: {}}
	for _, partition := range metadata[0].Partitions {
		offsetReq[req.Topic][partition.ID] = sarama.OffsetNewest
	}
	newest, _ := admin.ListOffsets(offsetReq, nil)
	for partition := range offsetReq[req.Topic] {
		offsetReq[req.Topic][partition] = sarama.OffsetOldest
	}
	oldest, _ := admin.ListOffsets(offsetReq, nil)

	partitions := make([]map[string]interface{}, 0, len(metadata[0].Partitions))
	for _, partition := range metadata[0].Partitions {
		latestOffset := int64(-1)
		oldestOffset := int64(-1)
		if newest[req.Topic] != nil && newest[req.Topic][partition.ID] != nil {
			latestOffset = newest[req.Topic][partition.ID].Offset
		}
		if oldest[req.Topic] != nil && oldest[req.Topic][partition.ID] != nil {
			oldestOffset = oldest[req.Topic][partition.ID].Offset
		}
		partitions = append(partitions, map[string]interface{}{
			"id":              partition.ID,
			"leader":          partition.Leader,
			"replicas":        partition.Replicas,
			"isr":             partition.Isr,
			"offlineReplicas": partition.OfflineReplicas,
			"oldestOffset":    oldestOffset,
			"latestOffset":    latestOffset,
			"messages":        maxInt64(0, latestOffset-oldestOffset),
		})
	}
	sort.Slice(partitions, func(i, j int) bool { return partitions[i]["id"].(int32) < partitions[j]["id"].(int32) })

	configEntries, err := admin.DescribeConfig(sarama.ConfigResource{Type: sarama.TopicResource, Name: req.Topic})
	if err != nil {
		httputil.JSONError(w, "describe topic configs failed: "+err.Error(), 502)
		return
	}
	configs := make([]map[string]interface{}, 0, len(configEntries))
	for _, entry := range configEntries {
		configs = append(configs, map[string]interface{}{
			"name":      entry.Name,
			"value":     entry.Value,
			"readOnly":  entry.ReadOnly,
			"default":   entry.Default,
			"source":    entry.Source.String(),
			"sensitive": entry.Sensitive,
		})
	}
	sort.Slice(configs, func(i, j int) bool { return configs[i]["name"].(string) < configs[j]["name"].(string) })

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":         true,
		"topic":      req.Topic,
		"isInternal": metadata[0].IsInternal,
		"partitions": partitions,
		"configs":    configs,
	})
}

func kafkaCreateTopicHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req KafkaTopicAdminRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.JSONError(w, "invalid JSON: "+err.Error(), 400)
		return
	}
	if len(req.Config.Brokers) == 0 || req.Topic == "" {
		httputil.JSONError(w, "brokers and topic required", 400)
		return
	}
	if req.Partitions < 1 {
		req.Partitions = 1
	}
	if req.ReplicationFactor < 1 {
		req.ReplicationFactor = 1
	}
	configEntries := make(map[string]*string)
	for key, value := range req.Configs {
		configValue := value
		configEntries[key] = &configValue
	}
	admin, client, err := kafkaAdminAndClient(req.Config)
	if err != nil {
		httputil.JSONError(w, "connect failed: "+err.Error(), 502)
		return
	}
	defer admin.Close()
	defer client.Close()

	err = admin.CreateTopic(req.Topic, &sarama.TopicDetail{
		NumPartitions:     req.Partitions,
		ReplicationFactor: req.ReplicationFactor,
		ConfigEntries:     configEntries,
	}, req.ValidateOnly)
	if err != nil {
		httputil.JSONError(w, "create topic failed: "+err.Error(), 502)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "topic": req.Topic})
}

func kafkaUpdateTopicHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req KafkaTopicAdminRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.JSONError(w, "invalid JSON: "+err.Error(), 400)
		return
	}
	if len(req.Config.Brokers) == 0 || req.Topic == "" {
		httputil.JSONError(w, "brokers and topic required", 400)
		return
	}
	admin, client, err := kafkaAdminAndClient(req.Config)
	if err != nil {
		httputil.JSONError(w, "connect failed: "+err.Error(), 502)
		return
	}
	defer admin.Close()
	defer client.Close()

	if req.Partitions > 0 {
		if err := admin.CreatePartitions(req.Topic, req.Partitions, nil, req.ValidateOnly); err != nil {
			httputil.JSONError(w, "create partitions failed: "+err.Error(), 502)
			return
		}
	}
	changes := make(map[string]sarama.IncrementalAlterConfigsEntry)
	for key, value := range req.Configs {
		configValue := value
		changes[key] = sarama.IncrementalAlterConfigsEntry{Operation: sarama.IncrementalAlterConfigsOperationSet, Value: &configValue}
	}
	for _, key := range req.DeleteConfigs {
		changes[key] = sarama.IncrementalAlterConfigsEntry{Operation: sarama.IncrementalAlterConfigsOperationDelete}
	}
	if len(changes) > 0 {
		if err := admin.IncrementalAlterConfig(sarama.TopicResource, req.Topic, changes, req.ValidateOnly); err != nil {
			httputil.JSONError(w, "update topic configs failed: "+err.Error(), 502)
			return
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "topic": req.Topic})
}

func kafkaDeleteTopicHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req KafkaTopicAdminRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.JSONError(w, "invalid JSON: "+err.Error(), 400)
		return
	}
	if len(req.Config.Brokers) == 0 || req.Topic == "" {
		httputil.JSONError(w, "brokers and topic required", 400)
		return
	}
	admin, client, err := kafkaAdminAndClient(req.Config)
	if err != nil {
		httputil.JSONError(w, "connect failed: "+err.Error(), 502)
		return
	}
	defer admin.Close()
	defer client.Close()
	if err := admin.DeleteTopic(req.Topic); err != nil {
		httputil.JSONError(w, "delete topic failed: "+err.Error(), 502)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "topic": req.Topic})
}

func kafkaConsumerGroupsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req KafkaConsumerGroupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.JSONError(w, "invalid JSON: "+err.Error(), 400)
		return
	}
	if len(req.Config.Brokers) == 0 {
		httputil.JSONError(w, "brokers required", 400)
		return
	}
	admin, client, err := kafkaAdminAndClient(req.Config)
	if err != nil {
		httputil.JSONError(w, "connect failed: "+err.Error(), 502)
		return
	}
	defer admin.Close()
	defer client.Close()

	groupStates, err := admin.ListConsumerGroups()
	if err != nil {
		httputil.JSONError(w, "list consumer groups failed: "+err.Error(), 502)
		return
	}
	groupIDs := make([]string, 0, len(groupStates))
	if req.Group != "" {
		groupIDs = append(groupIDs, req.Group)
	} else {
		for groupID := range groupStates {
			groupIDs = append(groupIDs, groupID)
		}
	}
	sort.Strings(groupIDs)
	if len(groupIDs) > 50 {
		groupIDs = groupIDs[:50]
	}
	descriptions, _ := admin.DescribeConsumerGroups(groupIDs)
	descByID := map[string]*sarama.GroupDescription{}
	for _, desc := range descriptions {
		descByID[desc.GroupId] = desc
	}

	groups := make([]map[string]interface{}, 0, len(groupIDs))
	for _, groupID := range groupIDs {
		topicPartitions := map[string][]int32(nil)
		if req.Topic != "" {
			partitions, err := client.Partitions(req.Topic)
			if err == nil {
				topicPartitions = map[string][]int32{req.Topic: partitions}
			}
		}
		offsets, _ := admin.ListConsumerGroupOffsets(groupID, topicPartitions)
		partitions := flattenGroupOffsets(offsets)
		latestReq := make(map[string]map[int32]int64)
		for _, item := range partitions {
			topic := item["topic"].(string)
			partition := item["partition"].(int32)
			if latestReq[topic] == nil {
				latestReq[topic] = make(map[int32]int64)
			}
			latestReq[topic][partition] = sarama.OffsetNewest
		}
		latest, _ := admin.ListOffsets(latestReq, nil)
		totalLag := int64(0)
		for _, item := range partitions {
			topic := item["topic"].(string)
			partition := item["partition"].(int32)
			current := item["offset"].(int64)
			latestOffset := int64(-1)
			if latest[topic] != nil && latest[topic][partition] != nil {
				latestOffset = latest[topic][partition].Offset
			}
			lag := int64(-1)
			if latestOffset >= 0 && current >= 0 {
				lag = maxInt64(0, latestOffset-current)
				totalLag += lag
			}
			item["latestOffset"] = latestOffset
			item["lag"] = lag
		}

		members := []map[string]interface{}{}
		if desc := descByID[groupID]; desc != nil {
			for _, member := range desc.Members {
				assignments := map[string][]int32{}
				if assignment, err := member.GetMemberAssignment(); err == nil && assignment != nil {
					assignments = assignment.Topics
				}
				members = append(members, map[string]interface{}{
					"memberId":        member.MemberId,
					"clientId":        member.ClientId,
					"clientHost":      member.ClientHost,
					"groupInstanceId": member.GroupInstanceId,
					"assignments":     assignments,
				})
			}
		}
		state := groupStates[groupID]
		if desc := descByID[groupID]; desc != nil && desc.State != "" {
			state = desc.State
		}
		groups = append(groups, map[string]interface{}{
			"groupId":     groupID,
			"state":       state,
			"protocol":    valueOrEmpty(descByID[groupID], func(d *sarama.GroupDescription) string { return d.Protocol }),
			"members":     members,
			"memberCount": len(members),
			"partitions":  partitions,
			"totalLag":    totalLag,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "groups": groups})
}

func kafkaResetOffsetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req KafkaResetOffsetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.JSONError(w, "invalid JSON: "+err.Error(), 400)
		return
	}
	if len(req.Config.Brokers) == 0 || req.Group == "" || req.Topic == "" {
		httputil.JSONError(w, "brokers, group and topic required", 400)
		return
	}
	admin, client, err := kafkaAdminAndClient(req.Config)
	if err != nil {
		httputil.JSONError(w, "connect failed: "+err.Error(), 502)
		return
	}
	defer admin.Close()
	defer client.Close()
	offset := req.Offset
	if req.Mode == "earliest" || req.Mode == "latest" {
		which := sarama.OffsetNewest
		if req.Mode == "earliest" {
			which = sarama.OffsetOldest
		}
		found, err := admin.ListOffsets(map[string]map[int32]int64{req.Topic: {req.Partition: which}}, nil)
		if err != nil || found[req.Topic] == nil || found[req.Topic][req.Partition] == nil {
			httputil.JSONError(w, "offset lookup failed", 502)
			return
		}
		offset = found[req.Topic][req.Partition].Offset
	}
	resp, err := admin.AlterConsumerGroupOffsets(req.Group, map[string]map[int32]sarama.OffsetAndMetadata{
		req.Topic: {req.Partition: {Offset: offset, Metadata: "adomnia reset", LeaderEpoch: -1}},
	}, nil)
	if err != nil {
		httputil.JSONError(w, "reset offset failed: "+err.Error(), 502)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "group": req.Group, "topic": req.Topic, "partition": req.Partition, "offset": offset, "response": resp})
}

func kafkaBrowseMessagesHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req KafkaBrowseRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.JSONError(w, "invalid JSON: "+err.Error(), 400)
		return
	}
	if len(req.Config.Brokers) == 0 || req.Topic == "" {
		httputil.JSONError(w, "brokers and topic required", 400)
		return
	}
	if req.MaxMsgs <= 0 || req.MaxMsgs > 500 {
		req.MaxMsgs = 50
	}
	if req.MaxWait <= 0 || req.MaxWait > 30 {
		req.MaxWait = 5
	}

	client, err := sarama.NewClient(req.Config.Brokers, newSaramaConfig(req.Config))
	if err != nil {
		httputil.JSONError(w, "connect failed: "+err.Error(), 502)
		return
	}
	defer client.Close()
	consumer, err := sarama.NewConsumerFromClient(client)
	if err != nil {
		httputil.JSONError(w, "consumer failed: "+err.Error(), 502)
		return
	}
	defer consumer.Close()

	partitions := []int32{}
	if req.Partition != nil {
		partitions = append(partitions, *req.Partition)
	} else if partitions, err = client.Partitions(req.Topic); err != nil {
		httputil.JSONError(w, "list partitions failed: "+err.Error(), 502)
		return
	}

	deadline := time.After(time.Duration(req.MaxWait) * time.Second)
	messages := make([]KafkaMessage, 0, req.MaxMsgs)
	for _, partition := range partitions {
		startOffset := sarama.OffsetOldest
		if req.Tail {
			startOffset = sarama.OffsetNewest
		}
		if req.Offset != nil {
			startOffset = *req.Offset
		}
		if req.TimestampMs != nil {
			if offset, err := client.GetOffset(req.Topic, partition, *req.TimestampMs); err == nil {
				startOffset = offset
			}
		}
		pc, err := consumer.ConsumePartition(req.Topic, partition, startOffset)
		if err != nil {
			continue
		}
		defer pc.Close()
	collect:
		for len(messages) < req.MaxMsgs {
			select {
			case msg := <-pc.Messages():
				if msg == nil {
					break collect
				}
				candidate := kafkaMessageFromSarama(msg)
				if kafkaMessageMatches(candidate, req) {
					messages = append(messages, candidate)
				}
			case <-deadline:
				break collect
			}
		}
		if len(messages) >= req.MaxMsgs {
			break
		}
	}
	sort.Slice(messages, func(i, j int) bool {
		if messages[i].Partition == messages[j].Partition {
			return messages[i].Offset < messages[j].Offset
		}
		return messages[i].Partition < messages[j].Partition
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "topic": req.Topic, "messages": messages, "count": len(messages)})
}

func flattenGroupOffsets(resp *sarama.OffsetFetchResponse) []map[string]interface{} {
	items := []map[string]interface{}{}
	if resp == nil {
		return items
	}
	for topic, partitions := range resp.Blocks {
		for partition, block := range partitions {
			items = append(items, map[string]interface{}{
				"topic":       topic,
				"partition":   partition,
				"offset":      block.Offset,
				"leaderEpoch": block.LeaderEpoch,
				"metadata":    block.Metadata,
				"error":       block.Err.Error(),
			})
		}
	}
	for _, group := range resp.Groups {
		for topic, partitions := range group.Blocks {
			for partition, block := range partitions {
				items = append(items, map[string]interface{}{
					"topic":       topic,
					"partition":   partition,
					"offset":      block.Offset,
					"leaderEpoch": block.LeaderEpoch,
					"metadata":    block.Metadata,
					"error":       block.Err.Error(),
				})
			}
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i]["topic"].(string) == items[j]["topic"].(string) {
			return items[i]["partition"].(int32) < items[j]["partition"].(int32)
		}
		return items[i]["topic"].(string) < items[j]["topic"].(string)
	})
	return items
}

func kafkaMessageFromSarama(msg *sarama.ConsumerMessage) KafkaMessage {
	headers := make(map[string]string)
	for _, hdr := range msg.Headers {
		headers[string(hdr.Key)] = string(hdr.Value)
	}
	return KafkaMessage{
		Key:       string(msg.Key),
		Value:     string(msg.Value),
		Partition: msg.Partition,
		Offset:    msg.Offset,
		Timestamp: msg.Timestamp.UTC().Format(time.RFC3339),
		Headers:   headers,
	}
}

func kafkaMessageMatches(msg KafkaMessage, req KafkaBrowseRequest) bool {
	if req.KeyContains != "" && !containsFold(msg.Key, req.KeyContains) {
		return false
	}
	if req.ValueContains != "" && !containsFold(msg.Value, req.ValueContains) {
		return false
	}
	if req.HeaderKey != "" {
		value, ok := msg.Headers[req.HeaderKey]
		if !ok {
			return false
		}
		if req.HeaderValue != "" && !containsFold(value, req.HeaderValue) {
			return false
		}
	}
	return true
}

func containsFold(haystack, needle string) bool {
	return len(needle) == 0 || len(haystack) >= len(needle) && containsLower(haystack, needle)
}

func containsLower(haystack, needle string) bool {
	h := []rune(haystack)
	n := []rune(needle)
	for i := range h {
		if i+len(n) > len(h) {
			return false
		}
		match := true
		for j := range n {
			if lowerRune(h[i+j]) != lowerRune(n[j]) {
				match = false
				break
			}
		}
		if match {
			return true
		}
	}
	return false
}

func lowerRune(r rune) rune {
	if r >= 'A' && r <= 'Z' {
		return r + 32
	}
	return r
}

func maxInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

func valueOrEmpty(desc *sarama.GroupDescription, getter func(*sarama.GroupDescription) string) string {
	if desc == nil {
		return ""
	}
	return getter(desc)
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

// RegisterHandlers registers the Kafka HTTP sidecar endpoints.
func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/kafka/produce", kafkaProduceHandler)
	mux.HandleFunc("/kafka/bulk-produce", kafkaBulkProduceHandler)
	mux.HandleFunc("/kafka/loadtest", kafkaLoadTestHandler)
	mux.HandleFunc("/kafka/consume", kafkaConsumeHandler)
	mux.HandleFunc("/kafka/topics", kafkaTopicsHandler)
	mux.HandleFunc("/kafka/cluster-overview", kafkaClusterOverviewHandler)
	mux.HandleFunc("/kafka/topic-detail", kafkaTopicDetailHandler)
	mux.HandleFunc("/kafka/topic-create", kafkaCreateTopicHandler)
	mux.HandleFunc("/kafka/topic-update", kafkaUpdateTopicHandler)
	mux.HandleFunc("/kafka/topic-delete", kafkaDeleteTopicHandler)
	mux.HandleFunc("/kafka/consumer-groups", kafkaConsumerGroupsHandler)
	mux.HandleFunc("/kafka/reset-offset", kafkaResetOffsetHandler)
	mux.HandleFunc("/kafka/browse", kafkaBrowseMessagesHandler)
}
