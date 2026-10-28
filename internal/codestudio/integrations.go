package codestudio

import (
	"sort"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/language"
)

// PluginContractVersion è la versione del contratto degli eventi Code Studio esposti ai plugin.
// Si incrementa solo con modifiche incompatibili ai nomi degli eventi o ai campi del payload.
const PluginContractVersion = 1

// Eventi Code Studio osservabili dai plugin: sola lettura, consegna asincrona, mai contenuto dei file.
const (
	PluginEventProjectOpen  = "onGoStudioProjectOpen"
	PluginEventProjectClose = "onGoStudioProjectClose"
	PluginEventSave         = "onGoStudioSave"
	PluginEventRunFinished  = "onGoStudioRunFinished"
)

// PluginEvents elenca gli eventi del contratto, nell'ordine in cui compaiono nella documentazione.
var PluginEvents = []string{PluginEventProjectOpen, PluginEventProjectClose, PluginEventSave, PluginEventRunFinished}

// ProjectService è un servizio esterno usato dal progetto, riconosciuto dalle dipendenze dirette di
// un'unità (go.mod, manifest Python…) oppure dalla sua configurazione (Spring `spring.datasource.*`).
type ProjectService struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Kind    string   `json:"kind"`
	Modules []string `json:"modules"`
	// Databases sono i database che la configurazione del progetto dichiara per questo servizio.
	// Contengono i valori noti e la sola presenza di una password, mai il segreto: è l'utente che
	// crea la connessione in Database Studio, dopo aver completato ciò che manca.
	Databases []language.ConfiguredDatabase `json:"databases,omitempty"`
}

type serviceSignature struct {
	id, name, kind string
	modules        []string
}

// serviceSignatures usa come ID i preset del Docker Lab, così il passaggio non richiede traduzioni.
// Ogni voce elenca le dipendenze dirette che la identificano in qualunque ecosistema: percorsi di
// modulo Go e nomi PyPI nella forma normalizzata PEP 503 (minuscolo, trattini). Un nuovo linguaggio
// aggiunge nomi qui, non un secondo rilevatore.
var serviceSignatures = []serviceSignature{
	{"postgres", "PostgreSQL", "database", []string{
		"github.com/lib/pq", "github.com/jackc/pgx", "gorm.io/driver/postgres", "github.com/go-pg/pg", "github.com/uptrace/bun/driver/pgdriver",
		"psycopg", "psycopg2", "psycopg2-binary", "asyncpg",
	}},
	{"mysql", "MySQL", "database", []string{
		"github.com/go-sql-driver/mysql", "gorm.io/driver/mysql",
		"pymysql", "mysqlclient", "aiomysql", "mysql-connector-python",
	}},
	{"mongodb", "MongoDB", "database", []string{
		"go.mongodb.org/mongo-driver",
		"pymongo", "motor",
	}},
	{"redis", "Redis", "cache", []string{
		"github.com/redis/go-redis", "github.com/go-redis/redis", "github.com/gomodule/redigo",
		"redis", "aioredis",
	}},
	{"kafka", "Kafka", "messaging", []string{
		"github.com/segmentio/kafka-go", "github.com/IBM/sarama", "github.com/Shopify/sarama", "github.com/confluentinc/confluent-kafka-go", "github.com/twmb/franz-go",
		"kafka-python", "confluent-kafka", "aiokafka",
	}},
	{"rabbitmq", "RabbitMQ", "messaging", []string{
		"github.com/rabbitmq/amqp091-go", "github.com/streadway/amqp",
		"pika", "aio-pika", "kombu",
	}},
	{"otel", "OpenTelemetry", "observability", []string{
		"go.opentelemetry.io/otel",
		"opentelemetry-sdk", "opentelemetry-api",
	}},
	{"prometheus", "Prometheus", "observability", []string{
		"github.com/prometheus/client_golang",
		"prometheus-client",
	}},
}

func modulePrefixMatches(modulePath, prefix string) bool {
	return modulePath == prefix || strings.HasPrefix(modulePath, prefix+"/")
}

// detectProjectServices riconosce i servizi dalle sole dipendenze dirette: quelle indirette sono rumore delle librerie.
func detectProjectServices(dependencies []ServiceDependency) []ProjectService {
	found := map[string]*ProjectService{}
	for _, dependency := range dependencies {
		if dependency.Indirect {
			continue
		}
		for _, signature := range serviceSignatures {
			if !matchesServiceDependency(dependency.Path, signature.modules) {
				continue
			}
			service := found[signature.id]
			if service == nil {
				service = &ProjectService{ID: signature.id, Name: signature.name, Kind: signature.kind}
				found[signature.id] = service
			}
			service.Modules = append(service.Modules, dependency.Path)
		}
	}
	result := make([]ProjectService, 0, len(found))
	for _, signature := range serviceSignatures {
		if service := found[signature.id]; service != nil {
			sort.Strings(service.Modules)
			result = append(result, *service)
		}
	}
	return result
}

// matchesServiceDependency confronta una dipendenza con le firme: i percorsi di modulo Go si
// confrontano come sono (prefisso su `/`), i nomi di pacchetto senza `/` anche nella forma normale
// PEP 503, così `PyMySQL` e `pymysql` sono lo stesso servizio.
func matchesServiceDependency(path string, prefixes []string) bool {
	if matchesModulePrefix(path, prefixes) {
		return true
	}
	if strings.Contains(path, "/") {
		return false
	}
	return matchesModulePrefix(serviceDependencyName(path), prefixes)
}

