package goide

import (
	"sort"
	"strings"
)

// PluginContractVersion è la versione del contratto degli eventi Go Studio esposti ai plugin.
// Si incrementa solo con modifiche incompatibili ai nomi degli eventi o ai campi del payload.
const PluginContractVersion = 1

// Eventi Go Studio osservabili dai plugin: sola lettura, consegna asincrona, mai contenuto dei file.
const (
	PluginEventProjectOpen  = "onGoStudioProjectOpen"
	PluginEventProjectClose = "onGoStudioProjectClose"
	PluginEventSave         = "onGoStudioSave"
	PluginEventRunFinished  = "onGoStudioRunFinished"
)

// PluginEvents elenca gli eventi del contratto, nell'ordine in cui compaiono nella documentazione.
var PluginEvents = []string{PluginEventProjectOpen, PluginEventProjectClose, PluginEventSave, PluginEventRunFinished}

// ProjectService è un servizio esterno usato dal progetto, riconosciuto dalle dipendenze dirette in go.mod.
type ProjectService struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Kind    string   `json:"kind"`
	Modules []string `json:"modules"`
}

type serviceSignature struct {
	id, name, kind string
	modules        []string
}

// serviceSignatures usa come ID i preset del Docker Lab, così il passaggio non richiede traduzioni.
var serviceSignatures = []serviceSignature{
	{"postgres", "PostgreSQL", "database", []string{"github.com/lib/pq", "github.com/jackc/pgx", "gorm.io/driver/postgres", "github.com/go-pg/pg", "github.com/uptrace/bun/driver/pgdriver"}},
	{"mysql", "MySQL", "database", []string{"github.com/go-sql-driver/mysql", "gorm.io/driver/mysql"}},
	{"mongodb", "MongoDB", "database", []string{"go.mongodb.org/mongo-driver"}},
	{"redis", "Redis", "cache", []string{"github.com/redis/go-redis", "github.com/go-redis/redis", "github.com/gomodule/redigo"}},
	{"kafka", "Kafka", "messaging", []string{"github.com/segmentio/kafka-go", "github.com/IBM/sarama", "github.com/Shopify/sarama", "github.com/confluentinc/confluent-kafka-go", "github.com/twmb/franz-go"}},
	{"rabbitmq", "RabbitMQ", "messaging", []string{"github.com/rabbitmq/amqp091-go", "github.com/streadway/amqp"}},
	{"otel", "OpenTelemetry", "observability", []string{"go.opentelemetry.io/otel"}},
	{"prometheus", "Prometheus", "observability", []string{"github.com/prometheus/client_golang"}},
}

func modulePrefixMatches(modulePath, prefix string) bool {
	return modulePath == prefix || strings.HasPrefix(modulePath, prefix+"/")
}

// detectProjectServices riconosce i servizi dalle sole dipendenze dirette: quelle indirette sono rumore delle librerie.
func detectProjectServices(dependencies []GoDependency) []ProjectService {
	found := map[string]*ProjectService{}
	for _, dependency := range dependencies {
		if dependency.Indirect {
			continue
		}
		for _, signature := range serviceSignatures {
			if !matchesModulePrefix(dependency.Path, signature.modules) {
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

func matchesModulePrefix(modulePath string, prefixes []string) bool {
	for _, prefix := range prefixes {
		if modulePrefixMatches(modulePath, prefix) {
			return true
		}
	}
	return false
}

// ProjectServices legge i go.mod dei moduli del progetto e restituisce i servizi esterni che usano.
// Un go.mod illeggibile non blocca gli altri moduli: il rilevamento è un suggerimento, non un requisito.
func (s *Service) ProjectServices(sessionID string) ([]ProjectService, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	var dependencies []GoDependency
	for _, module := range goLayoutOf(session.Project).Modules {
		state, err := readDependencyState(session.Project, module.Path)
		if err != nil {
			continue
		}
		dependencies = append(dependencies, state.Dependencies...)
	}
	return detectProjectServices(dependencies), nil
}

// PluginEventFor traduce un evento interno di Go Studio nell'evento del contratto plugin.
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
