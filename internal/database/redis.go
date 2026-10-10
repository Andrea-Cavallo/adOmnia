package database

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"

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
	client, err := openRedisDatabase(req.Connection)
	if err != nil {
		return dbQueryResponse{}, err
	}
	defer client.Close()
	limit := req.Limit
	if limit <= 0 {
		limit = 200
	}
	if limit > 5000 {
		limit = 5000
	}
	start := time.Now()
	resp := dbQueryResponse{Driver: "redis", Columns: []string{"value"}, Rows: []map[string]interface{}{}, StatementType: command, Destructive: write}
	if q.Operation == "scan" {
		resp.StatementType = "SCAN"
		resp.Columns = []string{"name"}
		pattern := q.Pattern
		if pattern == "" {
			pattern = "*"
		}
		cursor := uint64(0)
		seen := map[string]bool{}
		for pages := 0; pages < 100; pages++ {
			keys, next, scanErr := client.Scan(ctx, cursor, pattern, int64(limit)).Result()
			if scanErr != nil {
				return resp, scanErr
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
	} else if q.Operation == "inspect" {
		if q.Key == "" {
			return resp, fmt.Errorf("Redis key is required")
		}
		kind, typeErr := client.Type(ctx, q.Key).Result()
		if typeErr != nil {
			return resp, typeErr
		}
		ttl, ttlErr := client.PTTL(ctx, q.Key).Result()
		if ttlErr != nil {
			return resp, ttlErr
		}
		var value interface{}
		switch kind {
		case "none":
			value = nil
		case "string":
			value, err = client.Get(ctx, q.Key).Result()
		case "list":
			items, readErr := client.LRange(ctx, q.Key, 0, int64(limit)).Result()
			err = readErr
			resp.Limited = len(items) > limit
			if resp.Limited {
				items = items[:limit]
			}
			value = items
		case "hash":
			items, cursor, readErr := client.HScan(ctx, q.Key, 0, "*", int64(limit)).Result()
			err = readErr
			resp.Limited = cursor != 0 || len(items) > limit*2
			if len(items) > limit*2 {
				items = items[:limit*2]
			}
			value = items
		case "set":
			items, cursor, readErr := client.SScan(ctx, q.Key, 0, "*", int64(limit)).Result()
			err = readErr
			resp.Limited = cursor != 0 || len(items) > limit
			if len(items) > limit {
				items = items[:limit]
			}
			value = items
		case "zset":
			items, readErr := client.ZRangeWithScores(ctx, q.Key, 0, int64(limit)).Result()
			err = readErr
			resp.Limited = len(items) > limit
			if resp.Limited {
				items = items[:limit]
			}
			value = items
		case "stream":
			items, readErr := client.XRangeN(ctx, q.Key, "-", "+", int64(limit+1)).Result()
			err = readErr
			resp.Limited = len(items) > limit
			if resp.Limited {
				items = items[:limit]
			}
			value = items
		default:
			return resp, fmt.Errorf("key type %s is not supported by the inspector", kind)
		}
		if err != nil && err != redis.Nil {
			return resp, err
		}
		resp.StatementType = "INSPECT"
		resp.Columns = []string{"key", "type", "ttlMs", "value"}
		ttlMS := ttl.Milliseconds()
		if ttl < 0 {
			ttlMS = int64(ttl)
		}
		resp.Rows = append(resp.Rows, map[string]interface{}{"key": q.Key, "type": kind, "ttlMs": ttlMS, "value": redisDisplayValue(value)})
		if resp.Limited {
			resp.Warning = "Collection preview; use a cursor command to read further entries."
		}
	} else {
		args := []interface{}{command}
		for _, arg := range q.Args {
			args = append(args, arg)
		}
		value, cmdErr := client.Do(ctx, args...).Result()
		if cmdErr != nil && cmdErr != redis.Nil {
			return resp, cmdErr
		}
		if list, ok := value.([]interface{}); ok {
			for i, item := range list {
				if i >= limit {
					resp.Limited = true
					break
				}
				resp.Rows = append(resp.Rows, map[string]interface{}{"value": redisDisplayValue(item)})
			}
		} else {
			resp.Rows = append(resp.Rows, map[string]interface{}{"value": redisDisplayValue(value)})
		}
	}
	resp.DurationMS = time.Since(start).Milliseconds()
	return resp, nil
}

func redisDisplayValue(value interface{}) interface{} {
	switch value.(type) {
	case nil, string, int64, float64, bool:
		return value
	default:
		encoded, _ := json.Marshal(value)
		return string(encoded)
	}
}