// ServiceDependency è una dipendenza diretta di un'unità, in qualunque ecosistema.
type ServiceDependency struct {
	// Path è il nome nella forma dell'ecosistema (percorso di modulo, nome PyPI).
	Path string
	// Indirect è vero per una dipendenza trascinata da un'altra: non identifica un servizio.
	Indirect bool
}

// serviceDependencyName normalizza il nome per il confronto: minuscolo e `.`/`_` come `-`, la forma
// in cui PyPI tratta i nomi. I percorsi di modulo Go non cambiano (sono già minuscoli e con `/`).
func serviceDependencyName(name string) string {
	normalized := strings.ToLower(strings.TrimSpace(name))
	normalized = strings.ReplaceAll(normalized, "_", "-")
	return strings.ReplaceAll(normalized, ".", "-")
}

func matchesModulePrefix(modulePath string, prefixes []string) bool {
	for _, prefix := range prefixes {
		if modulePrefixMatches(modulePath, prefix) {
			return true
		}
	}
	return false
}

// ProjectServices legge le dipendenze dirette delle unità del progetto (go.mod per Go, manifest
// Python per Python) e i database che la loro configurazione dichiara, restituendo i servizi esterni
// che usano: ogni adapter sa leggere il proprio manifest e la propria configurazione, qui non c'è
// codice per linguaggio. Un manifest illeggibile non blocca gli altri moduli: il rilevamento è un
// suggerimento, non un requisito.
func (s *Service) ProjectServices(sessionID string) ([]ProjectService, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	var dependencies []ServiceDependency
	var databases []language.ConfiguredDatabase
	for _, module := range goLayoutOf(session.Project).Modules {
		state, err := readDependencyState(session.Project, module.Path)
		if err != nil {
			continue
		}
		for _, dependency := range state.Dependencies {
			dependencies = append(dependencies, ServiceDependency{Path: dependency.Path, Indirect: dependency.Indirect})
		}
	}
	for _, unit := range session.Project.Units {
		adapter, ok := s.workspace.languages.Get(unit.Language)
		if !ok {
			continue
		}
		if reader, ok := adapter.(language.DirectDependencies); ok {
			for _, path := range reader.DirectDependencies(unit) {
				dependencies = append(dependencies, ServiceDependency{Path: path})
			}
		}
		if reader, ok := adapter.(language.ConfiguredDatabases); ok {
			databases = append(databases, reader.ConfiguredDatabases(unit)...)
		}
	}
	return attachConfiguredDatabases(detectProjectServices(dependencies), databases), nil
}

// attachConfiguredDatabases unisce i database configurati ai servizi riconosciuti dalle dipendenze:
// lo stesso driver non compare due volte, e un database senza dipendenza riconosciuta diventa una
// riga propria. Un vendor che Database Studio non sa aprire resta visibile con il suo nome e senza
// driver, così l'utente sa cosa il progetto usa e perché non si apre.
func attachConfiguredDatabases(services []ProjectService, databases []language.ConfiguredDatabase) []ProjectService {
	if len(databases) == 0 {
		return services
	}
	rows := map[string]int{}
	for index := range services {
		if _, exists := rows[services[index].ID]; !exists {
			rows[services[index].ID] = index
		}
	}
	for _, database := range databases {
		id := database.Driver
		if id == "" {
			id = database.Vendor
		}
		if id == "" {
			continue
		}
		if index, exists := rows[id]; exists && services[index].Kind == "database" {
			services[index].Databases = append(services[index].Databases, database)
			continue
		}
		services = append(services, ProjectService{
			ID:        id,
			Name:      databaseServiceLabel(id, database),
			Kind:      "database",
			Databases: []language.ConfiguredDatabase{database},
		})
		rows[id] = len(services) - 1
	}
	return services
}

// databaseServiceLabel usa il nome noto del servizio; per un vendor senza firma il nome del
// datasource è già descrittivo.
func databaseServiceLabel(id string, database language.ConfiguredDatabase) string {
	for _, signature := range serviceSignatures {
		if signature.id == id {
			return signature.name
		}
	}
	return database.Name
}

// PluginEventFor traduce un evento interno di Code Studio nell'evento del contratto plugin.
// Restituisce false per gli eventi non esposti; i payload non contengono mai il testo dei file.
func PluginEventFor(event EventEnvelope) (string, map[string]any, bool) {
	payload := map[string]any{"contract": PluginContractVersion, "sessionId": string(event.SessionID)}
	switch event.Type {
	case "session.opened":
		session, ok := event.Payload.(Session)
		if !ok {
			return "", nil, false
		}
		payload["projectName"] = session.Project.Name
		payload["rootPath"] = session.Project.RootPath
		return PluginEventProjectOpen, payload, true
	case "session.closed":
		return PluginEventProjectClose, payload, true
	case "document.saved":
		document, ok := event.Payload.(Document)
		if !ok || document.External {
			return "", nil, false
		}
		payload["relativePath"] = document.RelativePath
		payload["language"] = document.Language
		return PluginEventSave, payload, true
	case "run.finished":
		execution, ok := event.Payload.(Execution)
		if !ok {
			return "", nil, false
		}
		payload["sessionId"] = string(execution.SessionID)
		payload["kind"] = execution.Kind
		payload["status"] = execution.Status
		payload["command"] = execution.Command
		payload["durationMillis"] = execution.DurationMillis
		if execution.ExitCode != nil {
			payload["exitCode"] = *execution.ExitCode
		}
		return PluginEventRunFinished, payload, true
	default:
		return "", nil, false
	}
}
