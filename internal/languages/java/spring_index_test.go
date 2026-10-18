package java

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

const mailPropertiesJava = `package com.acme.demo;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** Configurazione del servizio mail. */
@ConfigurationProperties(prefix = "acme.mail")
public class MailProperties {
    private String host = "localhost";
    private int port;
    private boolean useTls;

    public void setHost(String host) {
        this.host = host;
    }
}
`

const orderControllerJava = `package com.acme.demo;

@RestController
@RequestMapping("/api/orders")
public class OrderController {

    @Autowired(required = false)
    private OrderService service;

    @Value("${acme.mail.port:25}")
    private int fallbackPort;

    @GetMapping(value = "/{id}", produces = "application/json")
    public Order find(@PathVariable Long id) {
        return null;
    }

    @PostMapping
    public void create(@RequestBody Order order) {
    }
}
`

const orderServiceJava = `package com.acme.demo;

@Service("orderService")
public class OrderService {

    private final MailProperties properties;

    public OrderService(MailProperties properties, @Qualifier("cache") Cache cache) {
        this.properties = properties;
    }

    public String describe(String prefix) {
        return prefix + properties.getHost();
    }
}
`

func TestParseJavaSourceFindsTypesAndMembers(t *testing.T) {
	source := parseJavaSource([]byte(orderServiceJava))
	if source.Package != "com.acme.demo" {
		t.Fatalf("package: %q", source.Package)
	}
	if len(source.Types) != 1 || source.Types[0].Name != "com.acme.demo.OrderService" || source.Types[0].Kind != "class" {
		t.Fatalf("types: %+v", source.Types)
	}
	var fields, methods, constructors int
	for _, member := range source.Members {
		if member.Class != "com.acme.demo.OrderService" {
			t.Fatalf("member owner: %+v", member)
		}
		switch member.Kind {
		case "field":
			fields++
		case "method":
			methods++
			if member.Name != "describe" || len(member.Params) != 1 || member.Params[0].Name != "prefix" {
				t.Fatalf("method: %+v", member)
			}
		case "constructor":
			constructors++
			if len(member.Params) != 2 || member.Params[1].Name != "cache" {
				t.Fatalf("constructor params: %+v", member.Params)
			}
		}
	}
	if fields != 1 || methods != 1 || constructors != 1 {
		t.Fatalf("fields=%d methods=%d constructors=%d", fields, methods, constructors)
	}
}

func TestParseJavaSourceRecognizesControllers(t *testing.T) {
	source := parseJavaSource([]byte(orderControllerJava))
	t.Logf("types=%+v", source.Types)
	for _, member := range source.Members {
		t.Logf("member=%+v", member)
	}
	if len(source.Types) != 1 || source.Types[0].Name != "com.acme.demo.OrderController" {
		t.Fatalf("types: %+v", source.Types)
	}
}

func TestBeansInjectionsAndEndpoints(t *testing.T) {
	sources := []javaSource{
		parseJavaSource([]byte(orderControllerJava)),
		parseJavaSource([]byte(orderServiceJava)),
	}

	beans := beansOf(sources)
	if len(beans) != 2 {
		t.Fatalf("beans: %+v", beans)
	}
	if beans[0].Name != "orderController" || beans[0].Kind != "controller" {
		t.Fatalf("controller bean: %+v", beans[0])
	}
	if beans[1].Name != "orderService" || beans[1].Kind != "service" {
		t.Fatalf("service bean: %+v", beans[1])
	}

	injections := injectionsOf(sources)
	if len(injections) != 3 {
		t.Fatalf("injections: %+v", injections)
	}
	if injections[0].Kind != "field" || injections[0].Name != "service" || injections[0].Required {
		t.Fatalf("field injection: %+v", injections[0])
	}
	if injections[1].Name != "properties" || injections[2].Qualifier != "cache" {
		t.Fatalf("constructor injections: %+v", injections[1:])
	}

	endpoints := endpointsOf(sources)
	if len(endpoints) != 2 {
		t.Fatalf("endpoints: %+v", endpoints)
	}
	if endpoints[0].Method != "GET" || endpoints[0].Path != "/api/orders/{id}" || endpoints[0].Member != "find" {
		t.Fatalf("GET endpoint: %+v", endpoints[0])
	}
	if endpoints[0].Produces != "application/json" {
		t.Fatalf("produces: %+v", endpoints[0])
	}
	if endpoints[1].Method != "POST" || endpoints[1].Path != "/api/orders" {
		t.Fatalf("POST endpoint: %+v", endpoints[1])
	}
}

