package java

import (
	"net"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/language"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
)

// datasourcePrefix è il prefisso che Spring Boot usa per il datasource principale. Un datasource
// dichiarato con un prefisso proprio (`@ConfigurationProperties("app.datasource")`) resta fuori:
// qui si legge solo ciò che Spring Boot collega da solo, senza indovinare.
const datasourcePrefix = "spring.datasource."

// datasourceFields sono le chiavi lette sotto il prefisso. La password non è mai un valore del
// risultato: se ne conosce solo la presenza.
var datasourceFields = map[string]bool{
	"url": true, "username": true, "password": true, "driver-class-name": true,
	"host": true, "port": true, "database": true,
}

// jdbcVendors mappa il sottoprotocollo JDBC sul driver del Database Studio. Un vendor assente dalla
// mappa viene comunque mostrato con Driver vuoto: l'utente sa cosa il progetto usa e perché non si
// apre, invece di non vederlo affatto.
var jdbcVendors = map[string]string{
	"postgresql": "postgres", "postgres": "postgres", "pg": "postgres",
	"mysql": "mysql", "mariadb": "mysql",
	"sqlite": "sqlite",
	"db2":    "db2",
}

var jdbcVendorNames = map[string]string{
	"postgresql": "PostgreSQL", "postgres": "PostgreSQL", "pg": "PostgreSQL",
	"mysql": "MySQL", "mariadb": "MariaDB", "sqlite": "SQLite", "db2": "IBM Db2",
	"sqlserver": "Microsoft SQL Server", "oracle": "Oracle", "h2": "H2",
	"hsqldb": "HSQLDB", "derby": "Apache Derby",
}

// ConfiguredDatabases implementa language.ConfiguredDatabases: legge solo i file di configurazione
// Spring dell'unità (mai i sorgenti Java, mai i metadata delle librerie) e restituisce i database
// dichiarati, profilo per profilo. Nessuna connessione, nessun processo, nessun segreto.
func (*Language) ConfiguredDatabases(unit project.Unit) []language.ConfiguredDatabase {
	if unit.Root == "" {
		return nil
	}
	_, configFiles, _ := springSources(unit.Root)
	return datasourcesOf(valuesOf(configFiles), unit.Root)
}

// datasourcesOf deriva i database configurati dai valori Spring. La base (`application.properties`)
// vale per tutti i profili; un profilo (`application-prod.properties`) sovrascrive solo le chiavi
// che dichiara, come fa Spring.
func datasourcesOf(values []SpringValue, root string) []language.ConfiguredDatabase {
	base := map[string]SpringValue{}
	profiles := map[string]map[string]SpringValue{}
	var order []string
	for _, value := range values {
		if !strings.HasPrefix(value.Key, datasourcePrefix) {
			continue
		}
		field := strings.TrimPrefix(value.Key, datasourcePrefix)
		if !datasourceFields[field] {
			continue
		}
		if value.Profile == "" {
			base[field] = value
			continue
		}
		group := profiles[value.Profile]
		if group == nil {
			group = map[string]SpringValue{}
			profiles[value.Profile] = group
			order = append(order, value.Profile)
		}
		group[field] = value
	}
	if len(base) == 0 && len(profiles) == 0 {
		return nil
	}
	sort.Strings(order)

	active := activeProfilesOf(values)
	var result []language.ConfiguredDatabase
	if len(base) > 0 {
		if database, ok := buildDatasource(base, "", active, root); ok {
			result = append(result, database)
		}
	}
	for _, profile := range order {
		merged := make(map[string]SpringValue, len(base)+len(profiles[profile]))
		for field, value := range base {
			merged[field] = value
		}
		for field, value := range profiles[profile] {
			merged[field] = value
		}
		if database, ok := buildDatasource(merged, profile, active, root); ok {
			result = append(result, database)
		}
	}
	return result
}

// activeProfilesOf legge `spring.profiles.active`: è l'unico modo per sapere quale profilo
// descrive la configurazione che il programma userà davvero.
func activeProfilesOf(values []SpringValue) map[string]bool {
	active := map[string]bool{}
	for _, value := range values {
		if value.Key != "spring.profiles.active" {
			continue
		}
		for _, name := range strings.Split(value.Value, ",") {
			if name = strings.TrimSpace(name); name != "" {
				active[name] = true
			}
		}
	}
	return active
}

