package java

import "testing"

func TestQuarkusBuiltInPropertiesReachTheIndex(t *testing.T) {
	// Un progetto Quarkus si rivela per i valori `quarkus.*` o per gli `@ConfigProperty`.
	index := BuildSpringIndex(writeProject(t))
	if looksLikeQuarkus(index.Values, index.PropertyReferences) {
		t.Fatalf("the Spring fixture must not look like Quarkus: %+v", index.Values)
	}
	for _, property := range index.Properties {
		if property.Source == SourceBuiltIn {
			t.Fatalf("a Spring project must not carry Quarkus built-ins: %+v", property)
		}
	}

	quarkus := map[string]string{
		"src/main/resources/application.properties":      "quarkus.http.port=8081\nquarkus.application.name=friut\n",
		"src/main/java/com/acme/demo/FruitResource.java": fruitResourceJava,
	}
	root := t.TempDir()
	writeFiles(t, root, quarkus)
	index = BuildSpringIndex(root)
	if !looksLikeQuarkus(index.Values, index.PropertyReferences) {
		t.Fatalf("the Quarkus project was not recognized: %+v", index.Values)
	}
	byName := map[string]SpringProperty{}
	for _, property := range index.Properties {
		byName[property.Name] = property
	}
	port, ok := byName["quarkus.http.port"]
	if !ok {
		t.Fatalf("quarkus.http.port missing from %d properties", len(index.Properties))
	}
	if port.Source != SourceBuiltIn || port.Type != "int" {
		t.Fatalf("built-in port: %+v", port)
	}
	level, ok := byName["quarkus.log.level"]
	if !ok || level.Default != "INFO" {
		t.Fatalf("quarkus.log.level: %+v", level)
	}
	// Il valore scritto nel progetto vince sulla proprietà nota.
	found := false
	for _, value := range index.Values {
		if value.Key == "quarkus.http.port" && value.Value == "8081" {
			found = true
		}
	}
	if !found {
		t.Fatalf("configured value lost: %+v", index.Values)
	}
	// La porta del server è quella di Quarkus.
	if index.ServerPort != "8081" {
		t.Fatalf("serverPort = %q", index.ServerPort)
	}
}

func TestQuarkusMicroProfileBeansAndConfig(t *testing.T) {
	source := parseJavaSource([]byte(fruitResourceJava))
	source.File = "src/main/java/com/acme/demo/FruitResource.java"
	if !looksLikeQuarkus(nil, propertyReferencesOf([]javaSource{source})) {
		t.Fatal("@ConfigProperty must reveal a MicroProfile project")
	}
}

// Gli endpoint JAX-RS devono arrivare al Developer Context (API Workspace, Mock, cURL, OpenAPI),
// che scansiona i file uno alla volta senza costruire l'indice Spring.
func TestJaxRsEndpointsReachTheDeveloperContext(t *testing.T) {
	endpoints := EndpointsInFile("src/main/java/com/acme/demo/FruitResource.java", []byte(fruitResourceJava))
	if len(endpoints) != 2 {
		t.Fatalf("endpoints: %+v", endpoints)
	}
	for _, endpoint := range endpoints {
		if endpoint.File != "src/main/java/com/acme/demo/FruitResource.java" {
			t.Fatalf("file not set for the dev context: %+v", endpoint)
		}
	}
	if endpoints[0].Method != "GET" || endpoints[0].Path != "/api/fruits" || endpoints[1].Method != "POST" {
		t.Fatalf("routes: %+v", endpoints)
	}
}
