package maven

import (
	"context"
	"github.com/Andrea-Cavallo/adOmnia/internal/securityintel"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGradleBuildIsDiscoveredAndResolved(t *testing.T) {
	root := t.TempDir()
	script := filepath.Join(root, "app", "build.gradle")
	if err := os.MkdirAll(filepath.Dir(script), 0o755); err != nil {
		t.Fatal(err)
	}
	body := "ext.jackson = '2.13.0'\ndependencies {\n  implementation \"com.fasterxml.jackson.core:jackson-databind:$jackson\"\n  testImplementation 'junit:junit:4.13.2'\n  implementation 'org.springframework.boot:spring-boot-starter'\n}\n"
	if err := os.WriteFile(script, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	targets, err := New().Discover(context.Background(), root)
	if err != nil || len(targets) != 1 || targets[0].Manifest != script {
		t.Fatalf("targets %+v err %v", targets, err)
	}
	resolution, err := New().Resolve(context.Background(), targets[0], securityintel.DefaultResolveOptions())
	if err != nil {
		t.Fatal(err)
	}
	if len(resolution.Components) != 2 || resolution.Components[0].Name != "com.fasterxml.jackson.core:jackson-databind" || resolution.Components[0].Version != "2.13.0" || resolution.Components[1].Scope != "test" {
		t.Fatalf("components %+v", resolution.Components)
	}
	if len(resolution.Warnings) < 2 {
		t.Fatalf("expected the static-read and unversioned warnings: %v", resolution.Warnings)
	}
}

func writeRepositoryPOM(t *testing.T, repository, group, artifact, version, body string) {
	t.Helper()
	dir := filepath.Join(repository, filepath.FromSlash(strings.ReplaceAll(group, ".", "/")), artifact, version)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	pom := "<project><modelVersion>4.0.0</modelVersion><groupId>" + group + "</groupId><artifactId>" + artifact + "</artifactId><version>" + version + "</version><packaging>pom</packaging>" + body + "</project>"
	if err := os.WriteFile(filepath.Join(dir, artifact+"-"+version+".pom"), []byte(pom), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestGradleSpringBootPluginManagesVersionsFromTheLocalBOM(t *testing.T) {
	repository := t.TempDir()
	writeRepositoryPOM(t, repository, "com.fasterxml.jackson", "jackson-bom", "2.15.3",
		"<dependencyManagement><dependencies><dependency><groupId>com.fasterxml.jackson.core</groupId><artifactId>jackson-databind</artifactId><version>2.15.3</version></dependency></dependencies></dependencyManagement>")
	writeRepositoryPOM(t, repository, "org.springframework.boot", "spring-boot-dependencies", "3.2.0",
		"<dependencyManagement><dependencies>"+
			"<dependency><groupId>org.yaml</groupId><artifactId>snakeyaml</artifactId><version>2.2</version></dependency>"+
			"<dependency><groupId>com.fasterxml.jackson</groupId><artifactId>jackson-bom</artifactId><version>2.15.3</version><type>pom</type><scope>import</scope></dependency>"+
			"</dependencies></dependencyManagement>")
	script := filepath.Join(t.TempDir(), "build.gradle")
	body := "plugins {\n  id 'org.springframework.boot' version '3.2.0'\n}\ndependencies {\n  implementation 'org.yaml:snakeyaml'\n  implementation 'com.fasterxml.jackson.core:jackson-databind'\n  implementation 'org.unknown:nowhere'\n  testImplementation 'junit:junit:4.13.2'\n}\n"
	if err := os.WriteFile(script, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	adapter := &Adapter{Resolver: Resolver{LocalRepository: repository}}
	resolution, err := adapter.Resolve(context.Background(), securityintel.Target{Manifest: script}, securityintel.DefaultResolveOptions())
	if err != nil {
		t.Fatal(err)
	}
	versions := map[string]string{}
	for _, component := range resolution.Components {
		versions[component.Name] = component.Version
	}
	want := map[string]string{"org.yaml:snakeyaml": "2.2", "com.fasterxml.jackson.core:jackson-databind": "2.15.3", "junit:junit": "4.13.2"}
	if len(versions) != len(want) {
		t.Fatalf("components %v", versions)
	}
	for name, version := range want {
		if versions[name] != version {
			t.Fatalf("%s: got %q want %q (%v)", name, versions[name], version, versions)
		}
	}
	// Senza il BOM nel repository il comportamento resta quello dichiarato: warning, nessuna versione inventata.
	missing := &Adapter{Resolver: Resolver{LocalRepository: t.TempDir()}}
	resolution, err = missing.Resolve(context.Background(), securityintel.Target{Manifest: script}, securityintel.DefaultResolveOptions())
	if err != nil || len(resolution.Components) != 1 || !strings.Contains(strings.Join(resolution.Warnings, "\n"), "is not in the local Maven repository") {
		t.Fatalf("%v %+v", err, resolution)
	}
}
