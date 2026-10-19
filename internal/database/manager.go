package database

import (
	"adomnia/internal/storage"
	"adomnia/internal/vault"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"math/rand/v2"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/readpref"
)

type connectionStatus struct {
	State     string    `json:"state"`
	LatencyMS int64     `json:"latencyMs"`
	Error     string    `json:"error,omitempty"`
	Since     time.Time `json:"since"`
}
type connectionHandle struct {
	mu       sync.Mutex
	cfg      dbConnectionRequest
	sql      *sql.DB
	mongo    *mongo.Client
	mongoDB  *mongo.Database
	redis    *redis.Client
	driver   string
	status   connectionStatus
	used     time.Time
	checked  time.Time
	retry    time.Time
	failures int
	wanted   bool
}
type ConnectionManager struct {
	mu      sync.Mutex
	entries map[string]*connectionHandle
	stop    chan struct{}
	once    sync.Once
}

func newConnectionManager() *ConnectionManager {
	m := &ConnectionManager{entries: map[string]*connectionHandle{}, stop: make(chan struct{})}
	go m.monitor()
	return m
}

var connections = newConnectionManager()

func (m *ConnectionManager) entry(id string) *connectionHandle {
	m.mu.Lock()
	defer m.mu.Unlock()
	h := m.entries[id]
	if h == nil {
		h = &connectionHandle{status: connectionStatus{State: "disconnected"}}
		m.entries[id] = h
	}
	return h
}
func (h *connectionHandle) close() {
	if h.sql != nil {
		h.sql.Close()
		h.sql = nil
	}
	if h.redis != nil {
		h.redis.Close()
		h.redis = nil
	}
	if h.mongo != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		h.mongo.Disconnect(ctx)
		cancel()
		h.mongo = nil
		h.mongoDB = nil
	}
}

var connectionVariablePattern = regexp.MustCompile(`\{\{([^{}]+)\}\}`)

func resolveCredentials(c dbConnectionRequest) (dbConnectionRequest, error) {
	var err error
	c.Password, err = vault.Open(c.Password)
	if err != nil {
		return c, err
	}
	c.DSN, err = vault.Open(c.DSN)
	if err == nil && c.Variables != "" {
		var vars map[string]string
		if json.Unmarshal([]byte(c.Variables), &vars) != nil {
			return c, errors.New("invalid variables")
		}
		for _, field := range []*string{&c.DSN, &c.Host, &c.Database, &c.User, &c.Password, &c.SQLitePath, &c.Options} {
			*field = connectionVariablePattern.ReplaceAllStringFunc(*field, func(ref string) string {
				key := strings.TrimSpace(ref[2 : len(ref)-2])
				value, exists := vars[key]
				if !exists || err != nil {
					return ref
				}
				if strings.HasPrefix(value, "vault:") {
					value, err = vault.Open(value)
					if err != nil {
						return ref
					}
				}
				return value
			})
			if err != nil {
				return c, err
			}
		}
	}
	return c, err
}

