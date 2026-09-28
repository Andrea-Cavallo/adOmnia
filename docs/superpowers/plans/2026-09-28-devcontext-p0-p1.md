# Developer Context (P0 + P1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** adOmnia understands the project opened in gO (services, datasources, env vars, contracts, routes, tables, topics) and any of those entities can be found in the command palette and opened in the right tool through one typed router.

**Architecture:** A new Go package `internal/devcontext` scans the gO session root with per-file detectors (`go/parser` for Go, `yaml.v3` for compose/OAS), keeps an in-memory snapshot per session and emits `devcontext:changed`. A thin root binding (`devcontext_bindings.go`) exposes it and listens to gO save/close events. On the frontend, `lib/entities/` is the router (`registerOpener` / `actionsFor` / `openEntity`) with a per-panel handoff hook; the command palette gets "Project" and "Symbols" groups.

**Tech Stack:** Go 1.26 stdlib (`go/ast`, `go/parser`, `go/types.ExprString`, `net/url`, `reflect.StructTag`), `gopkg.in/yaml.v3` (already in `go.mod`), Wails 3 bindings, React 18 + TypeScript + Zustand, Vitest (node environment, no DOM).

**Spec:** `docs/superpowers/specs/2026-09-28-devcontext-p0-p1-design.md`

## Global Constraints

- Branch: `feat/goide-phase3`. Commit after every task (`<type>: <description>`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).
- Root Go files are binding-only; all logic lives in `internal/devcontext`.
- No new Go or npm dependencies. No fsnotify.
- Context root = gO session project folder; no context without an open gO project.
- Secrets never reach the frontend: `.env` values of keys matching `PASSWORD|PASSWD|SECRET|TOKEN|KEY` are replaced by `••••••`; URL passwords are redacted; compose passwords are never read.
- Context proposes config; it never writes env vars or connections without a user click.
- AST-derived entities are `inferred` and always carry `file:line`.
- Walk limits: 120 000 files, skip `.git node_modules vendor target build dist .gradle .idea .venv __pycache__ .next bin obj testdata` and hidden dirs; files > 2 MB are not parsed; scan timeout 30 s.
- Wails CLI is not installed: TS bindings are hand-written with `$Call.ByID(fnv1a("main.DevContext.<Method>"))` (IDs precomputed below, verified against `main.OASLint.Lint` = 325496117).
- Vitest runs in **node** (no jsdom): frontend tests cover pure functions only; DOM/panel behaviour is verified in the manual smoke.
- UI uses existing tokens (`surface-*`, `text-*`, `border-*`, `accent`), no hardcoded palette colours.

### Deviations from the spec (decided while planning)

- `file` kind dropped (nothing produces it in v1); `module` kind added (from `go.mod`). "Go to source" is one generic `source` intent for every ref with a `file:line`.
- `contract → import` intent dropped: API Docs already has save-to-collection once the spec is open.
- `envvar → show` uses the shared notice bar instead of a popover.
- DB `connect` creates (or reuses) a saved connection **on the user's click**, without password — DB Studio persists connections by design; a draft-only form would need a panel refactor.
- `Ctrl+P` already reaches gO Quick Open when gO is mounted (gO's capture-phase handler calls `preventDefault`, the global handler skips prevented events) and gO binds no `Ctrl+K`: no shortcut change, only a smoke check.
- Coalescing = one scan at a time per session (mutex); a request arriving mid-scan runs right after.

## Review Focus

1. **DB handoff before DatabasePanel hydration** — `persistConnections` would overwrite saved connections with a one-item list. Expected: handoff waits (handler returns `false` until `hydrated`). Pinned by `upsertConnectionFromRef` tests (Task 11) + handler guard.
2. **`DATABASE_URL=postgres://user:pw@…` in `.env`** — key isn't "secret-looking" but the value holds a password. Expected: displayed value redacted, datasource has no password. Pinned in Task 2.
3. **Saving a half-typed Go file** — expected: no crash, no warning spam, previously valid entities of other files untouched. Pinned in Task 5 and Task 6.
4. **`ReadContextFile` with `../` or `.env`** — expected: refused. Pinned in Task 6.
5. **UI images next to real brokers (`kafka-ui`, `redis-commander`) and container-only ports (`"6379"`)** — expected: no datasource. Pinned in Task 2.

---

### Task 1: Context model and merge

**Files:**
- Create: `internal/devcontext/types.go`
- Test: `internal/devcontext/types_test.go`

**Interfaces:**
- Produces: `Entity`, `Source`, `Snapshot`, `ConfidenceCertain`, `ConfidenceInferred`, `entity(kind, key, label, confidence string, attrs map[string]string, src Source) Entity`, `merge(groups ...[]Entity) []Entity`.

- [ ] **Step 1: Write the failing test**

```go
package devcontext

import "testing"

func TestMergeFoldsSameIDAcrossSources(t *testing.T) {
	code := entity("route", "GET /payments/{id}", "GET /payments/{id}", ConfidenceInferred,
		map[string]string{"handler": "getPayment"}, Source{"goroutes", "api/routes.go", 12})
	oas := entity("route", "GET /payments/{id}", "GET /payments/{id}", ConfidenceCertain,
		map[string]string{"handler": "ignored", "contract": "api/openapi.yaml"}, Source{"oas", "api/openapi.yaml", 30})
	table := entity("table", "payments", "payments", ConfidenceInferred, nil, Source{"goliterals", "store.go", 4})

	got := merge([]Entity{code}, []Entity{oas, table})

	if len(got) != 2 {
		t.Fatalf("want 2 entities, got %d: %+v", len(got), got)
	}
	route := got[0]
	if route.Kind != "route" || route.ID != "route:GET /payments/{id}" {
		t.Fatalf("entities must be sorted by kind then id, got %+v", got)
	}
	if len(route.Sources) != 2 {
		t.Fatalf("sources must be appended, got %+v", route.Sources)
	}
	if route.Attrs["handler"] != "getPayment" || route.Attrs["contract"] != "api/openapi.yaml" {
		t.Fatalf("attrs must be unioned with first writer winning, got %+v", route.Attrs)
	}
	if route.Confidence != ConfidenceCertain {
		t.Fatalf("certain must win over inferred, got %s", route.Confidence)
	}
	if code.Attrs["contract"] != "" || len(code.Sources) != 1 {
		t.Fatalf("merge must not mutate its inputs, got %+v", code)
	}
}

func TestMergeEmptyIsNonNil(t *testing.T) {
	if got := merge(); got == nil {
		t.Fatal("merge must return a non-nil slice so JSON encodes []")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/devcontext/ -run TestMerge -v`
Expected: FAIL — `undefined: entity` / package has no non-test Go files.

- [ ] **Step 3: Write minimal implementation**

```go
// Package devcontext builds the project context of a gO session: the
// services, datasources, env vars, contracts, routes, tables and topics a
// developer works with, each traceable to the file and line it came from.
package devcontext

import (
	"sort"
	"time"
)

const (
	ConfidenceCertain  = "certain"
	ConfidenceInferred = "inferred"
)

type Source struct {
	Detector string `json:"detector"`
	File     string `json:"file"` // root-relative, slash separated
	Line     int    `json:"line"`
}

type Entity struct {
	ID         string            `json:"id"`
	Kind       string            `json:"kind"`
	Label      string            `json:"label"`
	Attrs      map[string]string `json:"attrs"`
	Sources    []Source          `json:"sources"`
	Confidence string            `json:"confidence"`
}

type Snapshot struct {
	SessionID string    `json:"sessionId"`
	Root      string    `json:"root"`
	Version   int64     `json:"version"`
	Entities  []Entity  `json:"entities"`
	Warnings  []string  `json:"warnings"`
	ScannedAt time.Time `json:"scannedAt"`
}

func entity(kind, key, label, confidence string, attrs map[string]string, src Source) Entity {
	if attrs == nil {
		attrs = map[string]string{}
	}
	return Entity{ID: kind + ":" + key, Kind: kind, Label: label, Attrs: attrs, Sources: []Source{src}, Confidence: confidence}
}

// merge folds entities sharing an ID: sources are appended, attrs are unioned
// (first writer wins) and certain beats inferred. Inputs are never mutated.
func merge(groups ...[]Entity) []Entity {
	byID := map[string]*Entity{}
	for _, group := range groups {
		for _, e := range group {
			current, ok := byID[e.ID]
			if !ok {
				fresh := e
				fresh.Attrs = make(map[string]string, len(e.Attrs))
				for k, v := range e.Attrs {
					fresh.Attrs[k] = v
				}
				fresh.Sources = append([]Source(nil), e.Sources...)
				byID[e.ID] = &fresh
				continue
			}
			current.Sources = append(current.Sources, e.Sources...)
			for k, v := range e.Attrs {
				if _, exists := current.Attrs[k]; !exists {
					current.Attrs[k] = v
				}
			}
			if e.Confidence == ConfidenceCertain {
				current.Confidence = ConfidenceCertain
			}
		}
	}
	out := make([]Entity, 0, len(byID))
	for _, e := range byID {
		out = append(out, *e)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Kind != out[j].Kind {
			return out[i].Kind < out[j].Kind
		}
		return out[i].ID < out[j].ID
	})
	return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/devcontext/ -run TestMerge -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add internal/devcontext/types.go internal/devcontext/types_test.go
git commit -m "feat(devcontext): entity model and source-preserving merge"
```

---

### Task 2: Config detectors — go.mod, .env, docker compose

**Files:**
- Create: `internal/devcontext/gomod.go`, `internal/devcontext/dotenv.go`, `internal/devcontext/compose.go`
- Test: `internal/devcontext/config_test.go`

**Interfaces:**
- Consumes: `entity`, `Source`, `ConfidenceCertain/Inferred` (Task 1).
- Produces:
  - `detectGoMod(rel string, data []byte) ([]Entity, error)`
  - `type dotenvEntry struct{ Key, Value string; Line int }`, `parseDotenv(data []byte) []dotenvEntry`
  - `detectDotenv(rel string, data []byte) ([]Entity, error)`, `displayValue(key, value string) string`, `secretMask = "••••••"`
  - `datasource(typ, host, port, user, database, confidence string, src Source) Entity` (ID `datasource:<type>@<host>:<port>[/<db>]`)
  - `detectCompose(rel string, data []byte, env map[string]string) ([]Entity, error)`, `imageType(image string) string`
  - `documentNode(n *yaml.Node) *yaml.Node`, `mappingValue(n *yaml.Node, key string) *yaml.Node`
  - `isDotenv(base string) bool`, `isCompose(base string) bool`

- [ ] **Step 1: Write the failing tests**

```go
package devcontext

import (
	"strings"
	"testing"
)

func byID(entities []Entity) map[string]Entity {
	out := map[string]Entity{}
	for _, e := range entities {
		out[e.ID] = e
	}
	return out
}

func TestDetectGoMod(t *testing.T) {
	got, err := detectGoMod("svc/go.mod", []byte("// header\nmodule example.com/payments\n\ngo 1.26\n"))
	if err != nil {
		t.Fatal(err)
	}
	e := byID(got)["module:example.com/payments"]
	if e.Attrs["dir"] != "svc" || e.Sources[0].Line != 2 || e.Confidence != ConfidenceCertain {
		t.Fatalf("unexpected module entity %+v", e)
	}
}

func TestDetectDotenvMasksSecretsAndRedactsURLPasswords(t *testing.T) {
	data := []byte(`# comment
export PORT=8080
API_TOKEN="abc123"
DATABASE_URL=postgres://app:s3cret@localhost:5432/payments?sslmode=disable
KAFKA_BROKERS=localhost:9092,localhost:9093
GREETING='hello # not a comment'
PLAIN=value # trailing comment
`)
	got, err := detectDotenv(".env", data)
	if err != nil {
		t.Fatal(err)
	}
	ids := byID(got)
	if v := ids["envvar:PORT"].Attrs["value"]; v != "8080" {
		t.Fatalf("PORT = %q", v)
	}
	if v := ids["envvar:API_TOKEN"].Attrs["value"]; v != secretMask {
		t.Fatalf("API_TOKEN must be masked, got %q", v)
	}
	if v := ids["envvar:DATABASE_URL"].Attrs["value"]; v == "" || strings.Contains(v, "s3cret") {
		t.Fatalf("DATABASE_URL password must be redacted, got %q", v)
	}
	if v := ids["envvar:GREETING"].Attrs["value"]; v != "hello # not a comment" {
		t.Fatalf("quoted value must be kept verbatim, got %q", v)
	}
	if v := ids["envvar:PLAIN"].Attrs["value"]; v != "value" {
		t.Fatalf("inline comment must be stripped, got %q", v)
	}
	pg := ids["datasource:postgres@localhost:5432/payments"]
	if pg.Attrs["user"] != "app" || pg.Attrs["password"] != "" {
		t.Fatalf("postgres datasource must carry user and no password: %+v", pg.Attrs)
	}
	if _, ok := ids["datasource:kafka@localhost:9092"]; !ok {
		t.Fatalf("kafka broker list must become a datasource: %+v", ids)
	}
	if ids["envvar:PORT"].Sources[0].Line != 2 {
		t.Fatalf("line numbers must be 1-based file lines")
	}
}

func TestDetectCompose(t *testing.T) {
	data := []byte(`services:
  db:
    image: postgres:16
    ports: ["5432:5432"]
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: never-read
      POSTGRES_DB: ${POSTGRES_DB:-payments}
  kafka:
    image: bitnami/kafka:3.7
    ports:
      - "127.0.0.1:9092:9092/tcp"
  kafka-ui:
    image: provectuslabs/kafka-ui
    ports: ["8081:8080"]
  cache:
    image: redis:7
    ports: ["6379"]
  mongo:
    image: mongo:7
    ports:
      - target: 27017
        published: 27018
    environment:
      - MONGO_INITDB_ROOT_USERNAME=root
  api:
    build: .
    ports: ["${API_PORT}:8080"]
`)
	got, err := detectCompose("docker-compose.yml", data, map[string]string{})
	if err != nil {
		t.Fatal(err)
	}
	ids := byID(got)

	pg := ids["datasource:postgres@localhost:5432/payments"]
	if pg.Attrs["user"] != "app" || pg.Attrs["password"] != "" || pg.Confidence != ConfidenceCertain {
		t.Fatalf("postgres from compose: %+v", pg)
	}
	if _, ok := ids["datasource:kafka@localhost:9092"]; !ok {
		t.Fatalf("kafka with ip:host:container/proto port must be detected: %+v", ids)
	}
	if _, ok := ids["datasource:mongodb@localhost:27018"]; !ok {
		t.Fatalf("long-syntax port must use published: %+v", ids)
	}
	for id := range ids {
		if strings.HasPrefix(id, "datasource:") && (strings.Contains(id, "8081") || strings.Contains(id, "redis")) {
			t.Fatalf("kafka-ui and container-only redis must not be datasources, found %s", id)
		}
	}
	if s := ids["service:compose:db"]; s.Attrs["port"] != "5432" || s.Sources[0].Line != 2 {
		t.Fatalf("service entity: %+v", s)
	}
	if s := ids["service:compose:api"]; s.Confidence != ConfidenceInferred {
		t.Fatalf("unresolved ${API_PORT} must mark the service inferred: %+v", s)
	}
}

func TestDetectComposeInterpolatesFromEnv(t *testing.T) {
	data := []byte("services:\n  db:\n    image: postgres\n    ports: [\"${DB_PORT}:5432\"]\n")
	got, _ := detectCompose("compose.yaml", data, map[string]string{"DB_PORT": "15432"})
	if _, ok := byID(got)["datasource:postgres@localhost:15432/postgres"]; !ok {
		t.Fatalf("expected interpolated port, got %+v", got)
	}
}

func TestDetectComposeInvalidYAML(t *testing.T) {
	if _, err := detectCompose("compose.yml", []byte("services: [\n"), nil); err == nil {
		t.Fatal("invalid YAML must return an error (it becomes a snapshot warning)")
	}
}

func TestImageType(t *testing.T) {
	cases := map[string]string{
		"postgres:16": "postgres", "postgis/postgis": "postgres", "mariadb:11": "mysql", "mysql": "mysql",
		"mongo:7": "mongodb", "redis:7": "redis", "valkey/valkey": "redis", "bitnami/kafka": "kafka",
		"confluentinc/cp-kafka:7.6.0": "kafka", "docker.redpanda.com/redpandadata/redpanda": "kafka",
		"rabbitmq:3-management": "rabbitmq", "nats:2": "nats",
		"provectuslabs/kafka-ui": "", "rediscommander/redis-commander": "", "nginx": "",
	}
	for image, want := range cases {
		if got := imageType(image); got != want {
			t.Errorf("imageType(%q) = %q, want %q", image, got, want)
		}
	}
}

func TestFileNameMatchers(t *testing.T) {
	for _, name := range []string{"docker-compose.yml", "compose.yaml", "docker-compose.dev.yml", "compose.override.yaml"} {
		if !isCompose(name) {
			t.Errorf("isCompose(%q) = false", name)
		}
	}
	if isCompose("mycompose.yml") || !isDotenv(".env") || !isDotenv(".env.local") || isDotenv("env.go") {
		t.Error("matcher mismatch")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/devcontext/ -run 'TestDetectGoMod|TestDetectDotenv|TestDetectCompose|TestImageType|TestFileNameMatchers' -v`
Expected: FAIL — `undefined: detectGoMod` (and the other detectors).

- [ ] **Step 3: Write `gomod.go`**

```go
package devcontext

import (
	"fmt"
	"path"
	"strings"
)

func detectGoMod(rel string, data []byte) ([]Entity, error) {
	for i, line := range strings.Split(string(data), "\n") {
		rest, ok := strings.CutPrefix(strings.TrimSpace(line), "module ")
		if !ok {
			continue
		}
		module := strings.Trim(strings.TrimSpace(rest), `"`)
		return []Entity{entity("module", module, module, ConfidenceCertain,
			map[string]string{"dir": path.Dir(rel)}, Source{"gomod", rel, i + 1})}, nil
	}
	return nil, fmt.Errorf("no module directive")
}
```

- [ ] **Step 4: Write `dotenv.go`**

```go
package devcontext

