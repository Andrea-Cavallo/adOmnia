package database

import (
	"context"
	"crypto/tls"
	"encoding/json/v2"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"

	"adomnia/internal/jsonutil"
	"github.com/redis/go-redis/v9"
)

func openRedisDatabase(c dbConnectionRequest) (*redis.Client, error) {
	var opts *redis.Options
	var err error
	if strings.TrimSpace(c.DSN) != "" {
		opts, err = redis.ParseURL(strings.TrimSpace(c.DSN))
		if err != nil {
			return nil, fmt.Errorf("invalid Redis URI; use redis:// or rediss://")
		}
	} else {
		index := 0
		if strings.TrimSpace(c.Database) != "" {
			index, err = strconv.Atoi(c.Database)
			if err != nil || index < 0 {
				return nil, fmt.Errorf("Redis database index must be a non-negative integer")
			}
		}
		host := strings.TrimSpace(c.Host)
		if host == "" {
			return nil, fmt.Errorf("Redis host is required")
		}
		port := c.Port
		if port == 0 {
			port = 6379
		}
		if port < 1 || port > 65535 {
			return nil, fmt.Errorf("invalid Redis port")
		}
		opts = &redis.Options{Addr: net.JoinHostPort(host, strconv.Itoa(port)), DB: index, Username: c.User, Password: c.Password}
		if c.SSLMode != "" && c.SSLMode != "disable" {
			opts.TLSConfig = &tls.Config{MinVersion: tls.VersionTLS12, ServerName: host}
		}
	}
	opts.DialTimeout = 5 * time.Second
	opts.ContextTimeoutEnabled = true
	opts.MaxRetries = -1
	return redis.NewClient(opts), nil
}

type redisQuery struct {
	Operation string   `json:"operation"`
	Command   string   `json:"command"`
	Args      []string `json:"args"`
	Key       string   `json:"key"`
	Pattern   string   `json:"pattern"`
}

// Restrict the runner to data commands: connection and server control are owned by the connection form.
var redisReadCommands = strings.Fields("PING GET MGET EXISTS TYPE TTL PTTL STRLEN GETRANGE HGET HMGET HGETALL HLEN HEXISTS HKEYS HVALS HSCAN LRANGE LLEN LINDEX SMEMBERS SCARD SISMEMBER SSCAN ZRANGE ZREVRANGE ZCARD ZSCORE ZCOUNT ZSCAN XRANGE XREVRANGE XLEN DBSIZE INFO SCAN")
var redisWriteCommands = strings.Fields("SET MSET SETNX SETEX PSETEX DEL UNLINK EXPIRE PEXPIRE EXPIREAT PEXPIREAT PERSIST RENAME RENAMENX INCR INCRBY DECR DECRBY APPEND HSET HSETNX HDEL HINCRBY LPUSH RPUSH LPOP RPOP LSET LTRIM LREM SADD SREM SPOP ZADD ZREM ZINCRBY XADD XDEL XTRIM FLUSHDB FLUSHALL")

func redisCommandAllowed(command string) (allowed, write bool) {
	for _, item := range redisReadCommands {
		if command == item {
			return true, false
		}
	}
	for _, item := range redisWriteCommands {
		if command == item {
			return true, true
		}
	}
	return false, false
}

// redisPageLimit applies the request limit with the 200 default and 5000 cap.
func redisPageLimit(limit int) int {
	if limit <= 0 {
		limit = 200
	}
	if limit > 5000 {
		limit = 5000
	}
	return limit
}

// redisOpenClient returns the client for the request plus a cleanup func.
func redisOpenClient(req dbQueryRequest) (*redis.Client, func(), error) {
	if req.handle != nil {
		return req.handle.redis, func() {}, nil
	}
	client, err := openRedisDatabase(req.Connection)
	if err != nil {
		return nil, nil, err
	}
	return client, func() { client.Close() }, nil
}

func runRedisQuery(parent context.Context, req dbQueryRequest) (dbQueryResponse, error) {
	var q redisQuery
	if err := json.Unmarshal([]byte(req.Query), &q); err != nil {
		return dbQueryResponse{}, fmt.Errorf("Redis queries must be JSON: {\"command\":\"GET\",\"args\":[\"key\"]}")
	}
	if req.Explain || req.Analyze {
		return dbQueryResponse{}, fmt.Errorf("Redis does not support SQL EXPLAIN")
	}
	command := strings.ToUpper(strings.TrimSpace(q.Command))
	allowed, write := redisCommandAllowed(command)
	if q.Operation != "scan" && q.Operation != "inspect" && !allowed {
		return dbQueryResponse{}, fmt.Errorf("unsupported Redis command")
	}
	if write && !req.Confirm {
		return dbQueryResponse{}, fmt.Errorf("Redis write requires confirmation")
	}
	timeout := time.Duration(req.TimeoutMS) * time.Millisecond
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()
	client, cleanup, err := redisOpenClient(req)
	if err != nil {
		return dbQueryResponse{}, err
	}
	defer cleanup()
	limit := redisPageLimit(req.Limit)
	start := time.Now()
	resp := dbQueryResponse{Driver: "redis", Columns: []string{"value"}, Rows: []map[string]interface{}{}, StatementType: command, Destructive: write}
	switch q.Operation {
	case "scan":
		err = redisScanKeys(ctx, client, q.Pattern, limit, &resp)
	case "inspect":
		err = redisInspectKey(ctx, client, q.Key, limit, &resp)
	default:
		err = redisRunCommand(ctx, client, command, q.Args, limit, &resp)
	}
	if err != nil {
		return resp, err
	}
	resp.DurationMS = time.Since(start).Milliseconds()
	return resp, nil
}

