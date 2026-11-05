package devcontext

import (
	"encoding/json"
	"sort"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

// datasourcePorts is the default port per vendor, used when a manifest omits it.
var datasourcePorts = map[string]string{
	"postgres": "5432", "mysql": "3306", "mariadb": "3306", "sqlserver": "1433",
	"mongodb": "27017", "sqlite": "",
}

// detectAppSettings reads ASP.NET Core connection strings. Passwords are never read into an
// entity: the connection string itself is not returned, only host/database/user/vendor.
func detectAppSettings(rel string, data []byte) ([]Entity, error) {
	var document struct {
		ConnectionStrings map[string]string `json:"ConnectionStrings"`
	}
	if err := json.Unmarshal(data, &document); err != nil {
		return nil, err
	}
	names := make([]string, 0, len(document.ConnectionStrings))
	for name := range document.ConnectionStrings {
		names = append(names, name)
	}
	sort.Strings(names)
	out := make([]Entity, 0, len(names))
	for _, name := range names {
		if entity, ok := datasourceFromConnectionString(document.ConnectionStrings[name], rel, name); ok {
			out = append(out, entity)
		}
	}
	// Only treat Topic keys as Kafka topics when the document is about Kafka; a generic "Topics"
	// list in another section is not a broker declaration.
	if strings.Contains(strings.ToLower(string(data)), "kafka") {
		var raw map[string]any
		if json.Unmarshal(data, &raw) == nil {
			out = append(out, topicsFromJSON(raw, rel, 1)...)
		}
	}
	return out, nil
}

// topicsFromJSON finds Kafka topic declarations in configuration documents. They are real topic
// names (not code constants), so they are certain when the key is clearly a topic list.
func topicsFromJSON(node any, rel string, line int) []Entity {
	var out []Entity
	seen := map[string]bool{}
	var walk func(value any)
	walk = func(value any) {
		switch typed := value.(type) {
		case map[string]any:
			for key, child := range typed {
				lower := strings.ToLower(key)
				if lower == "topic" || lower == "topics" || strings.HasSuffix(lower, "topics") || strings.HasSuffix(lower, "topic") {
					for _, name := range topicNames(child) {
						if seen[name] {
							continue
						}
						seen[name] = true
						out = append(out, entity("topic", name, name, ConfidenceCertain,
							map[string]string{"broker": "kafka", "declFile": rel, "declLine": strconv.Itoa(line)},
							Source{"appsettings", rel, line}))
					}
				}
				walk(child)
			}
		case []any:
			for _, child := range typed {
				walk(child)
			}
		}
	}
	walk(node)
	return out
}

func topicNames(value any) []string {
	switch typed := value.(type) {
	case string:
		var names []string
		for part := range strings.SplitSeq(typed, ",") {
			if name := strings.TrimSpace(part); name != "" && !strings.Contains(name, "{") && !strings.Contains(name, "$") {
				names = append(names, name)
			}
		}
		return names
	case []any:
		var names []string
		for _, item := range typed {
			names = append(names, topicNames(item)...)
		}
		return names
	default:
		return nil
	}
}

// datasourceFromConnectionString parses the ADO.NET key=value form (Server=â€¦;Database=â€¦;User Id=â€¦)
// and the URL form (mongodb://user@host:port/db).
func datasourceFromConnectionString(value, rel, name string) (Entity, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return Entity{}, false
	}
	src := Source{"appsettings", rel, 1}
	if strings.Contains(value, "://") {
		if entity, ok := datasourceFromValue(name, value, src); ok {
			return entity, true
		}
	}
	parts := map[string]string{}
	for pair := range strings.SplitSeq(value, ";") {
		key, val, ok := strings.Cut(pair, "=")
		if !ok {
			continue
		}
		parts[strings.ToLower(strings.TrimSpace(key))] = strings.TrimSpace(val)
	}
	host := firstNonEmpty(parts["server"], parts["data source"], parts["host"], parts["address"])
	host = strings.TrimPrefix(strings.TrimPrefix(host, "tcp:"), "TCP:")
	port := parts["port"]
	if before, after, found := strings.Cut(host, ","); found {
		host, port = before, after
	}
	if h, p, found := strings.Cut(host, ":"); found && !strings.Contains(host, "\\") {
		host, port = h, firstNonEmpty(port, p)
	}
	if host == "" {
		host = "localhost"
	}
	database := firstNonEmpty(parts["database"], parts["initial catalog"])
	user := firstNonEmpty(parts["user id"], parts["uid"], parts["user"], parts["username"])
	if database == "" {
		return Entity{}, false
	}
	typ := connectionStringVendor(parts, value)
	if port == "" {
		port = datasourcePorts[typ]
	}
	return datasource(typ, host, port, user, database, ConfidenceCertain, src), true
}