import (
	"net"
	"net/url"
	"regexp"
	"strings"
)

const secretMask = "••••••"

var (
	secretKey  = regexp.MustCompile(`(?i)(PASSWORD|PASSWD|SECRET|TOKEN|KEY)`)
	brokerList = regexp.MustCompile(`^[\w.-]+:\d+(,[\w.-]+:\d+)*$`)
	dsnTypes   = map[string]string{
		"postgres": "postgres", "postgresql": "postgres", "mysql": "mysql",
		"mongodb": "mongodb", "mongodb+srv": "mongodb", "redis": "redis", "rediss": "redis",
		"amqp": "rabbitmq", "amqps": "rabbitmq", "nats": "nats", "kafka": "kafka",
	}
)

type dotenvEntry struct {
	Key, Value string
	Line       int
}

func isDotenv(base string) bool { return base == ".env" || strings.HasPrefix(base, ".env.") }

func parseDotenv(data []byte) []dotenvEntry {
	var out []dotenvEntry
	for i, raw := range strings.Split(string(data), "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		key, value, ok := strings.Cut(line, "=")
		key = strings.TrimSpace(key)
		if !ok || key == "" {
			continue
		}
		value = strings.TrimSpace(value)
		if n := len(value); n >= 2 && (value[0] == '"' || value[0] == '\'') && value[n-1] == value[0] {
			value = value[1 : n-1]
		} else if idx := strings.Index(value, " #"); idx >= 0 {
			value = strings.TrimSpace(value[:idx])
		}
		out = append(out, dotenvEntry{Key: key, Value: value, Line: i + 1})
	}
	return out
}

func detectDotenv(rel string, data []byte) ([]Entity, error) {
	var out []Entity
	for _, e := range parseDotenv(data) {
		src := Source{"dotenv", rel, e.Line}
		out = append(out, entity("envvar", e.Key, e.Key, ConfidenceCertain,
			map[string]string{"value": displayValue(e.Key, e.Value)}, src))
		if ds, ok := datasourceFromValue(e.Key, e.Value, src); ok {
			out = append(out, ds)
		}
	}
	return out, nil
}

// displayValue is the only form of an env value that leaves the backend.
func displayValue(key, value string) string {
	if secretKey.MatchString(key) {
		return secretMask
	}
	if u, err := url.Parse(value); err == nil && u.User != nil {
		if _, has := u.User.Password(); has {
			return u.Redacted()
		}
	}
	return value
}

func datasourceFromValue(key, value string, src Source) (Entity, bool) {
	if u, err := url.Parse(value); err == nil && u.Host != "" {
		if typ, ok := dsnTypes[strings.ToLower(u.Scheme)]; ok {
			user := ""
			if u.User != nil {
				user = u.User.Username()
			}
			return datasource(typ, u.Hostname(), u.Port(), user, strings.TrimPrefix(u.Path, "/"), ConfidenceCertain, src), true
		}
	}
	if strings.Contains(strings.ToUpper(key), "KAFKA") && brokerList.MatchString(value) {
		host, port, err := net.SplitHostPort(strings.Split(value, ",")[0])
		if err == nil {
			return datasource("kafka", host, port, "", "", ConfidenceCertain, src), true
		}
	}
	return Entity{}, false
}

// datasource never carries a password: connections are completed by the user.
func datasource(typ, host, port, user, database, confidence string, src Source) Entity {
	key := typ + "@" + host + ":" + port
	if database != "" {
		key += "/" + database
	}
	attrs := map[string]string{"type": typ, "host": host, "port": port}
	if user != "" {
		attrs["user"] = user
	}
	if database != "" {
		attrs["database"] = database
	}
	return entity("datasource", key, key, confidence, attrs, src)
}
```

- [ ] **Step 5: Write `compose.go`**

```go
package devcontext

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

var (
	composeName   = regexp.MustCompile(`^(docker-)?compose([.-][\w.-]+)?\.ya?ml$`)
	interpolation = regexp.MustCompile(`\$\{([A-Za-z_][A-Za-z0-9_]*)(?::?-([^}]*))?\}`)
)

func isCompose(base string) bool { return composeName.MatchString(base) }

type composeService struct {
	Image       string    `yaml:"image"`
	Ports       []any     `yaml:"ports"`
	Environment yaml.Node `yaml:"environment"`
}

func detectCompose(rel string, data []byte, env map[string]string) ([]Entity, error) {
	var root yaml.Node
	if err := yaml.Unmarshal(data, &root); err != nil {
		return nil, fmt.Errorf("invalid YAML: %w", err)
	}
	services := mappingValue(documentNode(&root), "services")
	if services == nil {
		return nil, nil
	}
	var out []Entity
	for i := 0; i+1 < len(services.Content); i += 2 {
		nameNode, body := services.Content[i], services.Content[i+1]
		var svc composeService
		if err := body.Decode(&svc); err != nil {
			continue
		}
		src := Source{"compose", rel, nameNode.Line}
		confidence := ConfidenceCertain
		image, ok := interpolate(svc.Image, env)
		if !ok {
			confidence = ConfidenceInferred
		}
		hostPort := ""
		var ports []string
		for _, p := range svc.Ports {
			host, container, ok := parsePort(p, env)
			if !ok {
				confidence = ConfidenceInferred
				continue
			}
			if host == "" { // container-only port: Docker picks a random host port
				continue
			}
			ports = append(ports, host+":"+container)
			if hostPort == "" {
				hostPort = host
			}
		}
		attrs := map[string]string{"origin": "compose", "image": image, "ports": strings.Join(ports, ",")}
		if hostPort != "" {
			attrs["host"], attrs["port"] = "localhost", hostPort
		}
		out = append(out, entity("service", "compose:"+nameNode.Value, nameNode.Value, confidence, attrs, src))
		if typ := imageType(image); typ != "" && hostPort != "" {
			user, database := composeCredentials(typ, composeEnv(&svc.Environment, env))
			out = append(out, datasource(typ, "localhost", hostPort, user, database, confidence, src))
		}
	}
	return out, nil
}

func interpolate(s string, env map[string]string) (string, bool) {
	ok := true
	out := interpolation.ReplaceAllStringFunc(s, func(m string) string {
		parts := interpolation.FindStringSubmatch(m)
		if v := env[parts[1]]; v != "" {
			return v
		}
		if strings.Contains(m, "-") { // ${VAR:-default} or ${VAR-default}
			return parts[2]
		}
		ok = false
		return m
	})
	return out, ok
}

// parsePort returns host and container port; host is "" for container-only ports.
func parsePort(p any, env map[string]string) (string, string, bool) {
	switch v := p.(type) {
	case int:
		return "", strconv.Itoa(v), true
	case string:
		s, ok := interpolate(v, env)
		if !ok {
			return "", "", false
		}
		parts := strings.Split(strings.SplitN(s, "/", 2)[0], ":")
		switch len(parts) {
		case 1:
			return "", parts[0], true
		case 2:
			return parts[0], parts[1], true
		case 3:
			return parts[1], parts[2], true
		}
	case map[string]any:
		published, target := fmt.Sprint(v["published"]), fmt.Sprint(v["target"])
		if v["published"] == nil {
			published = ""
		}
		return published, target, v["target"] != nil
	}
	return "", "", false
}

func imageType(image string) string {
	name := image
	if i := strings.LastIndex(name, "/"); i >= 0 {
		name = name[i+1:]
	}
	if i := strings.IndexAny(name, ":@"); i >= 0 {
		name = name[:i]
	}
	switch name {
	case "postgres", "postgis":
		return "postgres"
	case "mysql", "mariadb":
		return "mysql"
	case "mongo":
		return "mongodb"
	case "redis", "redis-stack", "redis-stack-server", "valkey":
		return "redis"
	case "kafka", "cp-kafka", "cp-server", "redpanda":
		return "kafka"
	case "rabbitmq":
		return "rabbitmq"
	case "nats":
		return "nats"
	}
	return ""
}

func composeEnv(node *yaml.Node, env map[string]string) map[string]string {
	vars := map[string]string{}
	switch node.Kind {
	case yaml.MappingNode:
		var m map[string]any
		if node.Decode(&m) == nil {
			for k, v := range m {
				vars[k] = fmt.Sprint(v)
			}
		}
	case yaml.SequenceNode:
		var list []string
		if node.Decode(&list) == nil {
			for _, item := range list {
				if k, v, ok := strings.Cut(item, "="); ok {
					vars[k] = v
				}
			}
		}
	}
	for k, v := range vars {
		vars[k], _ = interpolate(v, env)
	}
	return vars
}

// composeCredentials reads user and database only; passwords are never read.
func composeCredentials(typ string, vars map[string]string) (string, string) {
	switch typ {
	case "postgres":
		user := firstNonEmpty(vars["POSTGRES_USER"], "postgres")
		return user, firstNonEmpty(vars["POSTGRES_DB"], user)
	case "mysql":
		return firstNonEmpty(vars["MYSQL_USER"], vars["MARIADB_USER"], "root"), firstNonEmpty(vars["MYSQL_DATABASE"], vars["MARIADB_DATABASE"])
	case "mongodb":
		return vars["MONGO_INITDB_ROOT_USERNAME"], vars["MONGO_INITDB_DATABASE"]
	}
	return "", ""
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func documentNode(n *yaml.Node) *yaml.Node {
	if n.Kind == yaml.DocumentNode && len(n.Content) > 0 {
		return n.Content[0]
	}
	return n
}

func mappingValue(n *yaml.Node, key string) *yaml.Node {
	if n == nil || n.Kind != yaml.MappingNode {
		return nil
	}
	for i := 0; i+1 < len(n.Content); i += 2 {
		if n.Content[i].Value == key {
			return n.Content[i+1]
		}
	}
	return nil
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `go test ./internal/devcontext/ -v`
Expected: PASS (all Task 1 + Task 2 tests).

- [ ] **Step 7: Commit**

```bash
git add internal/devcontext/
git commit -m "feat(devcontext): go.mod, .env and docker compose detectors with secret masking"
```

---

### Task 3: Contracts detector — OpenAPI routes, proto, WSDL

**Files:**
- Create: `internal/devcontext/contracts.go`, `internal/devcontext/routes_path.go`
- Test: `internal/devcontext/contracts_test.go`

**Interfaces:**
- Consumes: `entity`, `documentNode`, `mappingValue` (Tasks 1–2).
- Produces: `detectContractFile(rel string, data []byte) ([]Entity, error)`, `detectOpenAPI(rel string, data []byte) ([]Entity, error)`, `routeEntity(method, rawPath, confidence string, attrs map[string]string, src Source) Entity` (ID `route:<METHOD> <normalized path>`, attrs `method`, `path`), `normalizePath(p string) string`.

- [ ] **Step 1: Write the failing test**

```go
package devcontext

import "testing"

func TestNormalizePath(t *testing.T) {
	cases := map[string]string{
		"/users/:id":           "/users/{id}",
		"/users/{id}":          "/users/{id}",
		"/users/{id:[0-9]+}/":  "/users/{id}",
		"/files/{path...}":     "/files/{path...}",
		"/":                    "/",
		"":                     "/",
		"/static/*filepath":    "/static/*filepath",
	}
	for in, want := range cases {
		if got := normalizePath(in); got != want {
			t.Errorf("normalizePath(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestDetectOpenAPIYAML(t *testing.T) {
	data := []byte(`openapi: 3.0.3
info: {title: Payments, version: "1"}
paths:
  /payments:
    get: {}
    post: {}
    parameters: []
  /payments/{id}:
    get: {}
`)
	got, err := detectOpenAPI("api/openapi.yaml", data)
	if err != nil {
		t.Fatal(err)
	}
	ids := byID(got)
	if ids["contract:api/openapi.yaml"].Attrs["type"] != "oas" {
		t.Fatalf("contract missing: %+v", ids)
	}
	post := ids["route:POST /payments"]
	if post.Confidence != ConfidenceCertain || post.Attrs["contract"] != "api/openapi.yaml" || post.Sources[0].Line != 6 {
		t.Fatalf("POST route: %+v", post)
	}
	if _, ok := ids["route:GET /payments/{id}"]; !ok {
		t.Fatalf("GET /payments/{id} missing: %+v", ids)
	}
	if len(got) != 4 {
		t.Fatalf("'parameters' is not an operation; want 4 entities, got %d", len(got))
	}
}

func TestDetectOpenAPIJSONAndNonSpecs(t *testing.T) {
	spec := []byte("{\n  \"swagger\": \"2.0\",\n  \"paths\": {\"/ping\": {\"get\": {}}}\n}")
	got, err := detectOpenAPI("swagger.json", spec)
	if err != nil || len(byID(got)) != 2 {
		t.Fatalf("swagger json: %v %+v", err, got)
	}
	for name, data := range map[string]string{
		"package.json": `{"name": "x", "dependencies": {}}`,
		"k8s.yaml":     "spec:\n  openapi: nested-not-root\n",
	} {
		if got, _ := detectOpenAPI(name, []byte(data)); len(got) != 0 {
			t.Errorf("%s must not be detected as OpenAPI: %+v", name, got)
		}
	}
}

func TestDetectContractFile(t *testing.T) {
	got, _ := detectContractFile("proto/payments.proto", nil)
	if byID(got)["contract:proto/payments.proto"].Attrs["type"] != "proto" {
		t.Fatalf("proto: %+v", got)
	}
	got, _ = detectContractFile("legacy/ledger.wsdl", nil)
	if byID(got)["contract:legacy/ledger.wsdl"].Attrs["type"] != "wsdl" {
		t.Fatalf("wsdl: %+v", got)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/devcontext/ -run 'TestNormalizePath|TestDetectOpenAPI|TestDetectContractFile' -v`
Expected: FAIL — `undefined: normalizePath`.

- [ ] **Step 3: Write `routes_path.go`**

```go
package devcontext

import (
	"regexp"
	"strings"
)

var pathParam = regexp.MustCompile(`^(?::([A-Za-z_]\w*)|\{([A-Za-z_]\w*)(?::[^}]*)?\})$`)

// normalizePath makes gin/echo (:id), chi/stdlib ({id}) and gorilla
// ({id:regex}) paths comparable, so code and OpenAPI routes merge.
func normalizePath(p string) string {
	segments := strings.Split(p, "/")
	for i, s := range segments {
		if m := pathParam.FindStringSubmatch(s); m != nil {
			name := m[1]
			if name == "" {
				name = m[2]
			}
			segments[i] = "{" + name + "}"
		}
	}
	out := strings.Join(segments, "/")
	if len(out) > 1 {
		out = strings.TrimSuffix(out, "/")
	}
	if out == "" {
		return "/"
	}
	return out
}

func routeEntity(method, rawPath, confidence string, attrs map[string]string, src Source) Entity {
	p := normalizePath(rawPath)
	if attrs == nil {
		attrs = map[string]string{}
	}
	attrs["method"], attrs["path"] = method, p
	key := method + " " + p
	return entity("route", key, key, confidence, attrs, src)
}
```

- [ ] **Step 4: Write `contracts.go`**

```go
package devcontext

import (
	"fmt"
	"path"
	"regexp"
	"strings"

	"gopkg.in/yaml.v3"
)

var (
	oasYAMLRoot = regexp.MustCompile(`(?m)^(openapi|swagger)\s*:`)
	oasJSONRoot = regexp.MustCompile(`"(openapi|swagger)"\s*:`)
	oasMethods  = map[string]bool{"get": true, "put": true, "post": true, "delete": true, "options": true, "head": true, "patch": true, "trace": true}
)

func contractEntity(rel, typ string) Entity {
	return entity("contract", rel, path.Base(rel), ConfidenceCertain,
		map[string]string{"type": typ, "path": rel}, Source{"contracts", rel, 1})
}

func detectContractFile(rel string, _ []byte) ([]Entity, error) {
	return []Entity{contractEntity(rel, strings.TrimPrefix(path.Ext(rel), "."))}, nil
}

func detectOpenAPI(rel string, data []byte) ([]Entity, error) {
	head := data
	if len(head) > 4096 {
		head = head[:4096]
	}
	root := oasYAMLRoot
	if strings.HasSuffix(rel, ".json") {
		root = oasJSONRoot
	}
	if !root.Match(head) {
		return nil, nil
	}
	var doc yaml.Node
	if err := yaml.Unmarshal(data, &doc); err != nil {
		return nil, fmt.Errorf("invalid OpenAPI document: %w", err)
	}
	out := []Entity{contractEntity(rel, "oas")}
	paths := mappingValue(documentNode(&doc), "paths")
	if paths == nil {
		return out, nil
	}
	for i := 0; i+1 < len(paths.Content); i += 2 {
		p, ops := paths.Content[i].Value, paths.Content[i+1]
		if ops.Kind != yaml.MappingNode {
			continue
		}
		for j := 0; j+1 < len(ops.Content); j += 2 {
			method := strings.ToLower(ops.Content[j].Value)
			if !oasMethods[method] {
				continue
			}
			out = append(out, routeEntity(strings.ToUpper(method), p, ConfidenceCertain,
				map[string]string{"contract": rel}, Source{"oas", rel, ops.Content[j].Line}))
		}
	}
	return out, nil
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `go test ./internal/devcontext/ -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add internal/devcontext/
git commit -m "feat(devcontext): OpenAPI, proto and WSDL contract detection"
```

---

### Task 4: Go route detector (AST)

**Files:**
- Create: `internal/devcontext/goroutes.go`
- Test: `internal/devcontext/goroutes_test.go`

**Interfaces:**
- Consumes: `routeEntity` (Task 3).
- Produces: `detectRoutes(rel string, fset *token.FileSet, file *ast.File) []Entity`; route attrs `handler`, `handlerFile`, `handlerLine`, optional `partialPrefix="true"`; `stringLit(e ast.Expr) (string, bool)`.

- [ ] **Step 1: Write the failing test**

```go
package devcontext

import (
	"go/parser"
	"go/token"
	"testing"
)

func routesOf(t *testing.T, src string) map[string]Entity {
	t.Helper()
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "api/routes.go", src, parser.SkipObjectResolution)
	if err != nil {
		t.Fatal(err)
	}
	return byID(detectRoutes("api/routes.go", fset, file))
}

