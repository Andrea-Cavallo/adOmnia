# Redis in Database Studio

Choose **Redis** under Database Type. The default port is **6379** and an empty
database index selects **0**. Username and password support Redis ACL users;
leave the username empty for password-only authentication. Enable TLS for
certificate-verified connections, or provide a `redis://` / `rediss://` URI in
Raw DSN. The URI overrides the individual fields.

**Test Connection** performs an authenticated PING. **Key Explorer → Refresh**
scans up to 1,000 keys with SCAN (at most 100 scan pages); it does not use KEYS.
The search field filters the loaded keys. Select a key to open an inspection
query, then Run to view its type, TTL in milliseconds and value. TTL -1 means
no expiration; -2 means the key does not exist. Collection previews respect
the selected limit and identify partial results.

The JSON command runner reuses query tabs, history, favorites, variable
substitution, timeout and JSON/CSV result exports:

```json
{"command":"GET","args":["user:1"]}
```

```json
{"command":"SET","args":["user:1","hello","EX","60"]}
```

```json
{"operation":"scan","pattern":"user:*"}
```

```json
{"operation":"inspect","key":"user:1"}
```

Common string, hash, list, set, sorted-set and stream commands are supported.
Writes require confirmation both in the UI and backend. New Key creates a
string with an empty value and explicitly confirms a possible overwrite.
Server-control commands, scripts, transactions and subscriptions are not
available in this runner. Pub/Sub remains in Broker Studio. Redis Cluster and
Sentinel connection discovery are not configured by this form.

Connection settings remain local. Passwords and credential-bearing URIs use
the existing session-only/Vault protection. Persistence adds only the `redis`
driver value to the existing connection structure: no schema migration is
required and previous SQL/MongoDB connections remain readable.

Protocol references: [SCAN](https://redis.io/docs/latest/commands/scan/),
[go-redis connection options](https://redis.io/docs/latest/develop/clients/go/connect/).

For a disposable Redis integration test:

```powershell
$env:ADOMNIA_TEST_REDIS_URI = 'redis://127.0.0.1:6379/0'
go test ./internal/database -run Redis -count=1
```

Use a disposable database: the integration test creates and removes keys with
the `adomnia:test:` prefix.
