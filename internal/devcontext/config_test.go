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

func TestDetectDotenvNeverLeaksPasswords(t *testing.T) {
	data := []byte(`QUOTED_URL="postgres://user:pw1@db:5432/app" # local
DB_PASS=pw2
MYSQL_PWD=pw3
MYSQL_ADDR=root:pw4@tcp(127.0.0.1:3306)/app
PG_CONN=host=db password=pw5 dbname=app
ENC_URL=postgres://user:p%zzpw6@db:5432/app
`)
	got, err := detectDotenv(".env", data)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range got {
		for k, v := range e.Attrs {
			for _, pw := range []string{"pw1", "pw2", "pw3", "pw4", "pw5", "pw6"} {
				if strings.Contains(v, pw) {
					t.Errorf("%s attr %s leaks %s: %q", e.ID, k, pw, v)
				}
			}
		}
	}
	if _, ok := byID(got)["datasource:postgres@db:5432/app"]; !ok {
		t.Errorf("quoted DSN with trailing comment must still become a datasource: %+v", byID(got))
	}
}
