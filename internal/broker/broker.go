package broker

import (
	"adomnia/internal/httputil"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/nats-io/nats.go"
	amqp "github.com/rabbitmq/amqp091-go"
	"github.com/redis/go-redis/v9"
	bolt "go.etcd.io/bbolt"
)

// ─── shared types ────────────────────────────────────────────────────────────

type BrokerMessage struct {
	ID        string            `json:"id"`
	Timestamp string            `json:"timestamp"`
	Topic     string            `json:"topic"`
	Content   string            `json:"content"`
	Headers   map[string]string `json:"headers,omitempty"`
	Metadata  map[string]string `json:"metadata,omitempty"`
}

type MessagePreset struct {
	ID       string            `json:"id"`
	Name     string            `json:"name"`
	Protocol string            `json:"protocol"`
	Content  string            `json:"content"`
	Headers  map[string]string `json:"headers,omitempty"`
}

var brokerPresetsBucket = []byte("broker_presets")
var db *bolt.DB

// SetDB supplies local persistence for broker presets.
func SetDB(database *bolt.DB) {
	db = database
}

// ─── presets ─────────────────────────────────────────────────────────────────

func brokerPresetsSaveHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var preset MessagePreset
	if err := json.NewDecoder(r.Body).Decode(&preset); err != nil {
		httputil.JSONError(w, "invalid JSON: "+err.Error(), 400)
		return
	}
	if preset.ID == "" {
		preset.ID = fmt.Sprintf("preset-%d", time.Now().UnixNano())
	}
	data, _ := json.Marshal(preset)
	if err := db.Update(func(tx *bolt.Tx) error {
		b, err := tx.CreateBucketIfNotExists(brokerPresetsBucket)
		if err != nil {
			return err
		}
		return b.Put([]byte(preset.ID), data)
	}); err != nil {
		httputil.JSONError(w, "save failed: "+err.Error(), 500)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "id": preset.ID})
}

func brokerPresetsListHandler(w http.ResponseWriter, r *http.Request) {
	presets := []MessagePreset{}
	_ = db.View(func(tx *bolt.Tx) error {
		b := tx.Bucket(brokerPresetsBucket)
		if b == nil {
			return nil
		}
		return b.ForEach(func(_, v []byte) error {
			var p MessagePreset
			if err := json.Unmarshal(v, &p); err == nil {
				presets = append(presets, p)
			}
			return nil
		})
	})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "presets": presets})
}

func brokerPresetsDeleteHandler(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id == "" {
		httputil.JSONError(w, "id required", 400)
		return
	}
	if err := db.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket(brokerPresetsBucket)
		if b == nil {
			return nil
		}
		return b.Delete([]byte(id))
	}); err != nil {
		httputil.JSONError(w, "delete failed: "+err.Error(), 500)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
}

// ─── RabbitMQ ────────────────────────────────────────────────────────────────

type RabbitConfig struct {
	URL      string `json:"url"` // amqp://user:pass@host:5672/vhost
	Exchange string `json:"exchange"`
	Queue    string `json:"queue"`
	Vhost    string `json:"vhost,omitempty"`
}

type RabbitPublishRequest struct {
	Config      RabbitConfig      `json:"config"`
	RoutingKey  string            `json:"routingKey"`
	Body        string            `json:"body"`
	ContentType string            `json:"contentType"`
	Headers     map[string]string `json:"headers,omitempty"`
	Persistent  bool              `json:"persistent"`
}

type RabbitConsumeRequest struct {
	Config  RabbitConfig `json:"config"`
	MaxWait int          `json:"maxWait"`
	MaxMsgs int          `json:"maxMsgs"`
	AutoAck bool         `json:"autoAck"`
}

func rabbitPublishHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req RabbitPublishRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.JSONError(w, "invalid JSON: "+err.Error(), 400)
		return
	}
	if req.Config.URL == "" {
		httputil.JSONError(w, "url required", 400)
		return
	}

	conn, err := amqp.DialConfig(req.Config.URL, amqp.Config{
		Dial: amqp.DefaultDial(10 * time.Second),
	})
	if err != nil {
		httputil.JSONError(w, "connect failed: "+err.Error(), 502)
		return
	}
	defer conn.Close()

	ch, err := conn.Channel()
	if err != nil {
		httputil.JSONError(w, "channel failed: "+err.Error(), 502)
		return
	}
	defer ch.Close()

	deliveryMode := amqp.Transient
	if req.Persistent {
		deliveryMode = amqp.Persistent
	}
	if req.ContentType == "" {
		req.ContentType = "application/json"
	}

	amqpHeaders := amqp.Table{}
	for k, v := range req.Headers {
		amqpHeaders[k] = v
	}

	err = ch.PublishWithContext(r.Context(),
		req.Config.Exchange,
		req.RoutingKey,
		false,
		false,
		amqp.Publishing{
			ContentType:  req.ContentType,
			DeliveryMode: deliveryMode,
			Timestamp:    time.Now(),
			Headers:      amqpHeaders,
			Body:         []byte(req.Body),
		},
	)
	if err != nil {
		httputil.JSONError(w, "publish failed: "+err.Error(), 502)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":         true,
		"exchange":   req.Config.Exchange,
		"routingKey": req.RoutingKey,
		"timestamp":  time.Now().UTC().Format(time.RFC3339),
	})
}

func rabbitConsumeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req RabbitConsumeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.JSONError(w, "invalid JSON: "+err.Error(), 400)
		return
	}
	if req.Config.URL == "" || req.Config.Queue == "" {
		httputil.JSONError(w, "url and queue required", 400)
		return
	}
	if req.MaxWait <= 0 || req.MaxWait > 30 {
		req.MaxWait = 5
	}
	if req.MaxMsgs <= 0 || req.MaxMsgs > 200 {
		req.MaxMsgs = 20
	}

	conn, err := amqp.DialConfig(req.Config.URL, amqp.Config{
		Dial: amqp.DefaultDial(10 * time.Second),
	})
	if err != nil {
		httputil.JSONError(w, "connect failed: "+err.Error(), 502)
		return
	}
	defer conn.Close()

	ch, err := conn.Channel()
	if err != nil {
		httputil.JSONError(w, "channel failed: "+err.Error(), 502)
		return
	}
	defer ch.Close()

	msgs, err := ch.Consume(req.Config.Queue, "adomnia-consumer", req.AutoAck, false, false, false, nil)
	if err != nil {
		httputil.JSONError(w, "consume failed: "+err.Error(), 502)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), time.Duration(req.MaxWait)*time.Second)
	defer cancel()

	collected := make([]BrokerMessage, 0, req.MaxMsgs)
	for {
		select {
		case msg, ok := <-msgs:
			if !ok {
				goto done
			}
			headers := map[string]string{}
			for k, v := range msg.Headers {
				headers[k] = fmt.Sprintf("%v", v)
			}
			collected = append(collected, BrokerMessage{
				ID:        fmt.Sprintf("%d", msg.DeliveryTag),
				Timestamp: time.Now().UTC().Format(time.RFC3339),
				Topic:     req.Config.Queue,
				Content:   string(msg.Body),
				Headers:   headers,
				Metadata: map[string]string{
					"exchange":    msg.Exchange,
					"routingKey":  msg.RoutingKey,
					"contentType": msg.ContentType,
					"redelivered": fmt.Sprintf("%v", msg.Redelivered),
				},
			})
			if !req.AutoAck {
				_ = msg.Ack(false)
			}
			if len(collected) >= req.MaxMsgs {
				goto done
			}
		case <-ctx.Done():
			goto done
		}
	}
done:
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":       true,
		"messages": collected,
		"count":    len(collected),
	})
}

func rabbitExchangesHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var cfg RabbitConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		httputil.JSONError(w, "invalid JSON: "+err.Error(), 400)
		return
	}
	if cfg.URL == "" {
		httputil.JSONError(w, "url required", 400)
		return
	}

	conn, err := amqp.DialConfig(cfg.URL, amqp.Config{
		Dial: amqp.DefaultDial(10 * time.Second),
	})
	if err != nil {
		httputil.JSONError(w, "connect failed: "+err.Error(), 502)
		return
	}
	defer conn.Close()

	// RabbitMQ management API is not in amqp091-go; return basic info
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":   true,
		"note": "Connected to " + cfg.URL + ". Use the RabbitMQ Management UI for full exchange/queue listing.",
	})
}

// ─── MQTT ─────────────────────────────────────────────────────────────────────