func TestDetectRoutesStdlibAndGorilla(t *testing.T) {
	got := routesOf(t, `package api
func register(mux *http.ServeMux, r *mux.Router) {
	mux.HandleFunc("POST /payments", h.createPayment)
	mux.Handle("/health", healthHandler)
	mux.HandleFunc("GET example.com/skip", skip)
	r.HandleFunc("/orders/{id:[0-9]+}", getOrder).Methods("GET", "DELETE")
	api := r.PathPrefix("/v2").Subrouter()
	api.HandleFunc("/refunds", listRefunds).Methods("GET")
}`)
	post := got["route:POST /payments"]
	if post.Attrs["handler"] != "h.createPayment" || post.Attrs["handlerLine"] != "3" || post.Confidence != ConfidenceInferred {
		t.Fatalf("stdlib route: %+v", post)
	}
	for _, id := range []string{"route:ANY /health", "route:GET /orders/{id}", "route:DELETE /orders/{id}", "route:GET /v2/refunds"} {
		if _, ok := got[id]; !ok {
			t.Errorf("missing %s in %v", id, keys(got))
		}
	}
	if _, ok := got["route:ANY /orders/{id}"]; ok {
		t.Error("a HandleFunc wrapped in .Methods must not also be emitted as ANY")
	}
	if len(got) != 5 {
		t.Errorf("host patterns must be skipped; got %v", keys(got))
	}
}

func TestDetectRoutesGinEchoChiWithPrefixes(t *testing.T) {
	got := routesOf(t, `package api
func gin(r *gin.Engine) {
	v1 := r.Group("/api/v1")
	v1.GET("/users/:id", getUser)
	admin := v1.Group(prefix)
	admin.DELETE("/users/:id", deleteUser)
}
func chi(r chi.Router) {
	r.Route("/accounts", func(r chi.Router) {
		r.Get("/", listAccounts)
		r.Post("/{id}/close", closeAccount)
	})
	r.Method("PATCH", "/limits", patchLimits)
}
func fresh(r chi.Router) {
	v1.GET("/not-prefixed", x)
}`)
	for _, id := range []string{"route:GET /api/v1/users/{id}", "route:GET /accounts", "route:POST /accounts/{id}/close", "route:PATCH /limits", "route:GET /not-prefixed"} {
		if _, ok := got[id]; !ok {
			t.Errorf("missing %s in %v", id, keys(got))
		}
	}
	del := got["route:DELETE /users/{id}"]
	if del.Attrs["partialPrefix"] != "true" {
		t.Fatalf("non-literal group prefix must set partialPrefix: %+v", del)
	}
}

func keys(m map[string]Entity) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/devcontext/ -run TestDetectRoutes -v`
Expected: FAIL — `undefined: detectRoutes`.

- [ ] **Step 3: Write `goroutes.go`**

```go
package devcontext

import (
	"go/ast"
	"go/token"
	"go/types"
	"strconv"
	"strings"
)

// unknownPrefix marks a router variable whose prefix is not a literal.
const unknownPrefix = "\x00"

var (
	upperMethods = map[string]bool{"GET": true, "POST": true, "PUT": true, "PATCH": true, "DELETE": true, "HEAD": true, "OPTIONS": true}
	chiMethods   = map[string]string{"Get": "GET", "Post": "POST", "Put": "PUT", "Patch": "PATCH", "Delete": "DELETE", "Head": "HEAD", "Options": "OPTIONS"}
)

// detectRoutes recognises net/http 1.22, gin, echo, chi and gorilla
// registrations by call shape only (no type checking). Prefixes are tracked
// per function and only when they are string literals.
func detectRoutes(rel string, fset *token.FileSet, file *ast.File) []Entity {
	var out []Entity
	for _, decl := range file.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Body == nil {
			continue
		}
		w := &routeWalker{rel: rel, fset: fset, prefixes: map[string]string{}, consumed: map[ast.Node]bool{}}
		w.walk(fn.Body)
		out = append(out, w.out...)
	}
	return out
}

type routeWalker struct {
	rel      string
	fset     *token.FileSet
	prefixes map[string]string
	consumed map[ast.Node]bool
	out      []Entity
}

func (w *routeWalker) walk(root ast.Node) {
	ast.Inspect(root, func(n ast.Node) bool {
		switch node := n.(type) {
		case *ast.AssignStmt:
			w.trackGroup(node)
		case *ast.CallExpr:
			return w.call(node)
		}
		return true
	})
}

func (w *routeWalker) trackGroup(assign *ast.AssignStmt) {
	if len(assign.Lhs) != 1 || len(assign.Rhs) != 1 {
		return
	}
	lhs, ok := assign.Lhs[0].(*ast.Ident)
	call, ok2 := assign.Rhs[0].(*ast.CallExpr)
	if !ok || !ok2 {
		return
	}
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		return
	}
	if sel.Sel.Name == "Subrouter" { // gorilla: r.PathPrefix("/v2").Subrouter()
		inner, ok := sel.X.(*ast.CallExpr)
		if !ok {
			return
		}
		innerSel, ok := inner.Fun.(*ast.SelectorExpr)
		if !ok {
			return
		}
		call, sel = inner, innerSel
	}
	if (sel.Sel.Name != "Group" && sel.Sel.Name != "PathPrefix") || len(call.Args) == 0 {
		return
	}
	base := w.prefixOf(sel.X)
	lit, ok := stringLit(call.Args[0])
	if !ok || base == unknownPrefix {
		w.prefixes[lhs.Name] = unknownPrefix
		return
	}
	w.prefixes[lhs.Name] = base + lit
}

func (w *routeWalker) prefixOf(x ast.Expr) string {
	if id, ok := x.(*ast.Ident); ok {
		return w.prefixes[id.Name]
	}
	return ""
}

func (w *routeWalker) call(call *ast.CallExpr) bool {
	if w.consumed[call] {
		return true
	}
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		return true
	}
	name, args := sel.Sel.Name, call.Args
	switch {
	case name == "Methods":
		inner, ok := sel.X.(*ast.CallExpr)
		if !ok {
			return true
		}
		innerSel, ok := inner.Fun.(*ast.SelectorExpr)
		if !ok || (innerSel.Sel.Name != "HandleFunc" && innerSel.Sel.Name != "Handle") || len(inner.Args) < 2 {
			return true
		}
		p, ok := stringLit(inner.Args[0])
		if !ok {
			return true
		}
		w.consumed[inner] = true
		for _, arg := range args {
			if method, ok := stringLit(arg); ok {
				w.emit(method, w.prefixOf(innerSel.X), p, inner.Args[1], inner)
			}
		}
	case name == "Route" && len(args) == 2:
		fn, isFn := args[1].(*ast.FuncLit)
		if !isFn {
			return true
		}
		prefix := w.prefixOf(sel.X)
		if p, ok := stringLit(args[0]); ok && prefix != unknownPrefix {
			prefix += p
		} else {
			prefix = unknownPrefix
		}
		saved := w.prefixes
		w.prefixes = make(map[string]string, len(saved)+1)
		for k, v := range saved {
			w.prefixes[k] = v
		}
		if params := fn.Type.Params.List; len(params) == 1 && len(params[0].Names) == 1 {
			w.prefixes[params[0].Names[0].Name] = prefix
		}
		w.walk(fn.Body)
		w.prefixes = saved
		return false
	case (name == "HandleFunc" || name == "Handle") && len(args) >= 2:
		pattern, ok := stringLit(args[0])
		if !ok {
			return true
		}
		method, p := "ANY", pattern
		if m, rest, found := strings.Cut(pattern, " "); found {
			method, p = m, strings.TrimSpace(rest)
		}
		w.emit(method, w.prefixOf(sel.X), p, args[1], call)
	case upperMethods[name] && len(args) >= 2:
		if p, ok := stringLit(args[0]); ok {
			w.emit(name, w.prefixOf(sel.X), p, args[1], call)
		}
	case chiMethods[name] != "" && len(args) >= 2:
		if p, ok := stringLit(args[0]); ok {
			w.emit(chiMethods[name], w.prefixOf(sel.X), p, args[1], call)
		}
	case (name == "Method" || name == "MethodFunc") && len(args) >= 3:
		method, ok1 := stringLit(args[0])
		p, ok2 := stringLit(args[1])
		if ok1 && ok2 {
			w.emit(method, w.prefixOf(sel.X), p, args[2], call)
		}
	}
	return true
}

func (w *routeWalker) emit(method, prefix, p string, handler ast.Expr, at ast.Node) {
	if !strings.HasPrefix(p, "/") {
		return
	}
	attrs := map[string]string{
		"handler":     types.ExprString(handler),
		"handlerFile": w.rel,
		"handlerLine": strconv.Itoa(w.fset.Position(handler.Pos()).Line),
	}
	full := p
	if prefix == unknownPrefix {
		attrs["partialPrefix"] = "true"
	} else if prefix != "" {
		full = strings.TrimSuffix(prefix, "/") + p
	}
	w.out = append(w.out, routeEntity(strings.ToUpper(method), full, ConfidenceInferred, attrs,
		Source{"goroutes", w.rel, w.fset.Position(at.Pos()).Line}))
}

func stringLit(e ast.Expr) (string, bool) {
	lit, ok := e.(*ast.BasicLit)
	if !ok || lit.Kind != token.STRING {
		return "", false
	}
	s, err := strconv.Unquote(lit.Value)
	return s, err == nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/devcontext/ -run TestDetectRoutes -v`
Expected: PASS (2 tests). If `route:GET /accounts` is missing, check that `normalizePath` trims the trailing `/` produced by `/accounts` + `/`.

- [ ] **Step 5: Commit**

```bash
git add internal/devcontext/
git commit -m "feat(devcontext): detect net/http, gin, echo, chi and gorilla routes from Go AST"
```

---

### Task 5: Go literals detector and Go file entry point

**Files:**
- Create: `internal/devcontext/goliterals.go`, `internal/devcontext/gofile.go`
- Test: `internal/devcontext/goliterals_test.go`

**Interfaces:**
- Consumes: `detectRoutes`, `stringLit`, `entity` (Tasks 1, 4).
- Produces: `detectLiterals(rel string, fset *token.FileSet, file *ast.File) []Entity` (kinds `envvar`, `table`, `topic` with attr `broker`), `detectMain(rel string, fset *token.FileSet, file *ast.File) []Entity` (kind `service`, ID `service:go:<dir>`), `detectGoFile(rel string, data []byte) ([]Entity, error)`.

- [ ] **Step 1: Write the failing test**

```go
package devcontext

import (
	"go/parser"
	"go/token"
	"testing"
)

func literalsOf(t *testing.T, src string) map[string]Entity {
	t.Helper()
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "internal/store.go", src, parser.SkipObjectResolution)
	if err != nil {
		t.Fatal(err)
	}
	return byID(detectLiterals("internal/store.go", fset, file))
}

func TestDetectEnvAndSQL(t *testing.T) {
	got := literalsOf(t, `package store
import "os"
const listQuery = "SELECT id FROM payments p JOIN accounts a ON a.id = p.account_id"
type Config struct {
	DSN  string ` + "`env:\"DATABASE_URL,required\"`" + `
	Skip string ` + "`env:\"-\"`" + `
}
func run(ctx context.Context, db *sql.DB, name string) {
	_ = os.Getenv("PAYMENT_API_URL")
	_, _ = os.LookupEnv("PORT")
	db.QueryContext(ctx, listQuery)
	db.Exec("INSERT INTO ledger_entries (id) VALUES ($1) ON CONFLICT (id) DO UPDATE SET id = excluded.id")
	db.Query("select * from unnest($1)")
	db.Query("SELECT * FROM " + name)
	db.Exec(fmt.Sprintf("DELETE FROM %s", name))
}`)
	for _, id := range []string{"envvar:PAYMENT_API_URL", "envvar:PORT", "envvar:DATABASE_URL", "table:payments", "table:accounts", "table:ledger_entries"} {
		if e, ok := got[id]; !ok || e.Confidence != ConfidenceInferred {
			t.Errorf("missing inferred %s in %v", id, keys(got))
		}
	}
	for _, id := range []string{"table:SET", "table:unnest", "envvar:-"} {
		if _, ok := got[id]; ok {
			t.Errorf("%s must not be detected", id)
		}
	}
	if len(got) != 6 {
		t.Errorf("dynamic SQL must be ignored; got %v", keys(got))
	}
}

func TestDetectTopicsByImportedLibrary(t *testing.T) {
	got := literalsOf(t, `package events
import (
	"github.com/IBM/sarama"
	"github.com/twmb/franz-go/pkg/kgo"
	kafkago "github.com/segmentio/kafka-go"
	amqp "github.com/rabbitmq/amqp091-go"
	"github.com/nats-io/nats.go"
)
func publish(ch *amqp.Channel, nc *nats.Conn) {
	_ = &sarama.ProducerMessage{Topic: "payment.created"}
	_ = &kgo.Record{Topic: "payment.settled"}
	_ = kgo.ConsumeTopics("ledger.updated", "ledger.closed")
	_ = kafkago.Writer{Topic: "audit.events"}
	_ = ch.PublishWithContext(ctx, "payments", "payment.refunded", false, false, msg)
	_ = nc.Publish("notifications.email", data)
}`)
	want := map[string]string{
		"topic:payment.created": "kafka", "topic:payment.settled": "kafka", "topic:ledger.updated": "kafka",
		"topic:ledger.closed": "kafka", "topic:audit.events": "kafka", "topic:payment.refunded": "amqp",
		"topic:notifications.email": "nats",
	}
	for id, broker := range want {
		if got[id].Attrs["broker"] != broker {
			t.Errorf("%s broker = %q, want %q (all: %v)", id, got[id].Attrs["broker"], broker, keys(got))
		}
	}
}

func TestTopicsNeedTheLibraryImport(t *testing.T) {
	got := literalsOf(t, `package x
func f(bus *Bus) { bus.Publish("not.a.topic", nil); _ = Msg{Topic: "nope"} }`)
	if len(got) != 0 {
		t.Fatalf("no broker import → no topics, got %v", keys(got))
	}
}

