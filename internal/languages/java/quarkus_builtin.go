package java

import "strings"

// Proprietà di configurazione Quarkus più usate, con tipo e descrizione: sono il minimo per avere
// un completamento utile nei file `application.properties` di un progetto Quarkus, dove non esiste
// un `spring-configuration-metadata.json` da cui leggerle. Fonte: documentazione Quarkus Config.
//
// Sono proposte solo quando il progetto si rivela Quarkus (valori `quarkus.*` o `@ConfigProperty`):
// un progetto Spring non deve essere inondato di chiavi che non lo riguardano.
var quarkusBuiltInProperties = []quarkusBuiltIn{
	{name: "quarkus.application.name", typ: "java.lang.String", description: "The name of the application."},
	{name: "quarkus.application.version", typ: "java.lang.String", description: "The version of the application."},
	{name: "quarkus.http.host", typ: "java.lang.String", description: "The host to bind to.", fallback: "0.0.0.0"},
	{name: "quarkus.http.port", typ: "int", description: "The HTTP port.", fallback: "8080"},
	{name: "quarkus.http.ssl.port", typ: "int", description: "The HTTPS port.", fallback: "8443"},
	{name: "quarkus.http.cors.enabled", typ: "boolean", description: "Enable CORS handling.", fallback: "false"},
	{name: "quarkus.http.cors.origins", typ: "java.lang.String", description: "Origins allowed for CORS."},
	{name: "quarkus.http.auth.basic", typ: "boolean", description: "Enable HTTP basic authentication.", fallback: "false"},
	{name: "quarkus.log.level", typ: "java.util.logging.Level", description: "The root log level.", fallback: "INFO"},
	{name: "quarkus.log.category.\"com.acme\".level", typ: "java.util.logging.Level", description: "Log level of a single category."},
	{name: "quarkus.log.console.enable", typ: "boolean", description: "Enable console logging.", fallback: "true"},
	{name: "quarkus.log.console.level", typ: "java.util.logging.Level", description: "Console log level."},
	{name: "quarkus.log.console.format", typ: "java.lang.String", description: "The console log format."},
	{name: "quarkus.log.file.enable", typ: "boolean", description: "Enable file logging.", fallback: "false"},
	{name: "quarkus.log.file.path", typ: "java.lang.String", description: "The log file path.", fallback: "quarkus.log"},
	{name: "quarkus.datasource.db-kind", typ: "java.lang.String", description: "The datasource kind (postgresql, mysql, h2…)."},
	{name: "quarkus.datasource.username", typ: "java.lang.String", description: "The datasource username."},
	{name: "quarkus.datasource.password", typ: "java.lang.String", description: "The datasource password."},
	{name: "quarkus.datasource.jdbc.url", typ: "java.lang.String", description: "The JDBC URL."},
	{name: "quarkus.datasource.jdbc.max-size", typ: "int", description: "The maximum pool size."},
	{name: "quarkus.datasource.jdbc.min-size", typ: "int", description: "The minimum pool size."},
	{name: "quarkus.hibernate-orm.database.generation", typ: "java.lang.String", description: "Schema generation (none, drop-and-create, update).", fallback: "none"},
	{name: "quarkus.hibernate-orm.log.sql", typ: "boolean", description: "Log the SQL statements.", fallback: "false"},
	{name: "quarkus.http.limits.max-body-size", typ: "java.lang.String", description: "The maximum request body size."},
	{name: "quarkus.package.type", typ: "java.lang.String", description: "The build output type (jar, uber-jar, native).", fallback: "jar"},
	{name: "quarkus.native.enabled", typ: "boolean", description: "Build a native image.", fallback: "false"},
	{name: "quarkus.banner.enabled", typ: "boolean", description: "Show the banner at startup.", fallback: "true"},
	{name: "quarkus.live-reload.instrumentation", typ: "boolean", description: "Enable instrumentation-based live reload.", fallback: "true"},
	{name: "quarkus.args", typ: "java.lang.String", description: "Command line arguments passed to the application."},
	{name: "quarkus.debug.host", typ: "java.lang.String", description: "The debug host.", fallback: "localhost"},
	{name: "quarkus.debug.port", typ: "int", description: "The debug port.", fallback: "5005"},
	{name: "quarkus.debug.suspend", typ: "boolean", description: "Wait for a debugger to attach at startup.", fallback: "false"},
}

// quarkusBuiltIn è la forma compilata della tabella sopra: è la struttura che l'indice pubblica.
type quarkusBuiltIn struct {
	name, typ, description, fallback string
}

func quarkusProperties() []SpringProperty {
	properties := make([]SpringProperty, 0, len(quarkusBuiltInProperties))
	for _, item := range quarkusBuiltInProperties {
		properties = append(properties, SpringProperty{
			Name: item.name, Type: item.typ, Description: item.description,
			Default: item.fallback, Source: SourceBuiltIn, Origin: "Quarkus",
		})
	}
	return properties
}

// looksLikeQuarkus è vero quando il progetto si rivela Quarkus o MicroProfile: scrive proprietà
// `quarkus.*` o legge la configurazione con `@ConfigProperty`.
func looksLikeQuarkus(values []SpringValue, references []SpringPropertyReference) bool {
	for _, value := range values {
		if strings.HasPrefix(value.Key, "quarkus.") {
			return true
		}
	}
	for _, reference := range references {
		if strings.HasPrefix(reference.Key, "quarkus.") || strings.HasPrefix(reference.Key, "mp.") {
			return true
		}
	}
	return false
}
