package maven

import (
	"adomnia/internal/securityintel"
	"context"
	"os"
	"path/filepath"
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