func TestProjectPropertiesFromConfigurationProperties(t *testing.T) {
	source := parseJavaSource([]byte(mailPropertiesJava))
	source.File = "src/main/java/com/acme/demo/MailProperties.java"
	properties := projectProperties(source)
	if len(properties) != 3 {
		t.Fatalf("properties: %+v", properties)
	}
	byName := map[string]SpringProperty{}
	for _, property := range properties {
		byName[property.Name] = property
	}
	for _, name := range []string{"acme.mail.host", "acme.mail.port", "acme.mail.use-tls"} {
		property, ok := byName[name]
		if !ok {
			t.Fatalf("missing %s in %+v", name, properties)
		}
		if property.Source != SourceProject || property.File == "" || property.Line == 0 {
			t.Fatalf("property without location: %+v", property)
		}
	}
	if byName["acme.mail.use-tls"].Type != "boolean" {
		t.Fatalf("type: %+v", byName["acme.mail.use-tls"])
	}
}

func TestPropertyReferencesCarryDefault(t *testing.T) {
	references := propertyReferencesOf([]javaSource{parseJavaSource([]byte(orderControllerJava))})
	if len(references) != 1 {
		t.Fatalf("references: %+v", references)
	}
	reference := references[0]
	if reference.Key != "acme.mail.port" || reference.Default != "25" {
		t.Fatalf("reference: %+v", reference)
	}
	if reference.Member != "fallbackPort" || reference.Line == 0 {
		t.Fatalf("reference location: %+v", reference)
	}
}

func TestKebabCaseFollowsSpringRules(t *testing.T) {
	cases := map[string]string{
		"host":    "host",
		"useTls":  "use-tls",
		"useTLS":  "use-tls",
		"URLPath": "url-path",
		"port2":   "port2",
	}
	for input, want := range cases {
		if got := kebabCase(input); got != want {
			t.Fatalf("kebabCase(%q)=%q want %q", input, got, want)
		}
	}
}

func TestAnnotationArgumentsAreParsed(t *testing.T) {
	annotation := parseJavaAnnotation(`@GetMapping(value = "/{id}", produces = "application/json")`, 1, 1, 2)
	if annotation.Name != "GetMapping" {
		t.Fatalf("name: %+v", annotation)
	}
	if annotationPath(annotation.Args) != "/{id}" {
		t.Fatalf("path: %q", annotation.Args)
	}
	if annotationString(annotation.Args, "produces") != "application/json" {
		t.Fatalf("produces: %q", annotation.Args)
	}
	if got := annotationString(parseJavaAnnotation(`@RequestMapping("/api/orders")`, 1, 1, 2).Args, "value"); got != "/api/orders" {
		t.Fatalf("implicit value: %q", got)
	}
	if got := annotationString(parseJavaAnnotation(`@RequestMapping(method = RequestMethod.GET)`, 1, 1, 2).Args, "method"); got != "RequestMethod.GET" {
		t.Fatalf("identifier value: %q", got)
	}
}

// isolateMetadataCache rende deterministici i test che toccano la cache dei metadata.
// La cartella va fissata una volta: ogni `t.TempDir()` ne restituirebbe una diversa.
func isolateMetadataCache(t *testing.T) {
	t.Helper()
	previous := osCacheDir
	root := t.TempDir()
	osCacheDir = func() (string, error) { return root, nil }
	metadataOnce = sync.Once{}
	metadataIndex = nil
	setMetadataState(MetadataIdle)
	t.Cleanup(func() {
		osCacheDir = previous
		metadataOnce = sync.Once{}
		metadataIndex = nil
		setMetadataState(MetadataIdle)
	})
}