// Drivers sometimes echo URIs/DSNs (including credentials). Error responses
// deliberately expose only our own validation/confirmation messages.
func safeDatabaseError(err error) string {
	message := err.Error()
	if message == "dangerous query requires confirmation" || message == "dangerous MongoDB operation requires confirmation" || message == "Redis write requires confirmation" {
		return message
	}
	return "Database operation failed. Check the connection settings, query and server availability."
}
func (h *connectionHandle) ping(ctx context.Context) error {
	if h.sql != nil {
		return h.sql.PingContext(ctx)
	}
	if h.mongo != nil {
		return h.mongo.Ping(ctx, readpref.Primary())
	}
	if h.redis != nil {
		return h.redis.Ping(ctx).Err()
	}
	return errors.New("connection is closed")
}
func (h *connectionHandle) open(ctx context.Context) error {
	h.close()
	cfg, err := resolveCredentials(h.cfg)
	if err != nil {
		return h.fail(err)
	}
	start := time.Now()
	switch {
	case isMongoDriver(cfg.Driver):
		h.mongo, h.mongoDB, err = openMongoDatabase(ctx, cfg)
		h.driver = "mongodb"
	case strings.EqualFold(cfg.Driver, "redis"):
		h.redis, err = openRedisDatabase(cfg)
		h.driver = "redis"
	default:
		h.sql, h.driver, err = openDatabase(cfg)
		if h.sql != nil {
			h.sql.SetMaxOpenConns(4)
			h.sql.SetMaxIdleConns(2)
			h.sql.SetConnMaxIdleTime(15 * time.Minute)
		}
	}
	if err == nil {
		err = h.ping(ctx)
	}
	if err != nil {
		h.close()
		return h.fail(err)
	}
	h.status = connectionStatus{State: "connected", LatencyMS: time.Since(start).Milliseconds(), Since: time.Now()}
	h.checked = time.Now()
	h.failures = 0
	h.retry = time.Time{}
	return nil
}
func (h *connectionHandle) idleTimeout() time.Duration {
	minutes := h.cfg.IdleTimeoutMinutes
	if minutes <= 0 {
		minutes = 15
	}
	if minutes > 120 {
		minutes = 120
	}
	return time.Duration(minutes) * time.Minute
}
func (h *connectionHandle) fail(err error) error {
	h.failures++
	delay := time.Second * time.Duration(1<<min(h.failures-1, 5))
	if delay > 30*time.Second {
		delay = 30 * time.Second
	}
	h.retry = time.Now().Add(delay + time.Duration(rand.IntN(250))*time.Millisecond)
	h.status.State = "error"
	h.status.Error = "Database connection failed. Check credentials, address and server availability."
	return errors.New(h.status.Error)
}

// The lease serializes close/config changes with queries; disconnect never
// closes a client while a query is using it.
func (m *ConnectionManager) acquire(ctx context.Context, cfg dbConnectionRequest) (*connectionHandle, func(), error) {
	h := m.entry(cfg.ID)
	h.mu.Lock()
	h.used = time.Now()
	h.wanted = true
	if h.cfg != cfg {
		h.close()
		h.cfg = cfg
		h.retry = time.Time{}
	}
	if h.sql == nil && h.mongo == nil && h.redis == nil {
		if time.Now().Before(h.retry) {
			h.mu.Unlock()
			return nil, nil, errors.New(h.status.Error)
		}
		if err := h.open(ctx); err != nil {
			h.mu.Unlock()
			return nil, nil, err
		}
	}
	return h, h.mu.Unlock, nil
}
func (m *ConnectionManager) disconnect(id string) {
	h := m.entry(id)
	h.mu.Lock()
	defer h.mu.Unlock()
	h.wanted = false
	h.close()
	h.status = connectionStatus{State: "disconnected"}
	h.cfg = dbConnectionRequest{}
}
func (m *ConnectionManager) status(id string) connectionStatus {
	h := m.entry(id)
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.status
}
func (m *ConnectionManager) monitor() {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-m.stop:
			return
		case now := <-ticker.C:
			m.maintain(now)
		}
	}
}
func (m *ConnectionManager) maintain(now time.Time) {

	m.mu.Lock()
	list := make([]*connectionHandle, 0, len(m.entries))
	for _, h := range m.entries {
		list = append(list, h)
	}
	m.mu.Unlock()
	for _, h := range list {
		if !h.mu.TryLock() {
			continue
		}
		if h.wanted {
			if now.Sub(h.used) > h.idleTimeout() {
				h.close()
				h.wanted = false
				h.status.State = "disconnected"
			} else if h.status.State == "error" && !now.Before(h.retry) {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				h.open(ctx)
				cancel()
			} else if h.status.State == "connected" && now.Sub(h.checked) >= 30*time.Second {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				start := time.Now()
				err := h.ping(ctx)
				cancel()
				if err != nil {
					h.close()
					h.fail(err)
				} else {
					h.status.LatencyMS = time.Since(start).Milliseconds()
					h.checked = now
				}
			}
		}
		h.mu.Unlock()
	}
}

