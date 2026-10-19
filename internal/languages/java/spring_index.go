package java

import (
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Limiti della scansione: l'indice Spring è statico e non deve mai bloccare l'apertura del progetto.
const (
	maxSpringFiles   = 4_000
	maxSpringFileKB  = 512
	maxSpringConfigs = 64
)

// Fonte di una proprietà di configurazione: dice da dove arriva e cosa si può navigare.
const (
	SourceMetadata = "metadata" // spring-configuration-metadata.json di una libreria
	SourceProject  = "project"  // classe @ConfigurationProperties del progetto
	SourceBuiltIn  = "builtIn"  // proprietà nota senza dichiarazione navigabile
)

// SpringProperty è una chiave di configurazione nota con tipo, descrizione e default.
type SpringProperty struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	Description string `json:"description"`
	Default     string `json:"default,omitempty"`
	Deprecated  bool   `json:"deprecated,omitempty"`
	Source      string `json:"source"`
	// Origin è il jar o la classe che la dichiara (per il tooltip).
	Origin string `json:"origin,omitempty"`
	// Posizione della dichiarazione Java, navigabile solo per Source == project.
	File        string `json:"file,omitempty"`
	Line        int    `json:"line,omitempty"`
	StartColumn int    `json:"startColumn,omitempty"`
	EndColumn   int    `json:"endColumn,omitempty"`
}

// SpringValue è un valore scritto in application.properties/.yml, con il profilo a cui appartiene.
type SpringValue struct {
	Key   string `json:"key"`
	Value string `json:"value"`
	// Profile è il profilo del file (`application-prod.properties` → "prod"); vuoto per la base.
	Profile string `json:"profile,omitempty"`
	// OverridesBase è vero quando il profolo ridefinisce la stessa chiave della configurazione base.
	OverridesBase bool   `json:"overridesBase,omitempty"`
	File          string `json:"file,omitempty"`
	Line          int    `json:"line,omitempty"`
	StartColumn   int    `json:"startColumn,omitempty"`
	EndColumn     int    `json:"endColumn,omitempty"`
}

// SpringPropertyReference è un `@Value("${…}")` nel codice Java.
type SpringPropertyReference struct {
	Expression  string `json:"expression"`
	Key         string `json:"key"`
	Default     string `json:"default,omitempty"`
	Class       string `json:"class,omitempty"`
	Member      string `json:"member,omitempty"`
	File        string `json:"file,omitempty"`
	Line        int    `json:"line,omitempty"`
	StartColumn int    `json:"startColumn,omitempty"`
	EndColumn   int    `json:"endColumn,omitempty"`
}

// SpringDiagnostic è un problema di configurazione trovato senza eseguire il progetto.
type SpringDiagnostic struct {
	Severity    string `json:"severity"` // "error" | "warning" | "info"
	Message     string `json:"message"`
	Key         string `json:"key,omitempty"`
	File        string `json:"file,omitempty"`
	Line        int    `json:"line,omitempty"`
	StartColumn int    `json:"startColumn,omitempty"`
	EndColumn   int    `json:"endColumn,omitempty"`
}

// SpringBean è un bean dichiarato nel progetto (stereotype o metodo @Bean).
type SpringBean struct {
	Name       string   `json:"name"`
	Type       string   `json:"type"`
	Kind       string   `json:"kind"` // "component" | "service" | "repository" | "controller" | "configuration" | "bean"
	Scope      string   `json:"scope,omitempty"`
	Qualifiers []string `json:"qualifiers,omitempty"`
	Class      string   `json:"class,omitempty"`
	// Supertypes: interfacce e superclasse del bean, per risolvere le iniezioni per interfaccia.
	Supertypes  []string `json:"supertypes,omitempty"`
	Member      string   `json:"member,omitempty"`
	File        string   `json:"file,omitempty"`
	Line        int      `json:"line,omitempty"`
	StartColumn int      `json:"startColumn,omitempty"`
	EndColumn   int      `json:"endColumn,omitempty"`
}

// SpringInjection è un punto di iniezione (`@Autowired`/`@Inject`, campo, costruttore o setter).
type SpringInjection struct {
	Kind        string `json:"kind"` // "field" | "constructor" | "setter" | "parameter"
	Type        string `json:"type"`
	Name        string `json:"name,omitempty"`
	Qualifier   string `json:"qualifier,omitempty"`
	Required    bool   `json:"required"`
	Class       string `json:"class,omitempty"`
	File        string `json:"file,omitempty"`
	Line        int    `json:"line,omitempty"`
	StartColumn int    `json:"startColumn,omitempty"`
	EndColumn   int    `json:"endColumn,omitempty"`
}