// redisScanKeys pages through SCAN (at most 100 pages) collecting unique key names up to limit.
func redisScanKeys(ctx context.Context, client *redis.Client, pattern string, limit int, resp *dbQueryResponse) error {
	resp.StatementType = "SCAN"
	resp.Columns = []string{"name"}
	if pattern == "" {
		pattern = "*"
	}
	cursor := uint64(0)
	seen := map[string]bool{}
	for pages := 0; pages < 100; pages++ {
		keys, next, err := client.Scan(ctx, cursor, pattern, int64(limit)).Result()
		if err != nil {
			return err
		}
		for _, key := range keys {
			if seen[key] {
				continue
			}
			seen[key] = true
			if len(resp.Rows) == limit {
				resp.Limited = true
				break
			}
			resp.Rows = append(resp.Rows, map[string]interface{}{"name": key})
		}
		cursor = next
		if cursor == 0 || resp.Limited {
			break
		}
		if pages == 99 {
			resp.Limited = true
		}
	}
	if cursor != 0 {
		resp.Limited = true
	}
	return nil
}

// redisTruncate cuts items to max entries and reports whether anything was dropped.
func redisTruncate[T any](items []T, max int) ([]T, bool) {
	if len(items) > max {
		return items[:max], true
	}
	return items, false
}

// redisReadValue reads a preview of the value stored at key according to its type.
func redisReadValue(ctx context.Context, client *redis.Client, key, kind string, limit int, resp *dbQueryResponse) (interface{}, error) {
	switch kind {
	case "none":
		return nil, nil
	case "string":
		return client.Get(ctx, key).Result()
	case "list":
		items, err := client.LRange(ctx, key, 0, int64(limit)).Result()
		items, resp.Limited = redisTruncate(items, limit)
		return items, err
	case "hash":
		items, cursor, err := client.HScan(ctx, key, 0, "*", int64(limit)).Result()
		var cut bool
		items, cut = redisTruncate(items, limit*2)
		resp.Limited = cursor != 0 || cut
		return items, err
	case "set":
		items, cursor, err := client.SScan(ctx, key, 0, "*", int64(limit)).Result()
		var cut bool
		items, cut = redisTruncate(items, limit)
		resp.Limited = cursor != 0 || cut
		return items, err
	case "zset":
		items, err := client.ZRangeWithScores(ctx, key, 0, int64(limit)).Result()
		items, resp.Limited = redisTruncate(items, limit)
		return items, err
	case "stream":
		items, err := client.XRangeN(ctx, key, "-", "+", int64(limit+1)).Result()
		items, resp.Limited = redisTruncate(items, limit)
		return items, err
	}
	return nil, fmt.Errorf("key type %s is not supported by the inspector", kind)
}

// redisInspectKey fills resp with type, TTL and a value preview of key.
func redisInspectKey(ctx context.Context, client *redis.Client, key string, limit int, resp *dbQueryResponse) error {
	if key == "" {
		return fmt.Errorf("Redis key is required")
	}
	kind, err := client.Type(ctx, key).Result()
	if err != nil {
		return err
	}
	ttl, err := client.PTTL(ctx, key).Result()
	if err != nil {
		return err
	}
	value, err := redisReadValue(ctx, client, key, kind, limit, resp)
	if err != nil && err != redis.Nil {
		return err
	}
	resp.StatementType = "INSPECT"
	resp.Columns = []string{"key", "type", "ttlMs", "value"}
	ttlMS := ttl.Milliseconds()
	if ttl < 0 {
		ttlMS = int64(ttl)
	}
	resp.Rows = append(resp.Rows, map[string]interface{}{"key": key, "type": kind, "ttlMs": ttlMS, "value": redisDisplayValue(value)})
	if resp.Limited {
		resp.Warning = "Collection preview; use a cursor command to read further entries."
	}
	return nil
}

// redisRunCommand executes an allow-listed command and renders list replies row by row.
func redisRunCommand(ctx context.Context, client *redis.Client, command string, rawArgs []string, limit int, resp *dbQueryResponse) error {
	args := []interface{}{command}
	for _, arg := range rawArgs {
		args = append(args, arg)
	}
	value, err := client.Do(ctx, args...).Result()
	if err != nil && err != redis.Nil {
		return err
	}
	list, ok := value.([]interface{})
	if !ok {
		resp.Rows = append(resp.Rows, map[string]interface{}{"value": redisDisplayValue(value)})
		return nil
	}
	for i, item := range list {
		if i >= limit {
			resp.Limited = true
			break
		}
		resp.Rows = append(resp.Rows, map[string]interface{}{"value": redisDisplayValue(item)})
	}
	return nil
}

func redisDisplayValue(value interface{}) interface{} {
	switch value.(type) {
	case nil, string, int64, float64, bool:
		return value
	default:
		encoded, _ := jsonutil.Marshal(value)
		return string(encoded)
	}
}
