package java

import (
	"archive/zip"
	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
	"os"
	"path/filepath"
	"testing"
)

const metadataSample = `{
  "groups": [
    {"name": "server", "type": "org.springframework.boot.web.server.ServerProperties", "sourceType": "org.springframework.boot.web.server.ServerProperties"}
  ],
  "properties": [
    {"name": "server.port", "type": "java.lang.Integer", "description": "Server HTTP port.", "sourceType": "org.springframework.boot.web.server.ServerProperties", "defaultValue": 8080},
    {"name": "server.address", "type": "java.net.InetAddress", "description": "Network address to which the server should bind.", "sourceType": "org.springframework.boot.web.server.ServerProperties"}
  ]
}`

func TestParseMetadataJSONReadsProperties(t *testing.T) {
	properties, ok := parseMetadataJSON([]byte(metadataSample))
	if !ok || len(properties) != 2 {
		t.Fatalf("properties: %+v ok=%v", properties, ok)
	}
	if properties[0].Name != "server.port" || properties[0].Type != "java.lang.Integer" || properties[0].Default != "8080" {
		t.Fatalf("first: %+v", properties[0])
	}
	if properties[0].Source != SourceMetadata || properties[0].Description == "" {
		t.Fatalf("source and description: %+v", properties[0])
	}
}

func TestParseMetadataJSONRejectsBrokenDocuments(t *testing.T) {
	if _, ok := parseMetadataJSON([]byte(`{ not json`)); ok {
		t.Fatal("broken json must not be accepted")
	}
	if _, ok := parseMetadataJSON(nil); ok {
		t.Fatal("empty must not be accepted")
	}
}

// writeJar scrive un jar di test con dentro i metadata di Spring.
func writeJar(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	writer := zip.NewWriter(file)
	entry, err := writer.Create("META-INF/spring-configuration-metadata.json")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write([]byte(content)); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestReadJarPropertiesFromArchive(t *testing.T) {
	path := filepath.Join(t.TempDir(), "spring-boot-autoconfigure-3.1.0.jar")
	writeJar(t, path, metadataSample)
	properties := readJarProperties(path)
	if len(properties) != 2 {
		t.Fatalf("properties: %+v", properties)
	}
	if readJarProperties(filepath.Join(t.TempDir(), "missing.jar")) != nil {
		t.Fatal("a missing jar contributes nothing")
	}
	broken := filepath.Join(t.TempDir(), "broken.jar")
	if err := os.WriteFile(broken, []byte("not a zip"), 0o644); err != nil {
		t.Fatal(err)
	}
	if readJarProperties(broken) != nil {
		t.Fatal("a corrupted jar is ignored, not fatal")
	}
}

func TestRefreshSpringMetadataUsesTheCache(t *testing.T) {
	isolateMetadataCache(t)
	repository := t.TempDir()
	writeJar(t, filepath.Join(repository, "org", "springframework", "boot", "spring-boot-autoconfigure-3.1.0.jar"), metadataSample)
	writeJar(t, filepath.Join(repository, "com", "acme", "acme-core-1.0.0.jar"), metadataSample)

	first := RefreshSpringMetadata(repository, 100)
	if first.Artifacts != 2 || first.Cached != 0 || first.Properties != 4 {
		t.Fatalf("first scan: %+v", first)
	}
	if first.State != MetadataReady {
		t.Fatalf("state: %+v", first)
	}

	second := RefreshSpringMetadata(repository, 100)
	if second.Artifacts != 2 || second.Cached != 2 || second.Properties != 0 {
		t.Fatalf("the cache must skip unchanged jars: %+v", second)
	}

	properties := loadMetadataProperties()
	if len(properties) != 2 {
		t.Fatalf("the cache exposes each property once: %+v", properties)
	}
	if metadataStateOf() != MetadataReady {
		t.Fatalf("state after load: %s", metadataStateOf())
	}
}

func TestRefreshSpringMetadataKeepsChangedJars(t *testing.T) {
	isolateMetadataCache(t)
	repository := t.TempDir()
	path := filepath.Join(repository, "spring-boot-3.1.0.jar")
	writeJar(t, path, metadataSample)
	if first := RefreshSpringMetadata(repository, 100); first.Cached != 0 {
		t.Fatalf("first scan: %+v", first)
	}
	writeJar(t, path, `{"properties":[{"name":"acme.custom","type":"java.lang.String"}]}`)
	second := RefreshSpringMetadata(repository, 100)
	if second.Cached != 0 || second.Artifacts != 1 {
		t.Fatalf("a changed jar is read again: %+v", second)
	}
	if second.Properties != 1 {
		t.Fatalf("properties: %+v", second)
	}
}

func TestRefreshSpringMetadataStopsAtTheLimit(t *testing.T) {
	isolateMetadataCache(t)
	repository := t.TempDir()
	for index := 0; index < 5; index++ {
		writeJar(t, filepath.Join(repository, "lib-"+string(rune('a'+index))+".jar"), metadataSample)
	}
	report := RefreshSpringMetadata(repository, 2)
	if report.Artifacts != 2 {
		t.Fatalf("limit not applied: %+v", report)
	}
	if report.State != MetadataPartial {
		t.Fatalf("a truncated scan must say so: %+v", report)
	}
}

func TestMetadataCacheRoundTrip(t *testing.T) {
	isolateMetadataCache(t)
	cache := springMetadataCache{Repository: "r", Entries: map[string]metadataEntry{
		"/a.jar": {Size: 1, ModTime: 2, Properties: []SpringProperty{{Name: "x", Type: "java.lang.String"}}},
	}}
	writeMetadataCache(cache)
	path := springMetadataCacheFile()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("cache file %q: %v", path, err)
	}
	t.Logf("cache file %q: %s", path, raw)
	loaded := readMetadataCache()
	if loaded.Repository != "r" || len(loaded.Entries["/a.jar"].Properties) != 1 {
		t.Fatalf("round trip: %+v", loaded)
	}
	encoded, err := jsonutil.Marshal(loaded)
	if err != nil || len(encoded) == 0 {
		t.Fatalf("json: %v", err)
	}
}