// SpringEndpoint è un endpoint HTTP MVC (classe + metodo).
type SpringEndpoint struct {
	Method      string `json:"method"` // "GET", "POST", …
	Path        string `json:"path"`
	Class       string `json:"class"`
	Member      string `json:"member"`
	Produces    string `json:"produces,omitempty"`
	Consumes    string `json:"consumes,omitempty"`
	File        string `json:"file,omitempty"`
	Line        int    `json:"line,omitempty"`
	StartColumn int    `json:"startColumn,omitempty"`
	EndColumn   int    `json:"endColumn,omitempty"`
}

// SpringIndex è tutto ciò che si sa di un progetto Spring senza eseguirlo.
type SpringIndex struct {
	// Stato dell'indice: "ready" quando la scansione del progetto è completa; "partial" quando i
	// limiti hanno interrotto la lettura; "stale" quando la cache dei metadata non è aggiornata.
	Status             string                    `json:"status"`
	Properties         []SpringProperty          `json:"properties"`
	Values             []SpringValue             `json:"values"`
	PropertyReferences []SpringPropertyReference `json:"propertyReferences"`
	Diagnostics        []SpringDiagnostic        `json:"diagnostics"`
	Beans              []SpringBean              `json:"beans"`
	Injections         []SpringInjection         `json:"injections"`
	Endpoints          []SpringEndpoint          `json:"endpoints"`
	// ServerPort è `server.port` effettivo (profilo più specifico che vince).
	ServerPort string `json:"serverPort,omitempty"`
	// MetadataState descrive lo scan degli jar: "ready", "idle", "scanning".
	MetadataState string `json:"metadataState"`
	// Skipped è il numero di file saltati per dimensione o per limite.
	Skipped int `json:"skipped,omitempty"`
}

// BuildSpringIndex costruisce l'indice Spring di un progetto leggendo solo il filesystem:
// nessun server, nessuna rete, nessuna esecuzione del progetto.
func BuildSpringIndex(projectRoot string) SpringIndex {
	index := SpringIndex{Status: "ready", MetadataState: metadataStateOf()}
	javaFiles, configFiles, skipped := springSources(projectRoot)
	index.Skipped = skipped

	var parsed []javaSource
	for _, path := range javaFiles {
		if source, ok := readJavaSource(path, projectRoot); ok {
			parsed = append(parsed, source)
		}
	}

	known := map[string]SpringProperty{}
	for _, property := range loadMetadataProperties() {
		if _, exists := known[property.Name]; !exists {
			known[property.Name] = property
			index.Properties = append(index.Properties, property)
		}
	}
	for _, source := range parsed {
		for _, property := range projectProperties(source) {
			if _, exists := known[property.Name]; !exists {
				known[property.Name] = property
				index.Properties = append(index.Properties, property)
			}
		}
	}

	index.PropertyReferences = propertyReferencesOf(parsed)
	index.Beans = beansOf(parsed)
	index.Injections = injectionsOf(parsed, index.Beans)
	index.Endpoints = endpointsOf(parsed)
	index.Values = valuesOf(configFiles)
	index.ServerPort = serverPortOf(index.Values)

	// Le proprietà `quarkus.*` note entrano solo nei progetti Quarkus: un progetto Spring non deve
	// vedere chiavi che non lo riguardano. Il segnale è un valore `quarkus.` scritto o un
	// `@ConfigProperty`, il modo in cui MicroProfile legge la configurazione.
	if looksLikeQuarkus(index.Values, index.PropertyReferences) {
		for _, property := range quarkusProperties() {
			if _, exists := known[property.Name]; !exists {
				known[property.Name] = property
				index.Properties = append(index.Properties, property)
			}
		}
	}
	index.Diagnostics = diagnosticsOf(index.PropertyReferences, index.Values, known)
	sort.SliceStable(index.Properties, func(i, j int) bool { return index.Properties[i].Name < index.Properties[j].Name })
	return index
}