func profileIsActive(profile string, active map[string]bool) bool {
	if len(active) == 0 {
		return profile == ""
	}
	return active[profile]
}

// buildDatasource traduce un gruppo di chiavi (base o base+profilo) in un database configurato.
// Restituisce false quando le chiavi non descrivono un datasource.
func buildDatasource(fields map[string]SpringValue, profile string, active map[string]bool, root string) (language.ConfiguredDatabase, bool) {
	database := language.ConfiguredDatabase{Profile: profile, Active: profileIsActive(profile, active)}
	var unresolved []string

	value := func(field string) string {
		return strings.TrimSpace(fields[field].Value)
	}

	vendor, host, name, sslMode := "", "", "", ""
	port := 0
	source := fields["url"]
	if source.File == "" {
		source = fields["host"]
	}

	if rawURL := value("url"); rawURL != "" {
		if isPlaceholder(rawURL) {
			unresolved = append(unresolved, "url")
		} else if target, ok := parseJdbcURL(rawURL); ok {
			vendor, host, port, name, sslMode = target.vendor, target.host, target.port, target.database, target.sslMode
		} else {
			unresolved = append(unresolved, "url")
		}
	} else {
		host = value("host")
		if host == "" {
			return database, false
		}
		name = value("database")
		if rawPort := value("port"); rawPort != "" {
			parsed, err := strconv.Atoi(rawPort)
			if err != nil || parsed <= 0 || parsed > 65535 {
				unresolved = append(unresolved, "port")
			} else {
				port = parsed
			}
		}
	}

	if vendor == "" {
		vendor = vendorFromDriverClass(value("driver-class-name"))
	}
	if isPlaceholder(host) {
		unresolved = append(unresolved, "host")
		host = ""
	}
	if isPlaceholder(name) {
		unresolved = append(unresolved, "database")
		name = ""
	}

	user := value("username")
	if isPlaceholder(user) {
		unresolved = append(unresolved, "username")
		user = ""
	}
	// La password non viene mai copiata: se ne registra solo la presenza effettiva.
	passwordConfigured := false
	if password := value("password"); password != "" {
		if isPlaceholder(password) {
			unresolved = append(unresolved, "password")
		} else {
			passwordConfigured = true
		}
	}

	if vendor == "" && !containsString(unresolved, "url") {
		unresolved = append(unresolved, "vendor")
	}
	if vendor == "sqlite" && name != "" && name != ":memory:" && !filepath.IsAbs(name) {
		// Il percorso SQLite è relativo alla cartella del processo, cioè all'unità.
		name = filepath.Join(root, name)
	}
	if vendor != "" && vendor != "sqlite" && name == "" {
		unresolved = append(unresolved, "database")
	}

	database.Vendor = vendor
	database.Driver = jdbcVendors[vendor]
	database.Host = host
	database.Port = port
	database.Database = name
	database.User = user
	database.SSLMode = sslMode
	database.PasswordConfigured = passwordConfigured
	database.Unresolved = dedupeStrings(unresolved)
	database.Name = datasourceName(vendor, name, host, profile)
	if source.File != "" {
		database.File = relativeToRoot(root, source.File)
		database.Line = source.Line
	}
	return database, true
}

// datasourceName compone un nome leggibile e univoco tra profili, così due connessioni dello stesso
// database ma profili diversi non si sovrascrivono nel Database Studio.
func datasourceName(vendor, database, host, profile string) string {
	label := jdbcVendorNames[vendor]
	if label == "" {
		label = "Database"
	}
	target := database
	if target == "" {
		target = host
	}
	name := label
	if target != "" {
		name += " · " + target
	}
	if profile != "" {
		name += " (" + profile + ")"
	}
	return name
}