type MQTTConfig struct {
	Broker   string `json:"broker"` // tcp://host:1883
	ClientID string `json:"clientId"`
	Username string `json:"username,omitempty"`
	Password string `json:"password,omitempty"`
	TLS      bool   `json:"tls"`
}

type MQTTPublishRequest struct {
	Config   MQTTConfig `json:"config"`
	Topic    string     `json:"topic"`
	Payload  string     `json:"payload"`
	QoS      byte       `json:"qos"`
	Retained bool       `json:"retained"`
}

type MQTTSubscribeRequest struct {
	Config  MQTTConfig `json:"config"`
	Topic   string     `json:"topic"`
	QoS     byte       `json:"qos"`
	MaxWait int        `json:"maxWait"`
	MaxMsgs int        `json:"maxMsgs"`
}

func mqttClient(cfg MQTTConfig) (mqtt.Client, error) {
	opts := mqtt.NewClientOptions()
	broker := cfg.Broker
	if broker == "" {
		broker = "tcp://localhost:1883"
	}
	opts.AddBroker(broker)
	clientID := cfg.ClientID
	if clientID == "" {
		clientID = fmt.Sprintf("adomnia-%d", time.Now().UnixNano())
	}
	opts.SetClientID(clientID)
	if cfg.Username != "" {
		opts.SetUsername(cfg.Username)
		opts.SetPassword(cfg.Password)
	}
	opts.SetConnectTimeout(10 * time.Second)
	opts.SetAutoReconnect(false)
	client := mqtt.NewClient(opts)
	token := client.Connect()
	if token.WaitTimeout(10*time.Second) && token.Error() != nil {
		return nil, token.Error()
	}
	return client, nil
}

func mqttPublishHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req MQTTPublishRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.JSONError(w, "invalid JSON: "+err.Error(), 400)
		return
	}
	if req.Topic == "" {
		httputil.JSONError(w, "topic required", 400)
		return
	}

	client, err := mqttClient(req.Config)
	if err != nil {
		httputil.JSONError(w, "connect failed: "+err.Error(), 502)
		return
	}
	defer client.Disconnect(250)

	token := client.Publish(req.Topic, req.QoS, req.Retained, req.Payload)
	token.Wait()
	if token.Error() != nil {
		httputil.JSONError(w, "publish failed: "+token.Error().Error(), 502)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":        true,
		"topic":     req.Topic,
		"qos":       req.QoS,
		"retained":  req.Retained,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

func mqttSubscribeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req MQTTSubscribeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.JSONError(w, "invalid JSON: "+err.Error(), 400)
		return
	}
	if req.Topic == "" {
		httputil.JSONError(w, "topic required", 400)
		return
	}
	if req.MaxWait <= 0 || req.MaxWait > 30 {
		req.MaxWait = 5
	}
	if req.MaxMsgs <= 0 || req.MaxMsgs > 200 {
		req.MaxMsgs = 20
	}

	client, err := mqttClient(req.Config)
	if err != nil {
		httputil.JSONError(w, "connect failed: "+err.Error(), 502)
		return
	}
	defer client.Disconnect(250)

	collected := make([]BrokerMessage, 0, req.MaxMsgs)
	msgCh := make(chan mqtt.Message, req.MaxMsgs)

	token := client.Subscribe(req.Topic, req.QoS, func(_ mqtt.Client, msg mqtt.Message) {
		select {
		case msgCh <- msg:
		default:
		}
	})
	token.Wait()
	if token.Error() != nil {
		httputil.JSONError(w, "subscribe failed: "+token.Error().Error(), 502)
		return
	}

	deadline := time.After(time.Duration(req.MaxWait) * time.Second)
	for {
		select {
		case msg := <-msgCh:
			collected = append(collected, BrokerMessage{
				ID:        fmt.Sprintf("%d", msg.MessageID()),
				Timestamp: time.Now().UTC().Format(time.RFC3339),
				Topic:     msg.Topic(),
				Content:   string(msg.Payload()),
				Metadata: map[string]string{
					"qos":       fmt.Sprintf("%d", msg.Qos()),
					"retained":  fmt.Sprintf("%v", msg.Retained()),
					"duplicate": fmt.Sprintf("%v", msg.Duplicate()),
				},
			})
			if len(collected) >= req.MaxMsgs {
				goto done
			}
		case <-deadline:
			goto done
		}
	}