func connectionStringVendor(parts map[string]string, value string) string {
	lower := strings.ToLower(value)
	provider := strings.ToLower(parts["provider"])
	switch {
	case strings.Contains(lower, "mongodb"):
		return "mongodb"
	case provider == "npgsql" || strings.Contains(lower, "npgsql") || strings.Contains(lower, "host=") && strings.Contains(lower, "sslmode"):
		return "postgres"
	case provider == "mysql" || strings.Contains(lower, "mariadb") || strings.Contains(lower, "charset=utf8"):
		return "mysql"
	case strings.Contains(lower, "sqlite") || strings.Contains(lower, "data source=file:"):
		return "sqlite"
	default:
		return "sqlserver"
	}
}

// railsDatabase is one environment of Rails config/database.yml.
type railsDatabase struct {
	Adapter  string `yaml:"adapter"`
	Host     string `yaml:"host"`
	Port     int    `yaml:"port"`
	Database string `yaml:"database"`
	Username string `yaml:"username"`
}

// detectRailsDatabase reads config/database.yml. ERB values (`<%= ENV[...] %>`) are skipped: a
// guessed database name would be a fake datasource.
func detectRailsDatabase(rel string, data []byte) ([]Entity, error) {
	var environments map[string]railsDatabase
	if err := yaml.Unmarshal(data, &environments); err != nil {
		return nil, err
	}
	names := make([]string, 0, len(environments))
	for name := range environments {
		names = append(names, name)
	}
	sort.Strings(names)
	out := make([]Entity, 0, len(names))
	for _, name := range names {
		environment := environments[name]
		if environment.Database == "" || strings.Contains(environment.Database, "<%") {
			continue
		}
		typ := railsVendor(environment.Adapter)
		if typ == "" {
			continue
		}
		host := environment.Host
		if host == "" || strings.Contains(host, "<%") {
			host = "localhost"
		}
		port := ""
		if environment.Port > 0 {
			port = strconv.Itoa(environment.Port)
		} else {
			port = datasourcePorts[typ]
		}
		out = append(out, datasource(typ, host, port, environment.Username, environment.Database, ConfidenceCertain, Source{"database.yml", rel, 1}))
	}
	return out, nil
}

func railsVendor(adapter string) string {
	switch strings.ToLower(strings.TrimSpace(adapter)) {
	case "postgresql", "postgis":
		return "postgres"
	case "mysql2", "trilogy":
		return "mysql"
	case "sqlite3":
		return "sqlite"
	case "sqlserver":
		return "sqlserver"
	case "mongodb":
		return "mongodb"
	default:
		return ""
	}
}

// laravelDatasource maps Laravel's separate DB_* keys (no DSN) into one datasource.
func laravelDatasource(entries []dotenvEntry, rel string) (Entity, bool) {
	values := map[string]string{}
	line := 0
	for _, entry := range entries {
		if strings.HasPrefix(entry.Key, "DB_") {
			values[entry.Key] = entry.Value
			if line == 0 || entry.Key == "DB_DATABASE" {
				line = entry.Line
			}
		}
	}
	database := values["DB_DATABASE"]
	if database == "" || strings.Contains(database, "${") {
		return Entity{}, false
	}
	connection := strings.ToLower(strings.TrimSpace(values["DB_CONNECTION"]))
	typ := ""
	switch connection {
	case "mysql", "mariadb":
		typ = "mysql"
	case "pgsql", "postgres", "postgresql":
		typ = "postgres"
	case "sqlite":
		typ = "sqlite"
	case "sqlsrv", "sqlserver":
		typ = "sqlserver"
	case "mongodb":
		typ = "mongodb"
	default:
		return Entity{}, false
	}
	host := values["DB_HOST"]
	if host == "" {
		host = "localhost"
	}
	port := values["DB_PORT"]
	if port == "" {
		port = datasourcePorts[typ]
	}
	return datasource(typ, host, port, values["DB_USERNAME"], database, ConfidenceCertain, Source{"dotenv", rel, line}), true
}
