package java

import (
	"os"
	"testing"
)

// TestSpringIndexOnARealProject analizza un progetto Spring vero quando viene indicato: è la prova
// che l'indice funziona sul codice degli utenti e non solo sulle fixture. Non gira in CI, serve
// `SPRING_SAMPLE_DIR` che punta a un progetto Spring Boot reale (Maven o Gradle).
//
//	SPRING_SAMPLE_DIR=C:\work\demo go test ./internal/languages/java/ -run TestSpringIndexOnARealProject -v
func TestSpringIndexOnARealProject(t *testing.T) {
	root := os.Getenv("SPRING_SAMPLE_DIR")
	if root == "" {
		t.Skip("set SPRING_SAMPLE_DIR to a real Spring Boot project to run this check")
	}
	isolateMetadataCache(t)
	index := BuildSpringIndex(root)
	t.Logf("status=%s properties=%d values=%d references=%d beans=%d injections=%d endpoints=%d diagnostics=%d skipped=%d",
		index.Status, len(index.Properties), len(index.Values), len(index.PropertyReferences),
		len(index.Beans), len(index.Injections), len(index.Endpoints), len(index.Diagnostics), index.Skipped)
	t.Logf("serverPort=%q", index.ServerPort)
	for _, endpoint := range index.Endpoints {
		t.Logf("endpoint %-7s %-40s %s.%s", endpoint.Method, endpoint.Path, endpoint.Class, endpoint.Member)
	}
	for _, property := range index.Properties {
		t.Logf("property %-45s %-25s %s", property.Name, property.Type, property.Origin)
	}
	if index.Status != "ready" {
		t.Fatalf("status: %+v", index)
	}

	// Seconda fase: i metadata degli jar già scaricati nella repository Maven locale.
	if os.Getenv("SPRING_SAMPLE_METADATA") != "1" {
		t.Skip("set SPRING_SAMPLE_METADATA=1 to also index the local Maven repository")
	}
	report := RefreshSpringMetadata(DefaultSpringRepository(), 500)
	t.Logf("metadata: artifacts=%d cached=%d properties=%d state=%s", report.Artifacts, report.Cached, report.Properties, report.State)
	after := BuildSpringIndex(root)
	t.Logf("after metadata: properties=%d", len(after.Properties))
	for _, property := range after.Properties {
		t.Logf("known %-45s %-25s %s", property.Name, property.Type, property.Origin)
	}
	if report.Artifacts == 0 {
		t.Fatalf("no jar scanned in %s", report.Repository)
	}
}