done:
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":       true,
		"messages": collected,
		"count":    len(collected),
	})
}

// ─── Redis Pub/Sub ────────────────────────────────────────────────────────────

type RedisConfig struct {
	Addr     string `json:"addr"` // host:6379
	Password string `json:"password,omitempty"`
	DB       int    `json:"db"`
	TLS      bool   `json:"tls"`
}

type RedisPublishRequest struct {
	Config  RedisConfig `json:"config"`
	Channel string      `json:"channel"`
	Message string      `json:"message"`
}

type RedisSubscribeRequest struct {
	Config   RedisConfig `json:"config"`
	Channels []string    `json:"channels"`
	MaxWait  int         `json:"maxWait"`
	MaxMsgs  int         `json:"maxMsgs"`
}

func redisClient(cfg RedisConfig) *redis.Client {
	addr := cfg.Addr
	if addr == "" {
		addr = "localhost:6379"
	}
	return redis.NewClient(&redis.Options{
		Addr:        addr,
		Password:    cfg.Password,
		DB:          cfg.DB,
		DialTimeout: 10 * time.Second,
	})
}

func redisPublishHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req RedisPublishRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.JSONError(w, "invalid JSON: "+err.Error(), 400)
		return
	}
	if req.Channel == "" {
		httputil.JSONError(w, "channel required", 400)
		return
	}

	rdb := redisClient(req.Config)
	defer rdb.Close()

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	receivers, err := rdb.Publish(ctx, req.Channel, req.Message).Result()
	if err != nil {
		httputil.JSONError(w, "publish failed: "+err.Error(), 502)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":        true,
		"channel":   req.Channel,
		"receivers": receivers,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

func redisSubscribeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req RedisSubscribeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.JSONError(w, "invalid JSON: "+err.Error(), 400)
		return
	}
	if len(req.Channels) == 0 {
		httputil.JSONError(w, "channels required", 400)
		return
	}
	if req.MaxWait <= 0 || req.MaxWait > 30 {
		req.MaxWait = 5
	}
	if req.MaxMsgs <= 0 || req.MaxMsgs > 200 {
		req.MaxMsgs = 20
	}

	rdb := redisClient(req.Config)
	defer rdb.Close()

	ctx, cancel := context.WithTimeout(r.Context(), time.Duration(req.MaxWait)*time.Second)
	defer cancel()

	pubsub := rdb.Subscribe(ctx, req.Channels...)
	defer pubsub.Close()

	collected := make([]BrokerMessage, 0, req.MaxMsgs)
	msgCh := pubsub.Channel()

	for {
		select {
		case msg, ok := <-msgCh:
			if !ok {
				goto redisDone
			}
			collected = append(collected, BrokerMessage{
				ID:        fmt.Sprintf("%d", time.Now().UnixNano()),
				Timestamp: time.Now().UTC().Format(time.RFC3339),
				Topic:     msg.Channel,
				Content:   msg.Payload,
				Metadata: map[string]string{
					"pattern": msg.Pattern,
				},
			})
			if len(collected) >= req.MaxMsgs {
				goto redisDone
			}
		case <-ctx.Done():
			goto redisDone
		}
	}
redisDone:
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":       true,
		"messages": collected,
		"count":    len(collected),
	})
}

// ─── NATS ─────────────────────────────────────────────────────────────────────

type NATSConfig struct {
	URL      string `json:"url"` // nats://host:4222
	Username string `json:"username,omitempty"`
	Password string `json:"password,omitempty"`
	Token    string `json:"token,omitempty"`
}

type NATSPublishRequest struct {
	Config  NATSConfig        `json:"config"`
	Subject string            `json:"subject"`
	Payload string            `json:"payload"`
	Headers map[string]string `json:"headers,omitempty"`
}

type NATSSubscribeRequest struct {
	Config  NATSConfig `json:"config"`
	Subject string     `json:"subject"`
	MaxWait int        `json:"maxWait"`
	MaxMsgs int        `json:"maxMsgs"`
}

func natsConnect(cfg NATSConfig) (*nats.Conn, error) {
	url := cfg.URL
	if url == "" {
		url = nats.DefaultURL
	}
	opts := []nats.Option{
		nats.Timeout(10 * time.Second),
	}
	if cfg.Username != "" {
		opts = append(opts, nats.UserInfo(cfg.Username, cfg.Password))
	}
	if cfg.Token != "" {
		opts = append(opts, nats.Token(cfg.Token))
	}
	return nats.Connect(url, opts...)
}

func natsPublishHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req NATSPublishRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.JSONError(w, "invalid JSON: "+err.Error(), 400)
		return
	}
	if req.Subject == "" {
		httputil.JSONError(w, "subject required", 400)
		return
	}

	nc, err := natsConnect(req.Config)
	if err != nil {
		httputil.JSONError(w, "connect failed: "+err.Error(), 502)
		return
	}
	defer nc.Close()

	msg := &nats.Msg{
		Subject: req.Subject,
		Data:    []byte(req.Payload),
	}
	if len(req.Headers) > 0 {
		msg.Header = make(nats.Header)
		for k, v := range req.Headers {
			msg.Header.Set(k, v)
		}
	}

	if err := nc.PublishMsg(msg); err != nil {
		httputil.JSONError(w, "publish failed: "+err.Error(), 502)
		return
	}
	if err := nc.Flush(); err != nil {
		httputil.JSONError(w, "flush failed: "+err.Error(), 502)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":        true,
		"subject":   req.Subject,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

func natsSubscribeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req NATSSubscribeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.JSONError(w, "invalid JSON: "+err.Error(), 400)
		return
	}
	if req.Subject == "" {
		httputil.JSONError(w, "subject required", 400)
		return
	}
	if req.MaxWait <= 0 || req.MaxWait > 30 {
		req.MaxWait = 5
	}
	if req.MaxMsgs <= 0 || req.MaxMsgs > 200 {
		req.MaxMsgs = 20
	}

	nc, err := natsConnect(req.Config)
	if err != nil {
		httputil.JSONError(w, "connect failed: "+err.Error(), 502)
		return
	}
	defer nc.Close()

	collected := make([]BrokerMessage, 0, req.MaxMsgs)
	msgCh := make(chan *nats.Msg, req.MaxMsgs)

	sub, err := nc.Subscribe(req.Subject, func(m *nats.Msg) {
		select {
		case msgCh <- m:
		default:
		}
	})
	if err != nil {
		httputil.JSONError(w, "subscribe failed: "+err.Error(), 502)
		return
	}
	defer sub.Unsubscribe()

	deadline := time.After(time.Duration(req.MaxWait) * time.Second)
	for {
		select {
		case msg := <-msgCh:
			headers := map[string]string{}
			for k := range msg.Header {
				headers[k] = msg.Header.Get(k)
			}
			collected = append(collected, BrokerMessage{
				ID:        fmt.Sprintf("%d", time.Now().UnixNano()),
				Timestamp: time.Now().UTC().Format(time.RFC3339),
				Topic:     msg.Subject,
				Content:   string(msg.Data),
				Headers:   headers,
				Metadata: map[string]string{
					"reply": msg.Reply,
				},
			})
			if len(collected) >= req.MaxMsgs {
				goto natsDone
			}
		case <-deadline:
			goto natsDone
		}
	}
natsDone:
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":       true,
		"messages": collected,
		"count":    len(collected),
	})
}

// RegisterHandlers registers Broker Studio sidecar endpoints.
func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/broker/rabbitmq/publish", rabbitPublishHandler)
	mux.HandleFunc("/broker/rabbitmq/consume", rabbitConsumeHandler)
	mux.HandleFunc("/broker/rabbitmq/exchanges", rabbitExchangesHandler)
	mux.HandleFunc("/broker/mqtt/publish", mqttPublishHandler)
	mux.HandleFunc("/broker/mqtt/subscribe", mqttSubscribeHandler)
	mux.HandleFunc("/broker/redis/publish", redisPublishHandler)
	mux.HandleFunc("/broker/redis/subscribe", redisSubscribeHandler)
	mux.HandleFunc("/broker/nats/publish", natsPublishHandler)
	mux.HandleFunc("/broker/nats/subscribe", natsSubscribeHandler)
	mux.HandleFunc("/broker/presets/save", brokerPresetsSaveHandler)
	mux.HandleFunc("/broker/presets/list", brokerPresetsListHandler)
	mux.HandleFunc("/broker/presets/delete", brokerPresetsDeleteHandler)
}