// writeProject scrive su disco un progetto Spring minimo ma realistico.
func writeProject(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	files := map[string]string{
		"src/main/java/com/acme/demo/MailProperties.java":   mailPropertiesJava,
		"src/main/java/com/acme/demo/OrderController.java": orderControllerJava,
		"src/main/java/com/acme/demo/OrderService.java":    orderServiceJava,
		"src/main/resources/application.properties":         "server.port=8080\nacme.mail.host=smtp.acme.io\n",
		"src/main/resources/application-prod.properties":    "server.port=80\nacme.mail.host=smtp-prod.acme.io\n",
		"src/main/resources/application.yml":                "spring:\n  application:\n    name: orders\n",
	}
	for relative, content := range files {
		path := filepath.Join(root, filepath.FromSlash(relative))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func TestBuildSpringIndexReadsTheWholeProject(t *testing.T) {
	isolateMetadataCache(t)
	index := BuildSpringIndex(writeProject(t))

	if index.Status != "ready" {
		t.Fatalf("status: %+v", index)
	}
	if len(index.Properties) != 3 {
		t.Fatalf("properties: %+v", index.Properties)
	}
	if len(index.Beans) != 2 || len(index.Endpoints) != 2 || len(index.Injections) != 3 {
		t.Fatalf("beans=%d endpoints=%d injections=%d", len(index.Beans), len(index.Endpoints), len(index.Injections))
	}
	if len(index.PropertyReferences) != 1 || index.PropertyReferences[0].Key != "acme.mail.port" {
		t.Fatalf("references: %+v", index.PropertyReferences)
	}
	if len(index.Values) != 5 {
		t.Fatalf("values: %+v", index.Values)
	}
	if index.ServerPort != "80" {
		t.Fatalf("serverPort must follow the active profile: %+v", index.Values)
	}
	for _, value := range index.Values {
		if strings.HasPrefix(value.Key, "spring.application") && value.Profile != "" {
			t.Fatalf("yaml value without profile: %+v", value)
		}
	}
}

func TestValuesReportProfileOverrides(t *testing.T) {
	isolateMetadataCache(t)
	index := BuildSpringIndex(writeProject(t))
	byKey := map[string][]SpringValue{}
	for _, value := range index.Values {
		byKey[value.Key] = append(byKey[value.Key], value)
	}
	hosts := byKey["acme.mail.host"]
	if len(hosts) != 2 {
		t.Fatalf("hosts: %+v", hosts)
	}
	for _, host := range hosts {
		if host.Profile == "prod" && !host.OverridesBase {
			t.Fatalf("the profile must be flagged as an override: %+v", host)
		}
		if host.Profile == "" && host.OverridesBase {
			t.Fatalf("the base value is not an override: %+v", host)
		}
	}
}

func TestDiagnosticsFlagUnknownKeysOnlyWhenMetadataIsKnown(t *testing.T) {
	known := map[string]SpringProperty{"server.port": {Name: "server.port"}}
	references := []SpringPropertyReference{{Key: "acme.unknown", File: "A.java", Line: 3}}
	values := []SpringValue{{Key: "server.port", Value: "8080"}, {Key: "acme.ghost", Value: "x", Line: 2}}
	found := diagnosticsOf(references, values, known)
	if len(found) != 2 {
		t.Fatalf("diagnostics: %+v", found)
	}
	if found[0].Key != "acme.unknown" || found[1].Key != "acme.ghost" {
		t.Fatalf("diagnostics: %+v", found)
	}
	// Senza nessuna proprietà nota non si accusa nulla: non sarebbe onesto.
	if empty := diagnosticsOf(references, values, map[string]SpringProperty{}); len(empty) != 0 {
		t.Fatalf("no metadata, no diagnostics: %+v", empty)
	}
}