func TestDetectGoFileMainAndBrokenSource(t *testing.T) {
	got, err := detectGoFile("cmd/api/main.go", []byte("package main\nfunc main() {}\n"))
	if err != nil || byID(got)["service:go:cmd/api"].Label != "api" {
		t.Fatalf("main package must become a service: %v %+v", err, got)
	}
	got, err = detectGoFile("api/routes.go", []byte("package api\nfunc r(m *http.ServeMux) {\n\tm.HandleFunc(\"GET /ok\", ok)\n\tm.HandleFunc(\"GET /half\", \n"))
	if err != nil {
		t.Fatalf("syntax errors must not produce a warning: %v", err)
	}
	if _, ok := byID(got)["route:GET /ok"]; !ok {
		t.Fatalf("the parsed part of a broken file must still be used: %+v", got)
	}
	if _, err := detectGoFile("x.go", []byte("not go at all {{{")); err != nil {
		t.Fatalf("garbage must be ignored silently, got %v", err)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/devcontext/ -run 'TestDetectEnvAndSQL|TestDetectTopics|TestTopicsNeed|TestDetectGoFile' -v`
Expected: FAIL — `undefined: detectLiterals`.

- [ ] **Step 3: Write `goliterals.go`**

```go
package devcontext

import (
	"go/ast"
	"go/token"
	"path"
	"reflect"
	"regexp"
	"strconv"
	"strings"
)

var (
	sqlMethods = map[string]bool{
		"Query": true, "QueryRow": true, "QueryContext": true, "QueryRowContext": true,
		"Exec": true, "ExecContext": true, "Get": true, "GetContext": true, "Select": true, "SelectContext": true,
		"NamedExec": true, "NamedExecContext": true, "NamedQuery": true,
		"Queryx": true, "QueryRowx": true, "QueryxContext": true, "QueryRowxContext": true,
	}
	sqlStart     = regexp.MustCompile(`(?is)^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b`)
	sqlTable     = regexp.MustCompile(`(?i)\b(FROM|JOIN|INTO|UPDATE)\s+("?[A-Za-z_]\w*"?(?:\."?[A-Za-z_]\w*"?)?)(\s*\()?`)
	sqlNotTables = map[string]bool{"SET": true, "SELECT": true, "LATERAL": true, "ONLY": true}

	topicLibs = map[string]string{
		"github.com/IBM/sarama": "kafka", "github.com/Shopify/sarama": "kafka",
		"github.com/twmb/franz-go/pkg/kgo": "kafka", "github.com/segmentio/kafka-go": "kafka",
		"github.com/rabbitmq/amqp091-go": "amqp", "github.com/streadway/amqp": "amqp",
		"github.com/nats-io/nats.go": "nats",
	}
	knownImportNames = map[string]string{
		"github.com/segmentio/kafka-go": "kafka", "github.com/rabbitmq/amqp091-go": "amqp", "github.com/nats-io/nats.go": "nats",
	}
	kafkaTopicTypes = map[string]bool{"ProducerMessage": true, "Record": true, "Writer": true, "ReaderConfig": true, "Message": true}
	natsCalls       = map[string]bool{"Publish": true, "Subscribe": true, "QueueSubscribe": true, "Request": true, "SubscribeSync": true, "ChanSubscribe": true}
)

type literalWalker struct {
	rel     string
	fset    *token.FileSet
	imports map[string]string // local package name -> broker
	hasOS   bool
	consts  map[string]string
	out     []Entity
}

// detectLiterals finds env var names, SQL tables and broker topics written
// as string literals. Dynamic strings are ignored on purpose.
func detectLiterals(rel string, fset *token.FileSet, file *ast.File) []Entity {
	w := &literalWalker{rel: rel, fset: fset, imports: map[string]string{}, consts: map[string]string{}}
	for _, imp := range file.Imports {
		p, _ := strconv.Unquote(imp.Path.Value)
		name := knownImportNames[p]
		if name == "" {
			name = path.Base(p)
		}
		if imp.Name != nil {
			name = imp.Name.Name
		}
		if p == "os" && name == "os" {
			w.hasOS = true
		}
		if broker, ok := topicLibs[p]; ok {
			w.imports[name] = broker
		}
	}
	ast.Inspect(file, func(n ast.Node) bool {
		if spec, ok := n.(*ast.ValueSpec); ok {
			for i, name := range spec.Names {
				if i < len(spec.Values) {
					if s, ok := stringLit(spec.Values[i]); ok {
						w.consts[name.Name] = s
					}
				}
			}
		}
		return true
	})
	ast.Inspect(file, func(n ast.Node) bool {
		switch node := n.(type) {
		case *ast.Field:
			w.structTag(node)
		case *ast.CallExpr:
			w.call(node)
		case *ast.CompositeLit:
			w.composite(node)
		}
		return true
	})
	return w.out
}

func (w *literalWalker) add(kind, name string, attrs map[string]string, at token.Pos) {
	w.out = append(w.out, entity(kind, name, name, ConfidenceInferred, attrs,
		Source{"goliterals", w.rel, w.fset.Position(at).Line}))
}

func (w *literalWalker) structTag(field *ast.Field) {
	if field.Tag == nil {
		return
	}
	tag, err := strconv.Unquote(field.Tag.Value)
	if err != nil {
		return
	}
	for _, key := range []string{"env", "envconfig"} {
		name, _, _ := strings.Cut(reflect.StructTag(tag).Get(key), ",")
		if name != "" && name != "-" {
			w.add("envvar", name, nil, field.Pos())
		}
	}
}

func (w *literalWalker) call(call *ast.CallExpr) {
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		return
	}
	name, args := sel.Sel.Name, call.Args
	pkg, _ := sel.X.(*ast.Ident)
	switch {
	case w.hasOS && pkg != nil && pkg.Name == "os" && (name == "Getenv" || name == "LookupEnv") && len(args) == 1:
		if s, ok := stringLit(args[0]); ok && s != "" {
			w.add("envvar", s, nil, call.Pos())
		}
	case sqlMethods[name]:
		w.sql(args)
	}
	if pkg != nil && w.imports[pkg.Name] == "kafka" && name == "ConsumeTopics" {
		for _, arg := range args {
			if s, ok := stringLit(arg); ok {
				w.add("topic", s, map[string]string{"broker": "kafka"}, arg.Pos())
			}
		}
	}
	if w.importsBroker("amqp") {
		offset := -1
		switch {
		case name == "Publish" && len(args) >= 5: // amqp arity; nats Publish has 2 args
			offset = 0
		case name == "PublishWithContext" && len(args) >= 6:
			offset = 1
		case name == "QueueDeclare" || name == "Consume":
			if len(args) > 0 {
				if s, ok := stringLit(args[0]); ok && s != "" {
					w.add("topic", s, map[string]string{"broker": "amqp"}, call.Pos())
				}
			}
		}
		if offset >= 0 && len(args) > offset+1 {
			exchange, _ := stringLit(args[offset])
			key, _ := stringLit(args[offset+1])
			if topic := firstNonEmpty(key, exchange); topic != "" {
				w.add("topic", topic, map[string]string{"broker": "amqp"}, call.Pos())
			}
		}
	}
	if w.importsBroker("nats") && natsCalls[name] && len(args) > 0 {
		if s, ok := stringLit(args[0]); ok && s != "" {
			w.add("topic", s, map[string]string{"broker": "nats"}, call.Pos())
		}
	}
}

func (w *literalWalker) importsBroker(broker string) bool {
	for _, b := range w.imports {
		if b == broker {
			return true
		}
	}
	return false
}

func (w *literalWalker) sql(args []ast.Expr) {
	for i, arg := range args {
		if i > 1 {
			return
		}
		query, ok := stringLit(arg)
		if !ok {
			if id, isIdent := arg.(*ast.Ident); isIdent {
				query, ok = w.consts[id.Name]
			}
		}
		if !ok || !sqlStart.MatchString(query) {
			continue
		}
		for _, m := range sqlTable.FindAllStringSubmatch(query, -1) {
			table := strings.ReplaceAll(m[2], `"`, "")
			isCall := m[3] != "" && !strings.EqualFold(m[1], "INTO") // FROM unnest(…) is a function; INTO t (cols) is a table
			if isCall || sqlNotTables[strings.ToUpper(table)] {
				continue
			}
			w.add("table", table, nil, arg.Pos())
		}
		return
	}
}

func (w *literalWalker) composite(lit *ast.CompositeLit) {
	sel, ok := lit.Type.(*ast.SelectorExpr)
	if !ok {
		return
	}
	pkg, ok := sel.X.(*ast.Ident)
	if !ok || w.imports[pkg.Name] != "kafka" || !kafkaTopicTypes[sel.Sel.Name] {
		return
	}
	for _, elt := range lit.Elts {
		kv, ok := elt.(*ast.KeyValueExpr)
		if !ok {
			continue
		}
		if key, ok := kv.Key.(*ast.Ident); ok && key.Name == "Topic" {
			if s, ok := stringLit(kv.Value); ok && s != "" {
				w.add("topic", s, map[string]string{"broker": "kafka"}, kv.Pos())
			}
		}
	}
}
```

- [ ] **Step 4: Write `gofile.go`**

```go
package devcontext

import (
	"go/ast"
	"go/parser"
	"go/token"
	"path"
)

// detectGoFile parses without type checking. Syntax errors are gopls's job:
// the partial AST is used and no warning is raised, so editing never spams.
func detectGoFile(rel string, data []byte) ([]Entity, error) {
	fset := token.NewFileSet()
	file, _ := parser.ParseFile(fset, rel, data, parser.SkipObjectResolution)
	if file == nil || file.Name == nil {
		return nil, nil
	}
	var out []Entity
	out = append(out, detectMain(rel, fset, file)...)
	out = append(out, detectRoutes(rel, fset, file)...)
	out = append(out, detectLiterals(rel, fset, file)...)
	return out, nil
}

func detectMain(rel string, fset *token.FileSet, file *ast.File) []Entity {
	if file.Name.Name != "main" {
		return nil
	}
	for _, decl := range file.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Recv != nil || fn.Name.Name != "main" {
			continue
		}
		dir := path.Dir(rel)
		name := path.Base(dir)
		if dir == "." {
			name = "main"
		}
		return []Entity{entity("service", "go:"+dir, name, ConfidenceInferred,
			map[string]string{"origin": "go", "dir": dir}, Source{"gomain", rel, fset.Position(fn.Pos()).Line})}
	}
	return nil
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `go test ./internal/devcontext/ -v`
Expected: PASS (all tests so far).

- [ ] **Step 6: Commit**

```bash
git add internal/devcontext/
git commit -m "feat(devcontext): detect env vars, SQL tables, broker topics and main packages in Go code"
```

---

### Task 6: Scan manager — dispatch, walk, cache, incremental rescans, file reads

**Files:**
- Create: `internal/devcontext/detect.go`, `internal/devcontext/manager.go`
- Create: fixture `internal/devcontext/testdata/project/` (files listed in Step 1)
- Test: `internal/devcontext/manager_test.go`

**Interfaces:**
- Consumes: every detector from Tasks 2–5, `merge`.
- Produces:
  - `detectFile(rel string, data []byte, env map[string]string) ([]Entity, []string)`, `interesting(rel string) bool`, `readable(rel string) bool`
  - `type RootResolver func(sessionID string) (string, error)`, `type ChangeFunc func(sessionID string, version int64)`
  - `NewManager(resolveRoot RootResolver, onChange ChangeFunc) *Manager`
  - `(*Manager).Get(sessionID) (Snapshot, error)`, `Rescan(sessionID) (Snapshot, error)`, `Invalidate(sessionID, rel string)`, `CheckStale(sessionID) (bool, error)`, `Drop(sessionID string)`, `ReadFile(sessionID, rel string) (string, error)`

- [ ] **Step 1: Create the fixture project**

`internal/devcontext/testdata/project/go.mod`:
```
module example.com/payments

go 1.26
```

`internal/devcontext/testdata/project/cmd/api/main.go`:
```go
package main

import "net/http"

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /payments", createPayment)
	mux.HandleFunc("GET /payments/{id}", getPayment)
	_ = http.ListenAndServe(":8080", mux)
}
```

`internal/devcontext/testdata/project/internal/store/store.go`:
```go
package store

import "os"

func open(db DB) {
	_ = os.Getenv("DATABASE_URL")
	db.Query("SELECT id, amount FROM payments WHERE id = $1")
}
```

`internal/devcontext/testdata/project/.env`:
```
DATABASE_URL=postgres://app:s3cret@localhost:5432/payments
API_TOKEN=abc
POSTGRES_DB=payments
```

`internal/devcontext/testdata/project/docker-compose.yml`:
```yaml
services:
  db:
    image: postgres:16
    ports: ["5432:5432"]
    environment:
      POSTGRES_USER: app
      POSTGRES_DB: ${POSTGRES_DB}
```

`internal/devcontext/testdata/project/api/openapi.yaml`:
```yaml
openapi: 3.0.3
info: {title: Payments, version: "1"}
paths:
  /payments/{id}:
    get: {}
```

`internal/devcontext/testdata/project/proto/payments.proto`:
```
syntax = "proto3";
package payments;
```

`internal/devcontext/testdata/project/vendor/lib/ignored.go`:
```go
package lib

func r(m Mux) { m.HandleFunc("GET /vendored", h) }
```

- [ ] **Step 2: Write the failing test**

```go
package devcontext

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// copyFixture copies testdata/project into a temp dir so tests can edit files.
func copyFixture(t *testing.T) string {
	t.Helper()
	dst := t.TempDir()
	src := filepath.Join("testdata", "project")
	err := filepath.WalkDir(src, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, p)
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		data, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		return os.WriteFile(target, data, 0o644)
	})
	if err != nil {
		t.Fatal(err)
	}
	return dst
}

func newTestManager(root string) (*Manager, *[]int64) {
	var versions []int64
	m := NewManager(func(id string) (string, error) { return root, nil }, func(_ string, v int64) { versions = append(versions, v) })
	return m, &versions
}

func TestManagerScansFixture(t *testing.T) {
	root := copyFixture(t)
	m, versions := newTestManager(root)
	snap, err := m.Get("s1")
	if err != nil {
		t.Fatal(err)
	}
	ids := byID(snap.Entities)
	for _, id := range []string{
		"module:example.com/payments", "service:go:cmd/api", "service:compose:db",
		"route:POST /payments", "route:GET /payments/{id}", "table:payments",
		"envvar:DATABASE_URL", "envvar:API_TOKEN", "contract:api/openapi.yaml", "contract:proto/payments.proto",
		"datasource:postgres@localhost:5432/payments",
	} {
		if _, ok := ids[id]; !ok {
			t.Errorf("missing %s", id)
		}
	}
	if len(ids["route:GET /payments/{id}"].Sources) != 2 {
		t.Errorf("code and OAS route must merge: %+v", ids["route:GET /payments/{id}"])
	}
	if _, ok := ids["route:GET /vendored"]; ok {
		t.Error("vendor must be skipped")
	}
	if len(ids["envvar:DATABASE_URL"].Sources) != 2 || strings.Contains(ids["envvar:DATABASE_URL"].Attrs["value"], "s3cret") {
		t.Errorf("env usage + definition merge, value redacted: %+v", ids["envvar:DATABASE_URL"])
	}
	if snap.Version != 1 || len(*versions) != 1 {
		t.Errorf("first scan must notify version 1, got %d %v", snap.Version, *versions)
	}
}

func TestManagerInvalidateAndBrokenSave(t *testing.T) {
	root := copyFixture(t)
	m, _ := newTestManager(root)
	if _, err := m.Get("s1"); err != nil {
		t.Fatal(err)
	}
	main := filepath.Join(root, "cmd", "api", "main.go")
	if err := os.WriteFile(main, []byte("package main\nfunc main() {\n\tmux.HandleFunc(\"GET /health\", h)\n\tmux.HandleFunc(\"GET /half\", \n"), 0o644); err != nil {
		t.Fatal(err)
	}
	m.Invalidate("s1", "cmd/api/main.go")
	snap, _ := m.Get("s1")
	ids := byID(snap.Entities)
	if _, ok := ids["route:GET /health"]; !ok {
		t.Error("invalidate must rescan the saved file")
	}
	if _, ok := ids["route:POST /payments"]; ok {
		t.Error("routes removed from the file must disappear")
	}
	if _, ok := ids["table:payments"]; !ok {
		t.Error("other files must be untouched")
	}
	if len(snap.Warnings) != 0 {
		t.Errorf("a half-typed Go file must not warn: %v", snap.Warnings)
	}
}

func TestManagerDotenvChangeRefreshesCompose(t *testing.T) {
	root := copyFixture(t)
	m, _ := newTestManager(root)
	_, _ = m.Get("s1")
	if err := os.WriteFile(filepath.Join(root, ".env"), []byte("POSTGRES_DB=ledger\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	m.Invalidate("s1", ".env")
	snap, _ := m.Get("s1")
	if _, ok := byID(snap.Entities)["datasource:postgres@localhost:5432/ledger"]; !ok {
		t.Fatalf("compose must be re-interpolated after .env changes: %v", keys(byID(snap.Entities)))
	}
}

func TestManagerCheckStaleFindsNewAndDeletedFiles(t *testing.T) {
	root := copyFixture(t)
	m, _ := newTestManager(root)
	_, _ = m.Get("s1")
	if changed, _ := m.CheckStale("s1"); changed {
		t.Fatal("nothing changed yet")
	}
	_ = os.Remove(filepath.Join(root, "proto", "payments.proto"))
	_ = os.WriteFile(filepath.Join(root, "ledger.wsdl"), []byte("<definitions/>"), 0o644)
	future := time.Now().Add(2 * time.Second)
	_ = os.Chtimes(filepath.Join(root, "ledger.wsdl"), future, future)
	changed, err := m.CheckStale("s1")
	if err != nil || !changed {
		t.Fatalf("expected change, got %v %v", changed, err)
	}
	ids := byID(mustGet(t, m).Entities)
	if _, ok := ids["contract:proto/payments.proto"]; ok {
		t.Error("deleted file must disappear")
	}
	if _, ok := ids["contract:ledger.wsdl"]; !ok {
		t.Error("new file must appear")
	}
}

func mustGet(t *testing.T, m *Manager) Snapshot {
	t.Helper()
	s, err := m.Get("s1")
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestManagerReadFileGuards(t *testing.T) {
	root := copyFixture(t)
	m, _ := newTestManager(root)
	if text, err := m.ReadFile("s1", "api/openapi.yaml"); err != nil || !strings.Contains(text, "openapi") {
		t.Fatalf("contract read failed: %v", err)
	}
	for _, rel := range []string{"../outside.yaml", ".env", "cmd/api/main.go", filepath.Join(root, "api", "openapi.yaml")} {
		if _, err := m.ReadFile("s1", rel); err == nil {
			t.Errorf("ReadFile(%q) must be refused", rel)
		}
	}
}

func TestManagerDropAndUnknownInvalidate(t *testing.T) {
	root := copyFixture(t)
	m, versions := newTestManager(root)
	m.Invalidate("never-scanned", "go.mod") // must be a no-op
	if len(*versions) != 0 {
		t.Fatal("invalidate before the first scan must not notify")
	}
	_, _ = m.Get("s1")
	m.Drop("s1")
	snap, _ := m.Get("s1")
	if snap.Version != 1 {
		t.Fatalf("drop must forget the session so the next Get rescans from scratch, got version %d", snap.Version)
	}
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `go test ./internal/devcontext/ -run TestManager -v`
Expected: FAIL — `undefined: NewManager`.

- [ ] **Step 4: Write `detect.go`**

```go
package devcontext

import (
	"path"
	"strings"
)

var skippedDirs = map[string]bool{
	".git": true, "node_modules": true, "vendor": true, "target": true, "build": true, "dist": true,
	".gradle": true, ".idea": true, ".venv": true, "__pycache__": true, ".next": true, "bin": true,
	"obj": true, "testdata": true,
}

// interesting reports whether any detector reads rel, and rel is not inside a
// skipped or hidden directory.
func interesting(rel string) bool {
	dir := path.Dir(rel)
	if dir != "." {
		for _, segment := range strings.Split(dir, "/") {
			if skippedDirs[segment] || strings.HasPrefix(segment, ".") {
				return false
			}
		}
	}
	base := path.Base(rel)
	switch {
	case base == "go.mod", isDotenv(base), isCompose(base):
		return true
	case strings.HasSuffix(base, "_test.go"):
		return false
	}
	switch path.Ext(base) {
	case ".go", ".proto", ".wsdl", ".yaml", ".yml", ".json":
		return true
	}
	return false
}

// readable limits ReadContextFile to contract documents: never .env or code.
func readable(rel string) bool {
	switch path.Ext(rel) {
	case ".proto", ".wsdl", ".yaml", ".yml", ".json":
		return interesting(rel)
	}
	return false
}

func detectFile(rel string, data []byte, env map[string]string) ([]Entity, []string) {
	var out []Entity
	var warnings []string
	add := func(entities []Entity, err error) {
		out = append(out, entities...)
		if err != nil {
			warnings = append(warnings, rel+": "+err.Error())
		}
	}
	base := path.Base(rel)
	switch {
	case base == "go.mod":
		add(detectGoMod(rel, data))
	case strings.HasSuffix(base, ".go"):
		add(detectGoFile(rel, data))
	case isDotenv(base):
		add(detectDotenv(rel, data))
	case isCompose(base):
		add(detectCompose(rel, data, env))
	case strings.HasSuffix(base, ".proto"), strings.HasSuffix(base, ".wsdl"):
		add(detectContractFile(rel, data))
	default:
		add(detectOpenAPI(rel, data))
	}
	return out, warnings
}
```

- [ ] **Step 5: Write `manager.go`**

```go
package devcontext

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	maxVisitedFiles = 120_000
	maxFileBytes    = 2 << 20
	maxReadBytes    = 5 << 20
	scanTimeout     = 30 * time.Second
)