// springSources elenca i sorgenti Java e i file di configurazione Spring del progetto.
// Restituisce anche il numero di file saltati per i limiti della scansione.
func springSources(projectRoot string) (javaFiles, configFiles []string, skipped int) {
	scanned := 0
	_ = filepath.WalkDir(projectRoot, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			if path != projectRoot && (ignoredDirectory(entry.Name()) || depth(projectRoot, path) > maxScanDepth+6) {
				return filepath.SkipDir
			}
			return nil
		}
		if scanned++; scanned > maxSpringFiles {
			skipped++
			return filepath.SkipAll
		}
		name := entry.Name()
		switch {
		case strings.HasSuffix(name, ".java") && inSpringSources(path):
			info, err := entry.Info()
			if err != nil || info.Size() > maxSpringFileKB<<10 {
				skipped++
				return nil
			}
			javaFiles = append(javaFiles, path)
		case isSpringConfigFile(name) && inSpringResources(path):
			if len(configFiles) >= maxSpringConfigs {
				skipped++
				return nil
			}
			configFiles = append(configFiles, path)
		}
		return nil
	})
	sort.Strings(javaFiles)
	sort.Strings(configFiles)
	return javaFiles, configFiles, skipped
}

// inSpringSources è true per i sorgenti Java/Kotlin di main e test: è lì che vivono bean e controller.
func inSpringSources(path string) bool {
	slashed := filepath.ToSlash(path)
	return strings.Contains(slashed, "/src/main/java/") || strings.Contains(slashed, "/src/test/java/") ||
		strings.Contains(slashed, "/src/main/kotlin/") || strings.Contains(slashed, "/src/test/kotlin/")
}

// inSpringResources è true per le cartelle di risorse, dove Spring legge la configurazione.
func inSpringResources(path string) bool {
	slashed := filepath.ToSlash(path)
	return strings.Contains(slashed, "/src/main/resources/") || strings.Contains(slashed, "/src/test/resources/") ||
		strings.Contains(slashed, "/src/main/resources") || strings.HasSuffix(slashed, "/config")
}

// isSpringConfigFile riconosce application.properties, application.yml e i loro profili.
func isSpringConfigFile(name string) bool {
	lower := strings.ToLower(name)
	for _, suffix := range []string{".properties", ".yml", ".yaml"} {
		if strings.HasSuffix(lower, suffix) {
			return strings.TrimSuffix(lower, suffix) == "application" || strings.HasPrefix(strings.TrimSuffix(lower, suffix), "application-")
		}
	}
	return false
}

// profileOf estrae il profilo dal nome del file: `application-prod.yml` → "prod", `application` → "".
func profileOf(name string) string {
	lower := strings.ToLower(name)
	for _, suffix := range []string{".properties", ".yml", ".yaml"} {
		if !strings.HasSuffix(lower, suffix) {
			continue
		}
		stem := strings.TrimSuffix(lower, suffix)
		if stem == "application" {
			return ""
		}
		return strings.TrimPrefix(stem, "application-")
	}
	return ""
}

// serverPortOf è la porta effettiva: il valore del profilo più specifico vince sulla base.
// Spring scrive `server.port`, Quarkus `quarkus.http.port`: si guardano entrambe.
func serverPortOf(values []SpringValue) string {
	port, base := "", ""
	for _, value := range values {
		if value.Key != "server.port" && value.Key != "quarkus.http.port" {
			continue
		}
		if value.Profile != "" {
			port = value.Value
		} else if base == "" {
			base = value.Value
		}
	}
	if port != "" {
		return port
	}
	return base
}

// diagnosticsOf segnala ciò che non torna tra codice e configurazione: un `@Value` senza una chiave
// nota e una chiave scritta che nessuna libreria o classe dichiara. Sono indizi, non errori di build.
func diagnosticsOf(references []SpringPropertyReference, values []SpringValue, known map[string]SpringProperty) []SpringDiagnostic {
	var found []SpringDiagnostic
	for _, reference := range references {
		if reference.Key == "" {
			continue
		}
		if _, ok := known[reference.Key]; !ok && len(known) > 0 {
			found = append(found, SpringDiagnostic{
				Severity: "info", Key: reference.Key, File: reference.File,
				Line: reference.Line, StartColumn: reference.StartColumn, EndColumn: reference.EndColumn,
				Message: "No configuration metadata declares `" + reference.Key + "`",
			})
		}
	}
	for _, value := range values {
		if value.Key == "" {
			continue
		}
		if _, ok := known[value.Key]; !ok && len(known) > 0 {
			found = append(found, SpringDiagnostic{
				Severity: "info", Key: value.Key, File: value.File,
				Line: value.Line, StartColumn: value.StartColumn, EndColumn: value.EndColumn,
				Message: "Unknown configuration key `" + value.Key + "`",
			})
		}
	}
	return found
}

// depth è il numero di livelli tra root e path (definita in detect.go).

// osHomeDir è la home dell'utente: separato per i test.
var osHomeDir = os.UserHomeDir
