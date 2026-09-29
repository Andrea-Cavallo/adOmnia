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