func (m *ConnectionManager) Close() {
	m.once.Do(func() {
		close(m.stop)
		m.mu.Lock()
		defer m.mu.Unlock()
		for _, h := range m.entries {
			h.mu.Lock()
			h.wanted = false
			h.close()
			h.mu.Unlock()
		}
	})
}
func CloseAll() { connections.Close() }

func savedConfig(id string) (dbConnectionRequest, error) {
	raw, err := storage.Get("database", "connections")
	if err != nil {
		return dbConnectionRequest{}, err
	}
	var list []dbConnectionRequest
	if json.Unmarshal(raw, &list) != nil {
		return dbConnectionRequest{}, errors.New("saved connections unavailable")
	}
	for _, cfg := range list {
		if cfg.ID == id {
			return cfg, nil
		}
	}
	return dbConnectionRequest{}, errors.New("saved connection not found")
}
func databaseSealHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var cfg map[string]any
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&cfg) != nil {
		http.Error(w, "invalid json", 400)
		return
	}
	if cfg == nil {
		http.Error(w, "connection object required", 400)
		return
	}
	fallback := false
	passphrase, _ := cfg["extraPassphrase"].(string)
	delete(cfg, "extraPassphrase")
	extraProtected, _ := cfg["extraProtected"].(bool)
	for _, field := range []string{"password", "dsn"} {
		value, valid := cfg[field].(string)
		if _, exists := cfg[field]; exists && !valid {
			http.Error(w, "credential fields must be strings", 400)
			return
		}
		if value == "" {
			continue
		}
		if passphrase != "" {
			plain, err := vault.Open(value)
			if err != nil {
				http.Error(w, "Unlock Vault before changing extra protection", http.StatusLocked)
				return
			}
			ref, err := vault.SealWithPassphrase(plain, passphrase)
			if err != nil {
				http.Error(w, "could not encrypt credentials", 500)
				return
			}
			cfg[field] = ref
			cfg["extraProtected"] = true
			continue
		}
		if extraProtected && strings.HasPrefix(value, "vault:") {
			continue
		}
		if extraProtected {
			http.Error(w, "Enter the extra passphrase and choose Protect to change this credential", http.StatusLocked)
			return
		}
		if strings.HasPrefix(value, "vault:local:v1:") {
			if _, err := vault.Open(value); err != nil {
				http.Error(w, "saved credential is unavailable on this installation", 400)
				return
			}
			continue
		}
		if strings.HasPrefix(value, "vault:") {
			plain, err := vault.Open(value)
			if err != nil {
				continue
			}
			value = plain
		}
		sealed, usedFallback, err := vault.Seal(value)
		if err != nil {
			http.Error(w, "Could not save credentials: "+err.Error(), 500)
			return
		}
		cfg[field] = sealed
		fallback = fallback || usedFallback
	}
	cfg["savedInVault"] = true
	dbWriteJSON(w, map[string]any{"connection": cfg, "fallback": fallback})
}
func databaseConnectionHandler(action string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST required", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			Variables  map[string]string   `json:"variables"`
			ID         string              `json:"connectionId"`
			Connection dbConnectionRequest `json:"connection"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req) != nil || req.ID == "" {
			http.Error(w, "connectionId required", 400)
			return
		}
		if action == "disconnect" {
			connections.disconnect(req.ID)
		}
		if action == "connect" {
			cfg := req.Connection
			cfg.ID = req.ID
			if cfg.Driver == "" {
				var err error
				cfg, err = savedConfig(req.ID)
				if err != nil {
					http.Error(w, err.Error(), 400)
					return
				}
			}
			ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
			if len(req.Variables) > 0 {
				data, _ := json.Marshal(req.Variables)
				cfg.Variables = string(data)
			}
			defer cancel()
			_, release, err := connections.acquire(ctx, cfg)
			if err != nil {
				http.Error(w, err.Error(), 400)
				return
			}
			release()
		}
		dbWriteJSON(w, connections.status(req.ID))
	}
}