var errFileLimit = errors.New("file limit reached")

type RootResolver func(sessionID string) (string, error)
type ChangeFunc func(sessionID string, version int64)

type fileResult struct {
	Entities []Entity
	Warnings []string
	ModTime  time.Time
}

type sessionState struct {
	scan     sync.Mutex // one scan per session at a time
	mu       sync.Mutex // guards the fields below
	root     string
	files    map[string]fileResult
	warnings []string
	version  int64
	scanned  time.Time
}

// Manager keeps one in-memory context per gO session.
type Manager struct {
	resolveRoot RootResolver
	onChange    ChangeFunc
	timeout     time.Duration
	mu          sync.Mutex
	sessions    map[string]*sessionState
}

func NewManager(resolveRoot RootResolver, onChange ChangeFunc) *Manager {
	return &Manager{resolveRoot: resolveRoot, onChange: onChange, timeout: scanTimeout, sessions: map[string]*sessionState{}}
}

func (m *Manager) state(sessionID string) *sessionState {
	m.mu.Lock()
	defer m.mu.Unlock()
	st, ok := m.sessions[sessionID]
	if !ok {
		st = &sessionState{}
		m.sessions[sessionID] = st
	}
	return st
}

func (m *Manager) existing(sessionID string) *sessionState {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.sessions[sessionID]
}

// Get returns the cached snapshot, scanning the session on first use.
func (m *Manager) Get(sessionID string) (Snapshot, error) {
	st := m.state(sessionID)
	st.mu.Lock()
	ready := st.files != nil
	st.mu.Unlock()
	if !ready {
		return m.Rescan(sessionID)
	}
	return st.snapshot(sessionID), nil
}

func (m *Manager) Rescan(sessionID string) (Snapshot, error) {
	root, err := m.resolveRoot(sessionID)
	if err != nil {
		return Snapshot{}, err
	}
	st := m.state(sessionID)
	st.scan.Lock()
	defer st.scan.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), m.timeout)
	defer cancel()
	env := rootEnv(root)
	files := map[string]fileResult{}
	walkErr := walkInteresting(ctx, root, func(rel string, _ time.Time) {
		files[rel] = scanFile(root, rel, env)
	})
	st.mu.Lock()
	st.root, st.files, st.warnings = root, files, walkWarnings(walkErr)
	st.version++
	st.scanned = time.Now()
	version := st.version
	st.mu.Unlock()
	m.notify(sessionID, version)
	return st.snapshot(sessionID), nil
}

// Invalidate rescans one saved file. A root .env change also refreshes
// compose files, because they interpolate its values.
func (m *Manager) Invalidate(sessionID, rel string) {
	st := m.existing(sessionID)
	if st == nil {
		return
	}
	st.scan.Lock()
	defer st.scan.Unlock()
	st.mu.Lock()
	root, ready := st.root, st.files != nil
	st.mu.Unlock()
	if !ready {
		return
	}
	m.refresh(sessionID, st, root, withComposeIfEnv(st, []string{filepath.ToSlash(rel)}))
}

// CheckStale compares modification times with a fresh walk (cheap: no
// parsing) and rescans only what changed, including new and deleted files.
func (m *Manager) CheckStale(sessionID string) (bool, error) {
	st := m.existing(sessionID)
	if st == nil {
		return false, nil
	}
	st.scan.Lock()
	defer st.scan.Unlock()
	st.mu.Lock()
	root := st.root
	known := make(map[string]time.Time, len(st.files))
	for rel, f := range st.files {
		known[rel] = f.ModTime
	}
	st.mu.Unlock()
	if root == "" {
		return false, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), m.timeout)
	defer cancel()
	current := map[string]time.Time{}
	if err := walkInteresting(ctx, root, func(rel string, mod time.Time) { current[rel] = mod }); err != nil {
		return false, nil // partial walk: never delete entities based on it
	}
	var changed []string
	for rel, mod := range current {
		if old, ok := known[rel]; !ok || !old.Equal(mod) {
			changed = append(changed, rel)
		}
	}
	for rel := range known {
		if _, ok := current[rel]; !ok {
			changed = append(changed, rel)
		}
	}
	if len(changed) == 0 {
		return false, nil
	}
	m.refresh(sessionID, st, root, withComposeIfEnv(st, changed))
	return true, nil
}

func (m *Manager) Drop(sessionID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.sessions, sessionID)
}

// ReadFile returns a contract document (OAS, proto, WSDL) inside the root.
func (m *Manager) ReadFile(sessionID, rel string) (string, error) {
	root, err := m.resolveRoot(sessionID)
	if err != nil {
		return "", err
	}
	if filepath.IsAbs(rel) {
		return "", fmt.Errorf("path outside the project: %s", rel)
	}
	clean := path.Clean(filepath.ToSlash(rel))
	if clean == ".." || strings.HasPrefix(clean, "../") {
		return "", fmt.Errorf("path outside the project: %s", rel)
	}
	if !readable(clean) {
		return "", fmt.Errorf("%s is not a contract file", rel)
	}
	full := filepath.Join(root, filepath.FromSlash(clean))
	info, err := os.Stat(full)
	if err != nil {
		return "", err
	}
	if info.Size() > maxReadBytes {
		return "", fmt.Errorf("%s is larger than 5 MB", rel)
	}
	data, err := os.ReadFile(full)
	return string(data), err
}

func (m *Manager) refresh(sessionID string, st *sessionState, root string, rels []string) {
	env := rootEnv(root)
	updates := map[string]*fileResult{}
	for _, rel := range rels {
		if !interesting(rel) {
			continue
		}
		if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(rel))); err != nil {
			updates[rel] = nil
			continue
		}
		r := scanFile(root, rel, env)
		updates[rel] = &r
	}
	if len(updates) == 0 {
		return
	}
	st.mu.Lock()
	for rel, r := range updates {
		if r == nil {
			delete(st.files, rel)
		} else {
			st.files[rel] = *r
		}
	}
	st.version++
	version := st.version
	st.mu.Unlock()
	m.notify(sessionID, version)
}

func (m *Manager) notify(sessionID string, version int64) {
	if m.onChange != nil {
		m.onChange(sessionID, version)
	}
}

func withComposeIfEnv(st *sessionState, rels []string) []string {
	for _, rel := range rels {
		if path.Dir(rel) == "." && isDotenv(path.Base(rel)) {
			st.mu.Lock()
			for known := range st.files {
				if isCompose(path.Base(known)) {
					rels = append(rels, known)
				}
			}
			st.mu.Unlock()
			return rels
		}
	}
	return rels
}

func (st *sessionState) snapshot(sessionID string) Snapshot {
	st.mu.Lock()
	defer st.mu.Unlock()
	rels := make([]string, 0, len(st.files))
	for rel := range st.files {
		rels = append(rels, rel)
	}
	sort.Strings(rels) // deterministic "first writer wins" in merge
	groups := make([][]Entity, 0, len(rels))
	warnings := append([]string{}, st.warnings...)
	for _, rel := range rels {
		groups = append(groups, st.files[rel].Entities)
		warnings = append(warnings, st.files[rel].Warnings...)
	}
	return Snapshot{SessionID: sessionID, Root: st.root, Version: st.version, Entities: merge(groups...), Warnings: warnings, ScannedAt: st.scanned}
}

func walkInteresting(ctx context.Context, root string, visit func(rel string, mod time.Time)) error {
	visited := 0
	return filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // unreadable entries are skipped
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if d.IsDir() {
			if p != root && (skippedDirs[d.Name()] || strings.HasPrefix(d.Name(), ".")) {
				return filepath.SkipDir
			}
			return nil
		}
		if visited++; visited > maxVisitedFiles {
			return errFileLimit
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		if !interesting(rel) {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		visit(rel, info.ModTime())
		return nil
	})
}

func walkWarnings(err error) []string {
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return []string{"scan timed out: results are partial"}
	case errors.Is(err, errFileLimit):
		return []string{"more than 120000 files: results are partial"}
	}
	return nil
}

func scanFile(root, rel string, env map[string]string) fileResult {
	full := filepath.Join(root, filepath.FromSlash(rel))
	info, err := os.Stat(full)
	if err != nil {
		return fileResult{Warnings: []string{rel + ": " + err.Error()}}
	}
	if info.Size() > maxFileBytes {
		return fileResult{ModTime: info.ModTime()}
	}
	data, err := os.ReadFile(full)
	if err != nil {
		return fileResult{ModTime: info.ModTime(), Warnings: []string{rel + ": " + err.Error()}}
	}
	entities, warnings := detectFile(rel, data, env)
	return fileResult{Entities: entities, Warnings: warnings, ModTime: info.ModTime()}
}