func isPlaceholder(value string) bool {
	return strings.Contains(value, "${") || strings.Contains(value, "#{")
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func dedupeStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	seen := map[string]bool{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		if seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func relativeToRoot(root, path string) string {
	relative, err := filepath.Rel(root, path)
	if err != nil {
		return filepath.Base(path)
	}
	return filepath.ToSlash(relative)
}

// vendorFromDriverClass riconosce il vendor dalla classe del driver quando l'URL non c'è (Spring
// Boot 3.1 permette host/port/database separati).
func vendorFromDriverClass(className string) string {
	lower := strings.ToLower(className)
	switch {
	case strings.Contains(lower, "mariadb"):
		return "mariadb"
	case strings.Contains(lower, "postgres"):
		return "postgresql"
	case strings.Contains(lower, "mysql"):
		return "mysql"
	case strings.Contains(lower, "sqlserver"):
		return "sqlserver"
	case strings.Contains(lower, "oracle"):
		return "oracle"
	case strings.Contains(lower, "db2"):
		return "db2"
	case strings.Contains(lower, "sqlite"):
		return "sqlite"
	case strings.Contains(lower, "hsqldb"):
		return "hsqldb"
	case strings.Contains(lower, "h2"):
		return "h2"
	case strings.Contains(lower, "derby"):
		return "derby"
	}
	return ""
}

type jdbcTarget struct {
	vendor   string
	host     string
	port     int
	database string
	sslMode  string
}

// parseJdbcURL legge le forme JDBC che Spring Boot accetta per un datasource. Non è un parser
// generale: le forme che non riconosce restano non risolte, senza inventare host o database.
func parseJdbcURL(raw string) (jdbcTarget, bool) {
	trimmed := strings.TrimSpace(raw)
	if !strings.HasPrefix(strings.ToLower(trimmed), "jdbc:") {
		return jdbcTarget{}, false
	}
	rest := trimmed[len("jdbc:"):]
	colon := strings.Index(rest, ":")
	if colon < 0 {
		return jdbcTarget{}, false
	}
	target := jdbcTarget{vendor: strings.ToLower(strings.TrimSpace(rest[:colon]))}
	rest = rest[colon+1:]
	if target.vendor == "" {
		return target, false
	}

	switch target.vendor {
	case "sqlite":
		target.database = strings.TrimPrefix(rest, "//")
		return target, target.database != ""
	case "h2", "hsqldb", "derby":
		// Database in memoria o su file: nessun host da proporre.
		return target, true
	case "sqlserver":
		parts := strings.Split(strings.TrimPrefix(rest, "//"), ";")
		target.host, target.port = splitHostPort(parts[0])
		for _, part := range parts[1:] {
			if key, value, ok := strings.Cut(part, "="); ok && strings.EqualFold(strings.TrimSpace(key), "databaseName") {
				target.database = strings.TrimSpace(value)
			}
		}
		return target, true
	case "oracle":
		if at := strings.LastIndex(rest, "@"); at >= 0 {
			rest = rest[at+1:]
		}
		parts := strings.Split(rest, ":")
		if len(parts) > 0 {
			target.host = parts[0]
		}
		if len(parts) > 1 {
			target.port, _ = strconv.Atoi(parts[1])
		}
		if len(parts) > 2 {
			target.database = parts[len(parts)-1]
		}
		return target, true
	}

	rest = strings.TrimPrefix(rest, "//")
	if cut := strings.Index(rest, "?"); cut >= 0 {
		target.sslMode = sslModeFromQuery(rest[cut+1:])
		rest = rest[:cut]
	}
	if cut := strings.Index(rest, "/"); cut >= 0 {
		target.database = rest[cut+1:]
		rest = rest[:cut]
	}
	target.host, target.port = splitHostPort(rest)
	return target, target.host != ""
}

// splitHostPort separa host e porta anche con IPv6 tra parentesi quadre; senza porta restituisce 0,
// così la UI applica il default del driver invece di inventare un numero.
func splitHostPort(value string) (string, int) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", 0
	}
	if host, port, err := net.SplitHostPort(value); err == nil {
		parsed, _ := strconv.Atoi(port)
		return host, parsed
	}
	return value, 0
}

func sslModeFromQuery(query string) string {
	for _, part := range strings.Split(query, "&") {
		key, value, ok := strings.Cut(part, "=")
		if ok && strings.EqualFold(strings.TrimSpace(key), "sslmode") {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
