package database

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestRedisConnectionOptions(t *testing.T) {
	for _, tc := range []struct {
		c    dbConnectionRequest
		addr string
		db   int
		tls  bool
	}{
		{dbConnectionRequest{Host: "::1", Driver: "redis", Database: "2"}, "[::1]:6379", 2, false},
		{dbConnectionRequest{Host: "localhost", Port: 6380, Database: "0", SSLMode: "require"}, "localhost:6380", 0, true},
		{dbConnectionRequest{DSN: "rediss://user:password@localhost:6380/3"}, "localhost:6380", 3, true},
	} {
		client, err := openRedisDatabase(tc.c)
		if err != nil {
			t.Fatal(err)
		}
		opts := client.Options()
		if opts.Addr != tc.addr || opts.DB != tc.db || (opts.TLSConfig != nil) != tc.tls {
			t.Fatalf("unexpected options: addr=%s db=%d", opts.Addr, opts.DB)
		}
		client.Close()
	}
	for _, c := range []dbConnectionRequest{{Host: "localhost", Database: "-1"}, {Host: "localhost", Database: "oops"}, {DSN: "http://user:secret@localhost"}, {Host: ""}} {
		if client, err := openRedisDatabase(c); err == nil {
			client.Close()
			t.Fatal("invalid connection accepted")
		} else if strings.Contains(err.Error(), "secret") {
			t.Fatal("error leaked URI password")
		}
	}
}

func TestRedisWritesRequireConfirmationBeforeConnecting(t *testing.T) {
	req := dbQueryRequest{Connection: dbConnectionRequest{Driver: "redis"}, Query: `{"command":"DEL","args":["key"]}`}
	body, _ := json.Marshal(req)
	rec := httptest.NewRecorder()
	databaseQueryHandler(rec, httptest.NewRequest(http.MethodPost, "/database/query", strings.NewReader(string(body))))
	if rec.Code != http.StatusConflict {
		t.Fatalf("got %d: %s", rec.Code, rec.Body.String())
	}
	req.Query = `{"command":"CONFIG","args":["SET","dir","/tmp"]}`
	if _, err := runRedisQuery(context.Background(), req); err == nil {
		t.Fatal("server control accepted")
	}
}

// Optional live-server check; uses an isolated Redis database supplied by the test caller.
func TestRedisLiveDatabase(t *testing.T) {
	uri := os.Getenv("ADOMNIA_TEST_REDIS_URI")
	if uri == "" {
		t.Skip("set ADOMNIA_TEST_REDIS_URI for a disposable Redis server")
	}
	c := dbConnectionRequest{Driver: "redis", DSN: uri}
	client, err := openRedisDatabase(c)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	ctx := context.Background()
	keys := []string{"adomnia:test:string", "adomnia:test:hash", "adomnia:test:list", "adomnia:test:set", "adomnia:test:zset", "adomnia:test:stream"}
	defer client.Del(ctx, keys...)
	run := func(query string, write bool, limit int) dbQueryResponse {
		t.Helper()
		out, err := runRedisQuery(ctx, dbQueryRequest{Connection: c, Query: query, Confirm: write, Limit: limit, TimeoutMS: 3000})
		if err != nil {
			t.Fatal(err)
		}
		return out
	}
	if out := run(`{"command":"PING"}`, false, 20); out.Rows[0]["value"] != "PONG" {
		t.Fatal(out)
	}
	run(`{"command":"SET","args":["adomnia:test:string","hello"]}`, true, 20)
	run(`{"command":"HSET","args":["adomnia:test:hash","name","Andrea"]}`, true, 20)
	run(`{"command":"RPUSH","args":["adomnia:test:list","a","b","c"]}`, true, 20)
	run(`{"command":"SADD","args":["adomnia:test:set","a","b"]}`, true, 20)
	run(`{"command":"ZADD","args":["adomnia:test:zset","1","a"]}`, true, 20)
	run(`{"command":"XADD","args":["adomnia:test:stream","*","name","event"]}`, true, 20)
	for i, key := range keys {
		body, _ := json.Marshal(redisQuery{Operation: "inspect", Key: key})
		out := run(string(body), false, 2)
		want := []string{"string", "hash", "list", "set", "zset", "stream"}[i]
		if out.Rows[0]["type"] != want {
			t.Fatalf("%s: %#v", want, out)
		}
		if out.Rows[0]["ttlMs"] != int64(-1) {
			t.Fatalf("no-expiration sentinel lost: %#v", out)
		}
	}
	scan := run(`{"operation":"scan","pattern":"adomnia:test:*"}`, false, 2)
	if len(scan.Rows) != 2 || !scan.Limited {
		t.Fatalf("scan limit: %#v", scan)
	}
	missing := run(`{"command":"GET","args":["adomnia:test:missing"]}`, false, 20)
	if missing.Rows[0]["value"] != nil {
		t.Fatal(missing)
	}
	body, _ := json.Marshal(c)
	rec := httptest.NewRecorder()
	databaseTestHandler(rec, httptest.NewRequest(http.MethodPost, "/database/test", strings.NewReader(string(body))))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"ok":true`) {
		t.Fatalf("ping: %s", rec.Body.String())
	}
}