// rootEnv holds raw .env values for compose interpolation. It never leaves
// the backend.
func rootEnv(root string) map[string]string {
	env := map[string]string{}
	data, err := os.ReadFile(filepath.Join(root, ".env"))
	if err != nil {
		return env
	}
	for _, e := range parseDotenv(data) {
		env[e.Key] = e.Value
	}
	return env
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `go test ./internal/devcontext/ -v`
Expected: PASS (all). If `TestManagerCheckStaleFindsNewAndDeletedFiles` flakes on coarse filesystem timestamps, the `Chtimes` into the future already guarantees a differing mtime for the new file; deleted files are detected regardless of time.

- [ ] **Step 7: Vet and commit**

Run: `go vet ./internal/devcontext/`
Expected: no output.

```bash
git add internal/devcontext/
git commit -m "feat(devcontext): per-session scan manager with incremental rescans and guarded contract reads"
```

---

### Task 7: Wails binding, gO event hook and TypeScript binding

**Files:**
- Create: `devcontext_bindings.go`
- Modify: `goide_bindings.go` (struct field + callback + two methods), `main.go` (construct, register service, attach desktop)
- Create: `frontend/bindings/adomnia/devcontext.ts`
- Modify: `frontend/bindings/adomnia/index.ts`
- Test: `devcontext_bindings_test.go`

**Interfaces:**
- Consumes: `devcontext.NewManager`, `Manager` methods (Task 6); `goide.EventEnvelope`, `goide.Document.RelativePath`, `goide.Session.Project.{RootPath,RealPath}`.
- Produces: Wails service `DevContext` with `GetContext(sessionID) (devcontext.Snapshot, error)`, `RescanContext(sessionID) (devcontext.Snapshot, error)`, `CheckStale(sessionID) (bool, error)`, `ReadContextFile(sessionID, relPath string) (string, error)`; event `devcontext:changed {sessionId, version}`; `(*GoIDE).onServiceEvent(fn func(goide.EventEnvelope))`, `(*GoIDE).sessionRoot(sessionID string) (string, error)`. TS: `GetContext`, `RescanContext`, `CheckStale`, `ReadContextFile` in `frontend/bindings/adomnia/devcontext.ts`.

- [ ] **Step 1: Write the failing test**

```go
package main

import (
	"adomnia/internal/goide"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestDevContextReactsToGoIDEEvents(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module example.com/a\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	d := newDevContext(func(string) (string, error) { return root, nil })
	snap, err := d.GetContext("s1")
	if err != nil || len(snap.Entities) != 1 {
		t.Fatalf("initial scan: %v %+v", err, snap)
	}
	if err := os.WriteFile(filepath.Join(root, "main.go"), []byte("package main\nfunc main() {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	d.handleGoIDEEvent(goide.EventEnvelope{Type: "document.saved", SessionID: "s1", Payload: goide.Document{RelativePath: "main.go"}})
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if snap, _ = d.GetContext("s1"); len(snap.Entities) == 2 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if len(snap.Entities) != 2 {
		t.Fatalf("document.saved must rescan the file, got %+v", snap.Entities)
	}
	d.handleGoIDEEvent(goide.EventEnvelope{Type: "session.closed", SessionID: "s1"})
	if snap, _ = d.GetContext("s1"); snap.Version != 1 {
		t.Fatalf("session.closed must drop the context, got version %d", snap.Version)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test . -run TestDevContextReactsToGoIDEEvents -v`
Expected: FAIL — `undefined: newDevContext`.

- [ ] **Step 3: Write `devcontext_bindings.go`**

```go
package main

import (
	"adomnia/internal/devcontext"
	"adomnia/internal/goide"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// DevContext exposes the project context of gO sessions to the frontend.
type DevContext struct {
	manager *devcontext.Manager
	desktop *application.App
}

func NewDevContext(goIDE *GoIDE) *DevContext {
	d := newDevContext(goIDE.sessionRoot)
	goIDE.onServiceEvent(d.handleGoIDEEvent)
	return d
}

func newDevContext(resolveRoot devcontext.RootResolver) *DevContext {
	d := &DevContext{}
	d.manager = devcontext.NewManager(resolveRoot, func(sessionID string, version int64) {
		if d.desktop != nil {
			d.desktop.Event.Emit("devcontext:changed", map[string]any{"sessionId": sessionID, "version": version})
		}
	})
	return d
}

func (d *DevContext) attachDesktop(desktop *application.App) { d.desktop = desktop }

func (d *DevContext) handleGoIDEEvent(event goide.EventEnvelope) {
	switch event.Type {
	case "document.saved":
		if doc, ok := event.Payload.(goide.Document); ok {
			go d.manager.Invalidate(string(event.SessionID), doc.RelativePath)
		}
	case "session.closed":
		d.manager.Drop(string(event.SessionID))
	}
}

// GetContext returns the context of a gO session, scanning it on first use.
func (d *DevContext) GetContext(sessionID string) (devcontext.Snapshot, error) {
	return d.manager.Get(sessionID)
}

// RescanContext forces a full rescan of the session folder.
func (d *DevContext) RescanContext(sessionID string) (devcontext.Snapshot, error) {
	return d.manager.Rescan(sessionID)
}

// CheckStale rescans files changed outside gO; true when something changed.
func (d *DevContext) CheckStale(sessionID string) (bool, error) {
	return d.manager.CheckStale(sessionID)
}

// ReadContextFile returns an OpenAPI, proto or WSDL document of the session.
func (d *DevContext) ReadContextFile(sessionID, relPath string) (string, error) {
	return d.manager.ReadFile(sessionID, relPath)
}
```

- [ ] **Step 4: Hook gO events and expose session roots in `goide_bindings.go`**

Add a field to the `GoIDE` struct:

```go
	serviceListeners   []func(goide.EventEnvelope)
```

Replace the callback in `NewGoIDE`:

```go
	service := goide.NewService(goIDEStore{}, func(event goide.EventEnvelope) {
		if binding == nil {
			return
		}
		if binding.desktop != nil {
			binding.desktop.Event.Emit("goide:event", event)
		}
		for _, listener := range binding.serviceListeners {
			listener(event)
		}
	})
```

Add after `attachMainWindow`:

```go
// onServiceEvent lets other backend services react to gO events (saves,
// closed sessions). Register listeners before the app starts.
func (g *GoIDE) onServiceEvent(listener func(goide.EventEnvelope)) {
	g.serviceListeners = append(g.serviceListeners, listener)
}

// sessionRoot resolves the project folder of an open gO session.
func (g *GoIDE) sessionRoot(sessionID string) (string, error) {
	sessions, err := g.service.ListSessions()
	if err != nil {
		return "", err
	}
	for _, session := range sessions {
		if string(session.ID) == sessionID {
			if session.Project.RealPath != "" {
				return session.Project.RealPath, nil
			}
			return session.Project.RootPath, nil
		}
	}
	return "", fmt.Errorf("gO session %s is not open", sessionID)
}
```

Before relying on `event.Payload.(goide.Document)`, confirm in `internal/goide/service.go:297` that `document.saved` passes `document.Document` (a `goide.Document` value) — it does at the time of writing.

- [ ] **Step 5: Register the service in `main.go`**

After `goIDE := NewGoIDE()` add:

```go
	devContext := NewDevContext(goIDE)
```

In `Services:` after `application.NewService(goIDE),` add:

```go
			application.NewService(devContext),
```

After `goIDE.attachDesktop(desktopApp)` add:

```go
	devContext.attachDesktop(desktopApp)
```

- [ ] **Step 6: Write the TS binding `frontend/bindings/adomnia/devcontext.ts`**

```ts
// Hand-written until `wails3 generate bindings` runs in this environment.
// IDs are FNV-1a 32-bit of "main.DevContext.<Method>", the same scheme the
// generator uses (checked against main.OASLint.Lint = 325496117).

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore: Unused imports
import { Call as $Call, CancellablePromise as $CancellablePromise } from "@wailsio/runtime";

export function GetContext(sessionID: string): $CancellablePromise<any> {
    return $Call.ByID(276047489, sessionID);
}

export function RescanContext(sessionID: string): $CancellablePromise<any> {
    return $Call.ByID(1975717609, sessionID);
}

export function CheckStale(sessionID: string): $CancellablePromise<boolean> {
    return $Call.ByID(2169833367, sessionID);
}

export function ReadContextFile(sessionID: string, relPath: string): $CancellablePromise<string> {
    return $Call.ByID(1346169035, sessionID, relPath);
}
```

In `frontend/bindings/adomnia/index.ts` add `import * as DevContext from "./devcontext.js";` after the `CollectionFS` import and `DevContext,` in the `export { … }` list after `CollectionFS,`.

- [ ] **Step 7: Run tests and build**

Run: `go test . -run TestDevContextReactsToGoIDEEvents -v && go build ./... && go vet . ./internal/devcontext/`
Expected: PASS, build OK, no vet output.

- [ ] **Step 8: Commit**

```bash
git add devcontext_bindings.go devcontext_bindings_test.go goide_bindings.go main.go frontend/bindings/adomnia/devcontext.ts frontend/bindings/adomnia/index.ts
git commit -m "feat(devcontext): Wails DevContext service wired to gO save and close events"
```

---

### Task 8: P0 entity router, notices and panel dispatch

**Files:**
- Create: `frontend/src/lib/entities/types.ts`, `frontend/src/lib/entities/notice.ts`, `frontend/src/lib/entities/router.ts`, `frontend/src/lib/entities/dispatch.ts`
- Create: `frontend/src/components/layout/EntityNotice.tsx`
- Modify: `frontend/src/App.tsx` (render `EntityNotice`), `frontend/src/components/layout/CommandPalette.tsx` (deep links use `dispatchToPanel`)
- Test: `frontend/src/lib/entities/router.test.ts`

**Interfaces:**
- Produces:
  - `type EntityKind = 'module' | 'route' | 'service' | 'datasource' | 'envvar' | 'contract' | 'table' | 'topic' | 'symbol'`
  - `interface EntityRef { kind: EntityKind; id: string; label: string; attrs: Record<string, string>; source?: { file: string; line: number }; sessionId?: string }`
  - `interface Opener { intent: string; title: string; isDefault?: boolean; available?: (ref: EntityRef) => boolean; run: (ref: EntityRef) => void | Promise<void> }`
  - `registerOpener(kind: EntityKind | '*', opener: Opener): () => void`, `actionsFor(ref): Opener[]`, `openEntity(ref, intent?): Promise<void>`, `clearOpeners(): void`
  - `useEntityNotice` (zustand: `{ notice: EntityNoticeState | null }`), `showEntityNotice(message: string, action?: { label: string; run: () => void }): void`, `clearEntityNotice(): void`
  - `dispatchToPanel(rail: RailItem, eventName: string, detail?: Record<string, unknown>): void`, `handoffToPanel(rail: RailItem, ref: EntityRef, intent: string, payload?: Record<string, unknown>): void`, `useEntityHandoff(rail: RailItem, handler: (ref: EntityRef, intent: string, payload: Record<string, unknown>) => boolean | void): void`

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { actionsFor, clearOpeners, openEntity, registerOpener } from './router'
import { useEntityNotice, clearEntityNotice } from './notice'
import type { EntityRef } from './types'

const route: EntityRef = { kind: 'route', id: 'route:GET /x', label: 'GET /x', attrs: { method: 'GET', path: '/x' }, source: { file: 'a.go', line: 3 } }

afterEach(() => { clearOpeners(); clearEntityNotice() })

describe('entity router', () => {
  it('runs the default intent, then explicit intents', async () => {
    const send = vi.fn(); const handler = vi.fn()
    registerOpener('route', { intent: 'handler', title: 'Go to handler', run: handler })
    registerOpener('route', { intent: 'send', title: 'Send', isDefault: true, run: send })
    await openEntity(route)
    expect(send).toHaveBeenCalledWith(route)
    await openEntity(route, 'handler')
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('adds wildcard openers and filters unavailable ones', () => {
    registerOpener('route', { intent: 'send', title: 'Send', run: vi.fn() })
    registerOpener('*', { intent: 'source', title: 'Open source', available: (ref) => !!ref.source, run: vi.fn() })
    registerOpener('route', { intent: 'mock', title: 'Mock', available: () => false, run: vi.fn() })
    expect(actionsFor(route).map((a) => a.intent)).toEqual(['send', 'source'])
    expect(actionsFor({ ...route, source: undefined }).map((a) => a.intent)).toEqual(['send'])
  })

  it('falls back to the first action when none is default', async () => {
    const first = vi.fn()
    registerOpener('table', { intent: 'query', title: 'Query', run: first })
    await openEntity({ kind: 'table', id: 'table:t', label: 't', attrs: {} })
    expect(first).toHaveBeenCalled()
  })

  it('explains, never silently ignores, a missing opener or a failure', async () => {
    await openEntity(route)
    expect(useEntityNotice.getState().notice?.message).toContain('GET /x')
    registerOpener('route', { intent: 'send', title: 'Send', run: () => { throw new Error('no tab') } })
    await openEntity(route)
    expect(useEntityNotice.getState().notice?.message).toContain('no tab')
  })

  it('returns an unregister function', () => {
    const off = registerOpener('topic', { intent: 'open', title: 'Open', run: vi.fn() })
    off()
    expect(actionsFor({ kind: 'topic', id: 'topic:a', label: 'a', attrs: {} })).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/entities/router.test.ts`
Expected: FAIL — cannot resolve `./router`.

- [ ] **Step 3: Write `types.ts`**

```ts
export type EntityKind = 'module' | 'route' | 'service' | 'datasource' | 'envvar' | 'contract' | 'table' | 'topic' | 'symbol'

/** A thing any panel can open: a route, a table, a topic, a Go symbol… */
export interface EntityRef {
  kind: EntityKind
  id: string
  label: string
  attrs: Record<string, string>
  source?: { file: string; line: number }
  /** gO session the entity belongs to; source paths are relative to its root. */
  sessionId?: string
}

export interface Opener {
  intent: string
  title: string
  isDefault?: boolean
  available?: (ref: EntityRef) => boolean
  run: (ref: EntityRef) => void | Promise<void>
}
```

- [ ] **Step 4: Write `notice.ts`**

```ts
import { create } from 'zustand'

export interface EntityNoticeState {
  id: number
  message: string
  action?: { label: string; run: () => void }
}

export const useEntityNotice = create<{ notice: EntityNoticeState | null }>(() => ({ notice: null }))

let nextId = 0
let hideTimer: ReturnType<typeof setTimeout> | undefined

/** One-line feedback for cross-panel actions; notices with an action stay until used or dismissed. */
export function showEntityNotice(message: string, action?: EntityNoticeState['action']): void {
  nextId += 1
  const id = nextId
  useEntityNotice.setState({ notice: { id, message, action } })
  if (hideTimer) clearTimeout(hideTimer)
  if (!action) {
    hideTimer = setTimeout(() => {
      if (useEntityNotice.getState().notice?.id === id) useEntityNotice.setState({ notice: null })
    }, 6000)
  }
}

export function clearEntityNotice(): void {
  if (hideTimer) clearTimeout(hideTimer)
  useEntityNotice.setState({ notice: null })
}
```

- [ ] **Step 5: Write `router.ts`**

```ts
import { showEntityNotice } from './notice'
import type { EntityKind, EntityRef, Opener } from './types'

const openers = new Map<EntityKind | '*', Opener[]>()

export function registerOpener(kind: EntityKind | '*', opener: Opener): () => void {
  openers.set(kind, [...(openers.get(kind) ?? []), opener])
  return () => openers.set(kind, (openers.get(kind) ?? []).filter((o) => o !== opener))
}

export function actionsFor(ref: EntityRef): Opener[] {
  return [...(openers.get(ref.kind) ?? []), ...(openers.get('*') ?? [])]
    .filter((opener) => opener.available?.(ref) ?? true)
}

export async function openEntity(ref: EntityRef, intent?: string): Promise<void> {
  const actions = actionsFor(ref)
  const opener = intent
    ? actions.find((action) => action.intent === intent)
    : actions.find((action) => action.isDefault) ?? actions[0]
  if (!opener) {
    showEntityNotice(`Nothing can open ${ref.label} yet.`)
    return
  }
  try {
    await opener.run(ref)
  } catch (error) {
    showEntityNotice(`${opener.title} failed for ${ref.label}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Test helper. */
export function clearOpeners(): void {
  openers.clear()
}
```

- [ ] **Step 6: Run router tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/entities/router.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Write `dispatch.ts`** (moved from `CommandPalette.runInPanel`, plus the typed handoff)

```ts
import { useEffect, useRef } from 'react'
import { useAppStore } from '@/stores/app'
import type { RailItem } from '@/stores/app'
import type { EntityRef } from './types'

export const ENTITY_HANDOFF_EVENT = 'adomnia:entity-handoff'

/**
 * Switch to a panel and deliver an event once it is mounted: the event is
 * re-dispatched every frame (max ~2s) until a listener sets detail.handled.
 */
export function dispatchToPanel(rail: RailItem, eventName: string, detail: Record<string, unknown> = {}): void {
  useAppStore.getState().setActiveRail(rail)
  let attempts = 0
  const dispatchWhenMounted = () => {
    if (useAppStore.getState().activeRail !== rail) return
    const eventDetail = { ...detail, handled: false }
    document.dispatchEvent(new CustomEvent(eventName, { detail: eventDetail }))
    if (!eventDetail.handled && attempts < 120) {
      attempts += 1
      window.requestAnimationFrame(dispatchWhenMounted)
    }
  }
  window.requestAnimationFrame(dispatchWhenMounted)
}

export function handoffToPanel(rail: RailItem, ref: EntityRef, intent: string, payload: Record<string, unknown> = {}): void {
  dispatchToPanel(rail, ENTITY_HANDOFF_EVENT, { rail, ref, intent, payload })
}

/**
 * Receive entity handoffs for `rail`. Return false while the panel is not
 * ready (e.g. still hydrating) and the handoff is retried next frame.
 */
export function useEntityHandoff(
  rail: RailItem,
  handler: (ref: EntityRef, intent: string, payload: Record<string, unknown>) => boolean | void,
): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ rail: RailItem; ref: EntityRef; intent: string; payload: Record<string, unknown>; handled: boolean }>).detail
      if (!detail || detail.rail !== rail || detail.handled) return
      if (handlerRef.current(detail.ref, detail.intent, detail.payload ?? {}) !== false) detail.handled = true
    }
    document.addEventListener(ENTITY_HANDOFF_EVENT, listener)
    return () => document.removeEventListener(ENTITY_HANDOFF_EVENT, listener)
  }, [rail])
}
```

- [ ] **Step 8: Use `dispatchToPanel` in `CommandPalette.tsx`**

Delete the local `runInPanel` function (the `const runInPanel = (rail, eventName, extra) => { … }` block inside `useMemo`) and add at the top:

```ts
import { dispatchToPanel } from '@/lib/entities/dispatch'
```

Replace the three call sites `runInPanel(` with `dispatchToPanel(` (Start Mock, Start Proxy, deep links). The behaviour is identical: `dispatchToPanel` calls `setActiveRail` itself.

- [ ] **Step 9: Write `EntityNotice.tsx` and render it**

```tsx
import { X } from 'lucide-react'
import { clearEntityNotice, useEntityNotice } from '@/lib/entities/notice'

/** Bottom-centre feedback bar for cross-panel entity actions. */
export function EntityNotice() {
  const notice = useEntityNotice((s) => s.notice)
  if (!notice) return null
  return (
    <div role="status" className="fixed bottom-9 left-1/2 z-[310] flex max-w-[min(640px,calc(100vw-32px))] -translate-x-1/2 items-center gap-3 rounded-md border border-border-2 bg-surface-2 px-3 py-2 text-xs text-text-2 shadow-lg shadow-black/40">
      <span className="min-w-0 flex-1 break-words">{notice.message}</span>
      {notice.action && (
        <button
          type="button"
          onClick={() => { notice.action?.run(); clearEntityNotice() }}
          className="shrink-0 rounded border border-accent/40 bg-accent/12 px-2 py-0.5 text-[11px] font-medium text-accent hover:bg-accent/20 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          {notice.action.label}
        </button>
      )}
      <button type="button" aria-label="Dismiss" onClick={clearEntityNotice} className="shrink-0 text-text-4 hover:text-text-2">
        <X size={12} />
      </button>
    </div>
  )
}
```

In `frontend/src/App.tsx`, import `{ EntityNotice }` from `@/components/layout/EntityNotice` and render `<EntityNotice />` right after the `{commandPaletteOpen && …<CommandPalette …/>…}` line (App.tsx:199).

- [ ] **Step 10: Typecheck, test, commit**

Run: `cd frontend && npx tsc --noEmit -p . && npx vitest run src/lib/entities`
Expected: no type errors; PASS.

```bash
git add frontend/src/lib/entities frontend/src/components/layout/EntityNotice.tsx frontend/src/components/layout/CommandPalette.tsx frontend/src/App.tsx
git commit -m "feat(entities): typed entity router, panel handoff and notice bar"
```

---

### Task 9: Frontend context API, store and live sync

**Files:**
- Create: `frontend/src/lib/devcontext-api.ts`, `frontend/src/stores/devcontext.ts`
- Modify: `frontend/src/App.tsx` (start sync once)
- Test: `frontend/src/lib/entities/entityRef.test.ts`

**Interfaces:**
- Consumes: TS bindings (Task 7), `EntityRef` (Task 8), `useGoIDEStore.activeSessionId`.
- Produces:
  - `DevEntityKind`, `DevSource`, `DevEntity`, `DevSnapshot` types; `getDevContext(sessionId)`, `rescanDevContext(sessionId)`, `checkDevContextStale(sessionId)`, `readDevContextFile(sessionId, relPath)`
  - `entityRefFrom(entity: DevEntity, sessionId: string): EntityRef` (in `lib/devcontext-api.ts`)
  - `useDevContextStore`: `{ snapshots: Record<string, DevSnapshot>; errors: Record<string, string>; ensure(id): Promise<void>; load(id): Promise<void>; rescan(id): Promise<void>; checkStale(id): Promise<void> }`
  - `startDevContextSync(): () => void`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { entityRefFrom, type DevEntity } from '../devcontext-api'

describe('entityRefFrom', () => {
  it('keeps attrs, first source and the session', () => {
    const entity: DevEntity = {
      id: 'route:GET /x', kind: 'route', label: 'GET /x', attrs: { method: 'GET' }, confidence: 'inferred',
      sources: [{ detector: 'goroutes', file: 'api/r.go', line: 4 }, { detector: 'oas', file: 'api/o.yaml', line: 9 }],
    }
    expect(entityRefFrom(entity, 's1')).toEqual({
      kind: 'route', id: 'route:GET /x', label: 'GET /x', attrs: { method: 'GET' },
      source: { file: 'api/r.go', line: 4 }, sessionId: 's1',
    })
  })

  it('tolerates null attrs/sources from Go', () => {
    const ref = entityRefFrom({ id: 'table:t', kind: 'table', label: 't', attrs: null as unknown as Record<string, string>, sources: null as unknown as [], confidence: 'inferred' }, 's1')
    expect(ref.attrs).toEqual({})
    expect(ref.source).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/entities/entityRef.test.ts`
Expected: FAIL — cannot resolve `../devcontext-api`.

- [ ] **Step 3: Write `lib/devcontext-api.ts`**

```ts
import * as DevContextBindings from '../../bindings/adomnia/devcontext'
import type { EntityRef } from './entities/types'

export type DevEntityKind = 'module' | 'route' | 'service' | 'datasource' | 'envvar' | 'contract' | 'table' | 'topic'

export interface DevSource { detector: string; file: string; line: number }

export interface DevEntity {
  id: string
  kind: DevEntityKind
  label: string
  attrs: Record<string, string>
  sources: DevSource[]
  confidence: 'certain' | 'inferred'
}

export interface DevSnapshot {
  sessionId: string
  root: string
  version: number
  entities: DevEntity[]
  warnings: string[]
  scannedAt: string
}

export const getDevContext = (sessionId: string) => DevContextBindings.GetContext(sessionId) as Promise<DevSnapshot>
export const rescanDevContext = (sessionId: string) => DevContextBindings.RescanContext(sessionId) as Promise<DevSnapshot>
export const checkDevContextStale = (sessionId: string) => DevContextBindings.CheckStale(sessionId) as Promise<boolean>
export const readDevContextFile = (sessionId: string, relPath: string) => DevContextBindings.ReadContextFile(sessionId, relPath) as Promise<string>

export function entityRefFrom(entity: DevEntity, sessionId: string): EntityRef {
  const first = entity.sources?.[0]
  return {
    kind: entity.kind,
    id: entity.id,
    label: entity.label,
    attrs: entity.attrs ?? {},
    source: first ? { file: first.file, line: first.line } : undefined,
    sessionId,
  }
}
```

- [ ] **Step 4: Write `stores/devcontext.ts`**

```ts
import { create } from 'zustand'
import { Events } from '@wailsio/runtime'
import { checkDevContextStale, getDevContext, rescanDevContext, type DevSnapshot } from '@/lib/devcontext-api'
import { useGoIDEStore } from '@/stores/goide'

interface DevContextState {
  snapshots: Record<string, DevSnapshot>
  errors: Record<string, string>
  /** Load once per session; later updates arrive through `devcontext:changed`. */
  ensure: (sessionId: string) => Promise<void>
  load: (sessionId: string) => Promise<void>
  rescan: (sessionId: string) => Promise<void>
  checkStale: (sessionId: string) => Promise<void>
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export const useDevContextStore = create<DevContextState>((set, get) => {
  const store = (sessionId: string, snapshot: DevSnapshot) => set((s) => {
    const { [sessionId]: _dropped, ...errors } = s.errors
    return { snapshots: { ...s.snapshots, [sessionId]: snapshot }, errors }
  })
  const fail = (sessionId: string, error: unknown) => set((s) => ({ errors: { ...s.errors, [sessionId]: message(error) } }))
  return {
    snapshots: {},
    errors: {},
    ensure: async (sessionId) => {
      if (!get().snapshots[sessionId]) await get().load(sessionId)
    },
    load: async (sessionId) => {
      try { store(sessionId, await getDevContext(sessionId)) } catch (error) { fail(sessionId, error) }
    },
    rescan: async (sessionId) => {
      try { store(sessionId, await rescanDevContext(sessionId)) } catch (error) { fail(sessionId, error) }
    },
    checkStale: async (sessionId) => {
      if (!get().snapshots[sessionId]) return
      try { await checkDevContextStale(sessionId) } catch (error) { fail(sessionId, error) }
    },
  }
})

/** Keep snapshots fresh: backend change events plus a stale check on window focus. */
export function startDevContextSync(): () => void {
  const offChanged = Events.On('devcontext:changed', (event) => {
    const { sessionId } = (event.data ?? {}) as { sessionId?: string }
    if (sessionId && useDevContextStore.getState().snapshots[sessionId]) void useDevContextStore.getState().load(sessionId)
  })
  const onFocus = () => {
    const sessionId = useGoIDEStore.getState().activeSessionId
    if (sessionId) void useDevContextStore.getState().checkStale(sessionId)
  }
  window.addEventListener('focus', onFocus)
  return () => {
    offChanged()
    window.removeEventListener('focus', onFocus)
  }
}
```

Note: `Events.On` returns an unsubscribe function in `@wailsio/runtime` (same usage as `lib/goide-api.ts:206`).

- [ ] **Step 5: Start the sync in `App.tsx`**

Add imports `import { startDevContextSync } from '@/stores/devcontext'` and add a new effect next to the existing ones (App.tsx ~line 78):

```ts
  useEffect(() => startDevContextSync(), [])
```

- [ ] **Step 6: Typecheck, test, commit**

Run: `cd frontend && npx tsc --noEmit -p . && npx vitest run src/lib/entities`
Expected: PASS.

```bash
git add frontend/src/lib/devcontext-api.ts frontend/src/stores/devcontext.ts frontend/src/lib/entities/entityRef.test.ts frontend/src/App.tsx
git commit -m "feat(devcontext): frontend API, per-session store and live sync"
```

---

### Task 10: Openers that need no panel changes

**Files:**
- Create: `frontend/src/lib/entities/routeRequest.ts`, `frontend/src/lib/entities/openers.ts`
- Modify: `frontend/src/App.tsx` (register openers once)
- Test: `frontend/src/lib/entities/routeRequest.test.ts`

**Interfaces:**
- Consumes: router (Task 8), `readDevContextFile` (Task 9), `handoffToPanel`, `useGoIDEStore.openLocation(relativePath, line, column?)`, `useTabsStore.newTab/updateRequest/activeTabId`, `useEnvironmentsStore.{environments, activeEnvId, updateVariables}`, `createMockEndpointFromRequest`, `appendMockEndpoints`, `blankRequest`.
- Produces: `httpMethodForRoute(method: string): HttpMethod`, `requestUrlForRoute(path: string): string`, `mockPathForRoute(path: string): string`, `withBaseUrl(variables: EnvVariable[], url: string): EnvVariable[]`, `registerDefaultOpeners(): () => void`. Handoff intents for Task 11: `database/connect`, `database/query`, `broker/connect`, `broker/open`, `apidocs/open`, `grpc/open`, `soap/open` (payload `{ text, name }` for the last three).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { httpMethodForRoute, mockPathForRoute, requestUrlForRoute, withBaseUrl } from './routeRequest'

describe('route → request helpers', () => {
  it('builds a request URL on {{baseUrl}} with path params as variables', () => {
    expect(requestUrlForRoute('/payments/{id}/items/{itemId}')).toBe('{{baseUrl}}/payments/{{id}}/items/{{itemId}}')
    expect(requestUrlForRoute('/files/{path...}')).toBe('{{baseUrl}}/files/{{path}}')
  })
  it('maps ANY and unknown methods to GET', () => {
    expect(httpMethodForRoute('ANY')).toBe('GET')
    expect(httpMethodForRoute('delete')).toBe('DELETE')
    expect(httpMethodForRoute('CONNECTX')).toBe('GET')
  })
  it('converts to mock :param syntax', () => {
    expect(mockPathForRoute('/payments/{id}')).toBe('/payments/:id')
  })
  it('replaces or appends baseUrl without touching other variables', () => {
    const vars = [{ id: 'a', key: 'token', value: 't', enabled: true }, { id: 'b', key: 'baseUrl', value: 'old', enabled: false }]
    const next = withBaseUrl(vars, 'http://localhost:8080')
    expect(next).toEqual([vars[0], { ...vars[1], value: 'http://localhost:8080', enabled: true }])
    expect(vars[1].value).toBe('old')
    const appended = withBaseUrl([vars[0]], 'http://localhost:9000')
    expect(appended[1]).toMatchObject({ key: 'baseUrl', value: 'http://localhost:9000', enabled: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/entities/routeRequest.test.ts`
Expected: FAIL — cannot resolve `./routeRequest`.

- [ ] **Step 3: Write `routeRequest.ts`**

```ts
import type { EnvVariable, HttpMethod } from '@/lib/types'

const ROUTE_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE', 'QUERY']

export function httpMethodForRoute(method: string): HttpMethod {
  const upper = method.toUpperCase() as HttpMethod
  return ROUTE_METHODS.includes(upper) ? upper : 'GET'
}

/** `/payments/{id}` → `{{baseUrl}}/payments/{{id}}` (Go `{path...}` wildcards too). */
export function requestUrlForRoute(path: string): string {
  return `{{baseUrl}}${path.replace(/\{([A-Za-z_]\w*)(?:\.\.\.)?\}/g, '{{$1}}')}`
}

/** Mock Server matches `:param` segments. */
export function mockPathForRoute(path: string): string {
  return path.replace(/\{([A-Za-z_]\w*)(?:\.\.\.)?\}/g, ':$1')
}

export function withBaseUrl(variables: EnvVariable[], url: string): EnvVariable[] {
  if (variables.some((v) => v.key === 'baseUrl')) {
    return variables.map((v) => (v.key === 'baseUrl' ? { ...v, value: url, enabled: true } : v))
  }
  return [...variables, { id: crypto.randomUUID(), key: 'baseUrl', value: url, enabled: true }]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/entities/routeRequest.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write `openers.ts`**

```ts
import { blankRequest } from '@/lib/types'
import { appendMockEndpoints, createMockEndpointFromRequest } from '@/lib/mockEndpointStore'
import { readDevContextFile } from '@/lib/devcontext-api'
import { useAppStore } from '@/stores/app'
import type { RailItem } from '@/stores/app'
import { useEnvironmentsStore } from '@/stores/environments'
import { useGoIDEStore } from '@/stores/goide'
import { useTabsStore } from '@/stores/tabs'
import { handoffToPanel } from './dispatch'
import { showEntityNotice } from './notice'
import { registerOpener } from './router'
import { httpMethodForRoute, mockPathForRoute, requestUrlForRoute, withBaseUrl } from './routeRequest'
import type { EntityRef } from './types'

const DB_TYPES = new Set(['postgres', 'mysql', 'mongodb'])
const CONTRACT_RAILS: Record<string, RailItem> = { oas: 'apidocs', proto: 'grpc', wsdl: 'soap' }

async function openInGo(file: string, line: number): Promise<void> {
  useAppStore.getState().setActiveRail('goide')
  await useGoIDEStore.getState().openLocation(file, line, 1)
}

function sendRoute(ref: EntityRef): void {
  const tabs = useTabsStore.getState()
  useAppStore.getState().setActiveRail('collections')
  tabs.newTab(httpMethodForRoute(ref.attrs.method ?? 'GET'))
  const { activeTabId, tabs: open } = useTabsStore.getState()
  const tab = open.find((t) => t.id === activeTabId)
  if (!tab) throw new Error('could not open a request tab')
  useTabsStore.getState().updateRequest(tab.id, { ...tab.request, name: ref.label, url: requestUrlForRoute(ref.attrs.path ?? '/') })
}

async function mockRoute(ref: EntityRef): Promise<void> {
  const request = { ...blankRequest(httpMethodForRoute(ref.attrs.method ?? 'GET'), ref.label), url: mockPathForRoute(ref.attrs.path ?? '/') }
  const endpoint = createMockEndpointFromRequest(request)
  if (!endpoint) throw new Error(`${request.method} cannot be mocked`)
  await appendMockEndpoints([endpoint])
  useAppStore.getState().setActiveRail('mock')
  showEntityNotice(`Mock endpoint ${request.method} ${request.url} added.`)
}

function proposeBaseUrl(ref: EntityRef): void {
  const envs = useEnvironmentsStore.getState()
  const env = envs.environments.find((e) => e.id === envs.activeEnvId)
  if (!env) {
    showEntityNotice('Select an environment first, then use this service as its baseUrl.')
    return
  }
  const url = `http://${ref.attrs.host ?? 'localhost'}:${ref.attrs.port}`
  showEntityNotice(`Set baseUrl to ${url} in "${env.name}"?`, {
    label: 'Set baseUrl',
    run: () => useEnvironmentsStore.getState().updateVariables(env.id, withBaseUrl(env.variables, url)),
  })
}

function showEnvVar(ref: EntityRef): void {
  const value = ref.attrs.value ?? '(not set in any .env file)'
  const where = ref.source ? ` — ${ref.source.file}:${ref.source.line}` : ''
  showEntityNotice(`${ref.label} = ${value}${where}`)
}

async function openContract(ref: EntityRef): Promise<void> {
  const rail = CONTRACT_RAILS[ref.attrs.type ?? '']
  if (!rail || !ref.sessionId) throw new Error('unsupported contract')
  const text = await readDevContextFile(ref.sessionId, ref.attrs.path ?? ref.label)
  handoffToPanel(rail, ref, 'open', { text, name: ref.label })
}

/** Registers the v1 openers once; returns a disposer (used by HMR and tests). */
export function registerDefaultOpeners(): () => void {
  const offs = [
    registerOpener('*', {
      intent: 'source', title: 'Open source in gO',
      available: (ref) => ref.kind !== 'symbol' && !!ref.source,
      run: (ref) => openInGo(ref.source!.file, ref.source!.line),
    }),
    registerOpener('symbol', { intent: 'open', title: 'Open in gO', isDefault: true, run: (ref) => openInGo(ref.source!.file, ref.source!.line) }),
    registerOpener('route', { intent: 'send', title: 'Send in API Client', isDefault: true, run: sendRoute }),
    registerOpener('route', {
      intent: 'handler', title: 'Go to handler',
      available: (ref) => !!ref.attrs.handlerFile,
      run: (ref) => openInGo(ref.attrs.handlerFile, Number(ref.attrs.handlerLine) || 1),
    }),
    registerOpener('route', { intent: 'mock', title: 'Add to Mock Server', run: mockRoute }),
    registerOpener('service', { intent: 'baseUrl', title: 'Use as baseUrl', isDefault: true, available: (ref) => !!ref.attrs.port, run: proposeBaseUrl }),
    registerOpener('datasource', {
      intent: 'connect', title: 'Connect', isDefault: true,
      run: (ref) => handoffToPanel(DB_TYPES.has(ref.attrs.type) ? 'database' : 'broker', ref, 'connect'),
    }),
    registerOpener('contract', { intent: 'open', title: 'Open', isDefault: true, available: (ref) => !!CONTRACT_RAILS[ref.attrs.type ?? ''], run: openContract }),
    registerOpener('envvar', { intent: 'show', title: 'Show value', isDefault: true, run: showEnvVar }),
    registerOpener('table', { intent: 'query', title: 'Query in Database', isDefault: true, run: (ref) => handoffToPanel('database', ref, 'query') }),
    registerOpener('topic', { intent: 'open', title: 'Open in Broker Studio', isDefault: true, run: (ref) => handoffToPanel('broker', ref, 'open') }),
  ]
  return () => offs.forEach((off) => off())
}
```

Before relying on `updateRequest(tabId, request)` and `newTab(method)` setting `activeTabId`, confirm `stores/tabs.ts:491` (`newTab` sets `activeTabId: tab.id`) and `stores/tabs.ts:567` — both hold at the time of writing.

- [ ] **Step 6: Register in `App.tsx`**

Import `{ registerDefaultOpeners }` from `@/lib/entities/openers` and add next to the sync effect:

```ts
  useEffect(() => registerDefaultOpeners(), [])
```

- [ ] **Step 7: Typecheck, test, commit**

Run: `cd frontend && npx tsc --noEmit -p . && npx vitest run src/lib/entities`
Expected: PASS.

```bash
git add frontend/src/lib/entities frontend/src/App.tsx
git commit -m "feat(entities): v1 openers for routes, services, env vars, contracts, tables and topics"
```

---

### Task 11: Panel handoffs — Database, Broker/Kafka, gRPC, SOAP, API Docs

**Files:**
- Modify: `frontend/src/components/database/dbShared.tsx` (add `upsertConnectionFromRef`), `frontend/src/components/database/DatabasePanel.tsx`
- Modify: `frontend/src/components/kafka/BrokerStudioPanel.tsx`, `frontend/src/components/kafka/KafkaPanel.tsx`
- Modify: `frontend/src/components/grpc/GrpcPanel.tsx`, `frontend/src/components/soap/SoapPanel.tsx`, `frontend/src/components/apidocs/ApiDocsPanel.tsx`
- Test: `frontend/src/components/database/dbShared.test.ts` (extend)

**Interfaces:**
- Consumes: `useEntityHandoff` (Task 8), intents from Task 10, `showEntityNotice`.
- Produces: `upsertConnectionFromRef(connections: DbConnection[], ref: EntityRef): { connections: DbConnection[]; id: string; created: boolean }`.

- [ ] **Step 1: Write the failing test** (append to `dbShared.test.ts`)

```ts
import { upsertConnectionFromRef, blankConnection } from './dbShared'
import type { EntityRef } from '@/lib/entities/types'

describe('upsertConnectionFromRef', () => {
  const ref: EntityRef = {
    kind: 'datasource', id: 'datasource:postgres@localhost:5432/payments', label: 'postgres@localhost:5432/payments',
    attrs: { type: 'postgres', host: 'localhost', port: '5432', user: 'app', database: 'payments' },
  }

  it('creates a connection without password and keeps existing ones', () => {
    const existing = [{ ...blankConnection(), name: 'Local SQLite' }]
    const { connections, id, created } = upsertConnectionFromRef(existing, ref)
    expect(created).toBe(true)
    expect(connections).toHaveLength(2)
    expect(connections[0]).toBe(existing[0])
    expect(connections[1]).toMatchObject({ id, driver: 'postgres', host: '127.0.0.1', port: 5432, user: 'app', database: 'payments', password: '' })
  })

  it('reuses a matching connection instead of duplicating it', () => {
    const first = upsertConnectionFromRef([], ref)
    const second = upsertConnectionFromRef(first.connections, ref)
    expect(second.created).toBe(false)
    expect(second.id).toBe(first.id)
    expect(second.connections).toBe(first.connections)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/database/dbShared.test.ts`
Expected: FAIL — `upsertConnectionFromRef` is not exported.

- [ ] **Step 3: Add `upsertConnectionFromRef` to `dbShared.tsx`**

```ts
import type { EntityRef } from '@/lib/entities/types'

/** Reuse a connection to the same server/database, or append a new one (no password). */
export function upsertConnectionFromRef(connections: DbConnection[], ref: EntityRef): { connections: DbConnection[]; id: string; created: boolean } {
  const driver = ref.attrs.type as DbDriver
  const host = ref.attrs.host === 'localhost' ? '127.0.0.1' : (ref.attrs.host ?? '127.0.0.1')
  const port = Number(ref.attrs.port) || 0
  const database = ref.attrs.database ?? ''
  const match = connections.find((c) => c.driver === driver && c.port === port && c.database === database && (c.host === host || c.host === ref.attrs.host))
  if (match) return { connections, id: match.id, created: false }
  const conn: DbConnection = { ...blankConnection(), name: ref.label, driver, host, port, database, user: ref.attrs.user ?? '', password: '' }
  return { connections: [...connections, conn], id: conn.id, created: true }
}
```

`localhost` is normalised to `127.0.0.1` (matches `blankConnection`, avoids IPv6 resolution on Windows).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/database/dbShared.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire `DatabasePanel.tsx`**

Imports: `useEntityHandoff` from `@/lib/entities/dispatch`, `showEntityNotice` from `@/lib/entities/notice`, `upsertConnectionFromRef` from `./dbShared`.

Inside `DatabasePanel`, after `addConnection`:

```tsx
  useEntityHandoff('database', (ref, intent) => {
    if (!hydrated) return false // never persist before saved connections are loaded
    if (intent === 'connect') {
      const next = upsertConnectionFromRef(connections, ref)
      if (next.created) void persistConnections(next.connections)
      setActiveId(next.id)
      showEntityNotice(next.created
        ? `Connection "${ref.label}" added. Enter the password or load it from the Vault, then connect.`
        : `Switched to the existing connection for ${ref.label}.`)
      return true
    }
    if (intent === 'query') {
      const tab = blankTab(ref.label, `SELECT * FROM ${ref.label} LIMIT 100`)
      setTabs((current) => [...current, tab])
      setActiveTabId(tab.id)
      if (!active || active.driver === 'sqlite') showEntityNotice(`Pick the connection that owns table ${ref.label}, then run the query.`)
      return true
    }
    return true
  })
```

(`active` is the existing derived active connection used by `updateActive`; if its name differs in the file, use that variable.)

- [ ] **Step 6: Wire Broker Studio and Kafka**

In `BrokerStudioPanel.tsx` (inside `BrokerStudioPanel`, after `selectConnection`):

```tsx
  useEntityHandoff('broker', (ref) => {
    const kind = ref.kind === 'topic' ? ref.attrs.broker : ref.attrs.type
    const target: Protocol = kind === 'amqp' || kind === 'rabbitmq' ? 'rabbitmq' : kind === 'nats' ? 'nats' : kind === 'redis' ? 'redis' : 'kafka'
    if (protocol !== target) {
      selectConnection(target)
      return false // retried next frame, once the protocol panel is mounted
    }
    if (target === 'kafka') return false // KafkaPanel handles it
    showEntityNotice(ref.kind === 'topic'
      ? `${target.toUpperCase()} subject/queue: ${ref.label}`
      : `${target.toUpperCase()} at ${ref.attrs.host}:${ref.attrs.port} — enter it in the connection form.`)
    return true
  })
```

In `KafkaPanel.tsx` (inside `KafkaPanel`, after the `cfg` state):

```tsx
  useEntityHandoff('broker', (ref) => {
    if (ref.kind === 'datasource') setCfg((c) => ({ ...c, brokers: `${ref.attrs.host}:${ref.attrs.port}` }))
    if (ref.kind === 'topic') { setCfg((c) => ({ ...c, topic: ref.label })); setTab('messages') }
    return true
  })
```

Imports in both files: `useEntityHandoff` from `@/lib/entities/dispatch`; `showEntityNotice` from `@/lib/entities/notice` (BrokerStudio only).

- [ ] **Step 7: Wire gRPC, SOAP, API Docs**

`GrpcPanel.tsx` (inside `GrpcPanel`, after `handleProtoFile`):

```tsx
  useEntityHandoff('grpc', (_ref, _intent, payload) => {
    void handleProtoFile(new File([String(payload.text ?? '')], String(payload.name ?? 'contract.proto')))
    return true
  })
```

`SoapPanel.tsx` (after `acceptWsdlText`):

```tsx
  useEntityHandoff('soap', (_ref, _intent, payload) => {
    acceptWsdlText(String(payload.text ?? ''))
    return true
  })
```

`ApiDocsPanel.tsx` (after `applyContent`):

```tsx
  useEntityHandoff('apidocs', (ref, _intent, payload) => {
    applyContent(String(payload.text ?? ''), (ref.attrs.path ?? '').endsWith('.json') ? 'json' : 'yaml')
    return true
  })
```

Each file imports `useEntityHandoff` from `@/lib/entities/dispatch`.

- [ ] **Step 8: Typecheck, test, commit**

Run: `cd frontend && npx tsc --noEmit -p . && npx vitest run src/components/database src/lib/entities`
Expected: PASS.

```bash
git add frontend/src/components/database frontend/src/components/kafka frontend/src/components/grpc/GrpcPanel.tsx frontend/src/components/soap/SoapPanel.tsx frontend/src/components/apidocs/ApiDocsPanel.tsx
git commit -m "feat(entities): Database, Broker, gRPC, SOAP and API Docs accept entity handoffs"
```

---

### Task 12: Command palette — Project and Symbols groups, Tab actions

**Files:**
- Create: `frontend/src/lib/entities/paletteItems.ts`
- Modify: `frontend/src/components/layout/CommandPalette.tsx`
- Test: `frontend/src/lib/entities/paletteItems.test.ts`

**Interfaces:**
- Consumes: `DevSnapshot`, `entityRefFrom` (Task 9), `actionsFor`, `openEntity` (Task 8), `requestWorkspaceSymbols(sessionId, query)` and `GoIDEWorkspaceSymbol` (`lib/goide-lsp-api.ts`), `fuzzyScore`.
- Produces: `interface EntityPaletteItem { id: string; title: string; subtitle: string; keywords: string; ref: EntityRef }`, `entityPaletteItems(snapshot: DevSnapshot): EntityPaletteItem[]`, `symbolPaletteItems(symbols: GoIDEWorkspaceSymbol[], sessionId: string): EntityPaletteItem[]`, `KIND_LABELS: Record<EntityKind, string>`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { fuzzyScore } from '@/lib/commandPalette'
import { entityPaletteItems, symbolPaletteItems } from './paletteItems'
import type { DevSnapshot } from '../devcontext-api'

const snapshot: DevSnapshot = {
  sessionId: 's1', root: '/p', version: 1, warnings: [], scannedAt: '',
  entities: [
    { id: 'route:POST /payments', kind: 'route', label: 'POST /payments', attrs: { handler: 'createPayment' }, confidence: 'inferred', sources: [{ detector: 'goroutes', file: 'cmd/api/main.go', line: 7 }] },
    { id: 'table:payments', kind: 'table', label: 'payments', attrs: {}, confidence: 'inferred', sources: [{ detector: 'goliterals', file: 'store.go', line: 6 }] },
    { id: 'datasource:postgres@localhost:5432/payments', kind: 'datasource', label: 'postgres@localhost:5432/payments', attrs: { type: 'postgres' }, confidence: 'certain', sources: [{ detector: 'compose', file: 'docker-compose.yml', line: 2 }] },
  ],
}

describe('palette items', () => {
  it('describes kind, origin and confidence', () => {
    const [route, table, db] = entityPaletteItems(snapshot)
    expect(route.subtitle).toBe('Route · cmd/api/main.go:7 · inferred')
    expect(db.subtitle).toBe('Datasource · docker-compose.yml:2')
    expect(route.ref).toMatchObject({ kind: 'route', sessionId: 's1' })
    expect(route.keywords).toContain('createPayment')
    expect(table.id).toBe('entity:table:payments')
  })

  it('makes "payment" find routes, tables and datasources', () => {
    const matches = entityPaletteItems(snapshot).filter((item) => fuzzyScore('payment', `${item.title} ${item.subtitle} ${item.keywords}`) !== null)
    expect(matches).toHaveLength(3)
  })

  it('maps gopls symbols to gO locations', () => {
    const [item] = symbolPaletteItems([{ name: 'createPayment', kind: 12, container: 'api', location: { uri: '', path: '/p/api/h.go', relativePath: 'api/h.go', external: false, range: { startLine: 10, startColumn: 1, endLine: 10, endColumn: 5 } } } as never], 's1')
    expect(item).toMatchObject({ title: 'createPayment', subtitle: 'Symbol · api/h.go:10', ref: { kind: 'symbol', source: { file: 'api/h.go', line: 10 }, sessionId: 's1' } })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/entities/paletteItems.test.ts`
Expected: FAIL — cannot resolve `./paletteItems`.

- [ ] **Step 3: Write `paletteItems.ts`**

```ts
import { entityRefFrom, type DevSnapshot } from '../devcontext-api'
import type { GoIDEWorkspaceSymbol } from '../goide-lsp-api'
import type { EntityKind, EntityRef } from './types'

export interface EntityPaletteItem {
  id: string
  title: string
  subtitle: string
  keywords: string
  ref: EntityRef
}

export const KIND_LABELS: Record<EntityKind, string> = {
  module: 'Module', route: 'Route', service: 'Service', datasource: 'Datasource', envvar: 'Env var',
  contract: 'Contract', table: 'Table', topic: 'Topic', symbol: 'Symbol',
}

export function entityPaletteItems(snapshot: DevSnapshot): EntityPaletteItem[] {
  return (snapshot.entities ?? []).map((entity) => {
    const ref = entityRefFrom(entity, snapshot.sessionId)
    const where = ref.source ? ` · ${ref.source.file}:${ref.source.line}` : ''
    const confidence = entity.confidence === 'inferred' ? ' · inferred' : ''
    return {
      id: `entity:${entity.id}`,
      title: entity.label,
      subtitle: `${KIND_LABELS[entity.kind]}${where}${confidence}`,
      keywords: `${entity.kind} ${KIND_LABELS[entity.kind]} ${Object.values(ref.attrs).join(' ')}`,
      ref,
    }
  })
}

export function symbolPaletteItems(symbols: GoIDEWorkspaceSymbol[], sessionId: string): EntityPaletteItem[] {
  return symbols
    .filter((symbol) => !symbol.location.external && symbol.location.relativePath)
    .map((symbol) => {
      const file = symbol.location.relativePath
      const line = symbol.location.range.startLine
      return {
        id: `symbol:${file}:${line}:${symbol.name}`,
        title: symbol.name,
        subtitle: `Symbol · ${file}:${line}`,
        keywords: `symbol func type ${symbol.container ?? ''}`,
        ref: { kind: 'symbol', id: `symbol:${file}:${line}:${symbol.name}`, label: symbol.name, attrs: {}, source: { file, line }, sessionId },
      }
    })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/entities/paletteItems.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Integrate into `CommandPalette.tsx`**

Imports:

```ts
import { Braces, Database, FileCode, Package, Radio, Route, Table, Variable } from 'lucide-react'
import type { EntityKind, EntityRef } from '@/lib/entities/types'
import { actionsFor, openEntity } from '@/lib/entities/router'
import { entityPaletteItems, symbolPaletteItems, type EntityPaletteItem } from '@/lib/entities/paletteItems'
import { requestWorkspaceSymbols, type GoIDEWorkspaceSymbol } from '@/lib/goide-lsp-api'
import { useDevContextStore } from '@/stores/devcontext'
import { useGoIDEStore } from '@/stores/goide'
```

Add `ref?: EntityRef` to `PaletteCommand`, and a kind→icon map above the component:

```ts
const KIND_ICONS: Record<EntityKind, ElementType> = {
  module: Package, route: Route, service: Server, datasource: Database, envvar: Variable,
  contract: FileCode, table: Table, topic: Radio, symbol: Braces,
}
```

Inside the component, after existing store selectors:

```tsx
  const goSessionId = useGoIDEStore((s) => s.activeSessionId)
  const snapshot = useDevContextStore((s) => (goSessionId ? s.snapshots[goSessionId] : undefined))
  const [symbols, setSymbols] = useState<GoIDEWorkspaceSymbol[]>([])
  const [actionRef, setActionRef] = useState<EntityRef | null>(null)

  useEffect(() => {
    if (open && goSessionId) void useDevContextStore.getState().ensure(goSessionId)
    if (open) setActionRef(null)
  }, [open, goSessionId])

  useEffect(() => {
    if (!open || !goSessionId || query.trim().length < 2) { setSymbols([]); return }
    let request: ReturnType<typeof requestWorkspaceSymbols> | undefined
    const timer = window.setTimeout(() => {
      request = requestWorkspaceSymbols(goSessionId, query.trim())
      request.then(setSymbols, () => setSymbols([])) // language server off → no symbols, no error
    }, 150)
    return () => { window.clearTimeout(timer); request?.cancel() }
  }, [goSessionId, open, query])
```

Inside the `commands` `useMemo`, build and append entity commands (add `snapshot`, `symbols`, `tr` to the deps):

```tsx
    const toCommand = (group: string) => (item: EntityPaletteItem): PaletteCommand => ({
      id: item.id, title: item.title, subtitle: item.subtitle, group, keywords: item.keywords,
      icon: KIND_ICONS[item.ref.kind], ref: item.ref, run: () => void openEntity(item.ref),
    })
    const projectEntries = snapshot ? entityPaletteItems(snapshot).map(toCommand(tr('Project'))) : []
    const symbolEntries = goSessionId ? symbolPaletteItems(symbols, goSessionId).map(toCommand(tr('Symbols'))) : []
```

and return `[...actions, ...deepLinks, ...panels, ...recentRequests, ...collectionEntries, ...environmentEntries, ...projectEntries, ...symbolEntries]`.

Replace `results` so that an open action list takes over:

```tsx
  const results = useMemo(() => {
    if (actionRef) {
      return actionsFor(actionRef).map<PaletteCommand>((opener) => ({
        id: `intent:${opener.intent}`, title: opener.title, subtitle: actionRef.label, group: tr('Actions'),
        keywords: opener.intent, icon: ArrowRight, run: () => void openEntity(actionRef, opener.intent),
      }))
    }
    return commands
      .map((command) => ({ command, score: fuzzyScore(query, `${command.title} ${command.subtitle ?? ''} ${command.keywords}`) }))
      .filter((entry): entry is { command: PaletteCommand; score: number } => entry.score !== null)
      .sort((a, b) => query.trim() ? b.score - a.score : 0)
      .slice(0, 18)
      .map((entry) => entry.command)
  }, [actionRef, commands, query, tr])
```

In `handleKeyDown`, add before the `Enter` branch:

```tsx
    } else if (event.key === 'Tab') {
      event.preventDefault()
      const ref = results[selectedIndex]?.ref
      if (actionRef || event.shiftKey) setActionRef(null)
      else if (ref) { setActionRef(ref); setSelectedIndex(0) }
```

and make `Escape` leave the action list first: `if (event.key === 'Escape') { event.preventDefault(); if (actionRef) setActionRef(null); else onClose() }`.

Render the snapshot warnings and errors under the results list (inside the scroll container, after the map):

```tsx
          {!actionRef && goSessionId && (snapshot?.warnings?.length || contextError) ? (
            <div className="px-3 pb-1 pt-2 text-[10px] text-text-4">
              {tr('Project context')}: {contextError ?? snapshot!.warnings[0]}
              {!contextError && snapshot!.warnings.length > 1 ? ` (+${snapshot!.warnings.length - 1})` : ''}
            </div>
          ) : null}
```

with `const contextError = useDevContextStore((s) => (goSessionId ? s.errors[goSessionId] : undefined))` next to `snapshot`.

Footer: add `<span><kbd className="text-text-3">Tab</kbd> {tr('actions')}</span>` after the Enter hint; update the input placeholder to `tr('Search panels, requests, routes, tables, topics, symbols...')`.

The component will be ~310 lines; that is acceptable (extraction of the entity mapping already lives in `paletteItems.ts`). If it exceeds 330, move `KIND_ICONS` + `toCommand` into `components/layout/paletteEntityCommands.ts`.

- [ ] **Step 6: Typecheck, full test run, build, commit**

Run: `cd frontend && npx tsc --noEmit -p . && npm test && npm run build`
Expected: all Vitest suites PASS, build succeeds.

```bash
git add frontend/src/lib/entities/paletteItems.ts frontend/src/lib/entities/paletteItems.test.ts frontend/src/components/layout/CommandPalette.tsx
git commit -m "feat(palette): Project and Symbols groups with Tab entity actions"
```

---

### Task 13: Docs, manual smoke, final verification

**Files:**
- Modify: `docs/adomnia-feature-catalog.en.md` (new section under G. Platform: "G4. Developer Context & Entity Router"), `docs/ISSUES.md` (status line), `AGENTS.md` (how a panel registers an opener / handoff)

- [ ] **Step 1: Feature catalog entry** — add after the `### G3.` section:

```markdown
### G4. Developer Context & Entity Router

| # | Feature | Description |
|---|-------------|-------------|
| G4.1 | **Project Context** | Opening a folder in gO scans it locally: go.mod modules, `package main` services, docker compose services and datasources (Postgres/MySQL/Mongo/Redis/Kafka/RabbitMQ/NATS), `.env` variables, OpenAPI/proto/WSDL contracts, Go routes (net/http 1.22, gin, echo, chi, gorilla), `os.Getenv`/`env` tags, SQL tables and Kafka/AMQP/NATS topics in string literals. Every item shows its file:line; code-derived items are marked *inferred*. |
| G4.2 | **Live updates** | Saving in gO rescans that file; returning to the window rescans files changed elsewhere. |
| G4.3 | **Secrets stay local** | Secret-looking `.env` values are masked, URL passwords redacted, compose passwords never read. |
| G4.4 | **Palette: Project & Symbols** | Ctrl+K finds routes, tables, topics, services, env vars, contracts and gopls symbols of the active gO project. Enter runs the default action, Tab lists all actions. |
| G4.5 | **Entity actions** | Route → Send in API Client / Go to handler / Add to Mock; service → use as baseUrl (confirm); datasource → Database or Broker Studio (no password copied); contract → API Docs / gRPC / SOAP; table → query; topic → Broker Studio; any item → open source in gO. |
```

- [ ] **Step 2: `AGENTS.md`** — add a short "Entity router" subsection:

```markdown
### Entity router (cross-panel navigation)

New cross-panel actions go through `frontend/src/lib/entities/`, not new `CustomEvent`s:
- register what your panel opens with `registerOpener(kind, { intent, title, run })` in `lib/entities/openers.ts`;
- if the panel must be mounted to act, call `handoffToPanel(rail, ref, intent, payload)` from the opener and receive it in the panel with `useEntityHandoff(rail, handler)` — return `false` while the panel is not ready (e.g. still hydrating) and it is retried.
Project entities come from `internal/devcontext` (Go) via `stores/devcontext.ts`.
```

- [ ] **Step 3: `docs/ISSUES.md`** — add under the active work queue: `- [x] Developer Context P0+P1 (entity router, project context, palette Project/Symbols) — feat/goide-phase3, 2026-09-28. Next: P2 gO code lenses + env resolver.`

- [ ] **Step 4: Full verification**

Run: `go test ./... && go vet ./... && cd frontend && npx tsc --noEmit -p . && npm test && npm run build`
Expected: all green. Record the counts in the commit message body if anything was skipped.

- [ ] **Step 5: Manual smoke in the real app** (`wails3 task dev` if available, otherwise the existing dev workflow) on a real Go project with compose:
  - Open the project in gO → `Ctrl+K` → type `payment` → routes, table, topic, datasource and symbols appear with file:line and *inferred* badges.
  - Enter on a route → API Client tab with `{{baseUrl}}/…`; Tab → "Go to handler" → gO at the handler line.
  - Tab on a route → "Add to Mock Server" → Mock panel shows the endpoint.
  - Enter on the compose Postgres datasource → DB Studio selects a new connection without password; repeat → no duplicate.
  - Enter on a Kafka topic → Broker Studio Kafka tab with the topic filled.
  - Enter on `openapi.yaml` / `.proto` / `.wsdl` → API Docs / gRPC / SOAP load it.
  - Enter on a compose service with a port → notice "Set baseUrl…" → Set → active env has `baseUrl`.
  - Edit a route in gO and save → palette reflects it; edit `.env` outside adOmnia, refocus the window → value updates (masked if secret).
  - In gO, `Ctrl+P` still opens gO Quick Open; `Ctrl+K` opens the global palette.
  - Light and dark theme: notice bar and palette rows use tokens and stay readable.

- [ ] **Step 6: Commit**

```bash
git add docs/adomnia-feature-catalog.en.md docs/ISSUES.md AGENTS.md
git commit -m "docs: Developer Context and entity router"
```
