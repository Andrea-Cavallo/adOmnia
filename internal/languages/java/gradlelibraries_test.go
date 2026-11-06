package java

import (
	"os"
	"path/filepath"
	"testing"
)

func TestParseGradleLibrariesOutput(t *testing.T) {
	text := "Welcome to Gradle 8.7\r\n" +
		"ADOMNIA|LIB|/work/app|compileClasspath|org.springframework|spring-core|6.1.5|true\r\n" +
		"some task output\r\n" +
		"ADOMNIA|LIB|C:\\work\\web|runtimeClasspath|org.lib|lib|2.0|false\r\n" +
		"ADOMNIA|LIB|/work|compileClasspath|broken||1.0|true\r\n" +
		"ADOMNIA|SOURCE|/cache/spring-core-6.1.5-sources.jar\r\n"
	refs := ParseGradleLibrariesOutput(text)
	if len(refs) != 2 {
		t.Fatalf("refs = %+v", refs)
	}
	if refs[0].GroupID != "org.springframework" || refs[0].ArtifactID != "spring-core" || refs[0].Version != "6.1.5" || !refs[0].Direct || refs[0].ProjectDir != "/work/app" {
		t.Fatalf("direct ref = %+v", refs[0])
	}
	if refs[1].Direct || refs[1].ProjectDir != `C:\work\web` || refs[1].Configuration != "runtimeClasspath" {
		t.Fatalf("transitive ref = %+v", refs[1])
	}
}

func TestGradleScopeName(t *testing.T) {
	cases := map[string]string{
		"implementation":       "compile",
		"compileClasspath":     "compile",
		"runtimeOnly":          "runtime",
		"runtimeClasspath":     "runtime",
		"testImplementation":   "test",
		"testRuntimeClasspath": "test",
		"compileOnly":          "provided",
		"annotationProcessor":  "provided",
		"kapt":                 "provided",
		"ksp":                  "provided",
	}
	for configuration, want := range cases {
		if got := GradleScopeName(configuration); got != want {
			t.Errorf("GradleScopeName(%q) = %q, want %q", configuration, got, want)
		}
	}
}

func TestGradleArtifactPath(t *testing.T) {
	home := t.TempDir()
	jar := filepath.Join(home, "caches", "modules-2", "files-2.1", "org.lib", "lib", "2.0", "0123456789abcdef", "lib-2.0.jar")
	sources := filepath.Join(home, "caches", "modules-2", "files-2.1", "org.lib", "lib", "2.0", "0123456789abcdef", "lib-2.0-sources.jar")
	for _, path := range []string{jar, sources} {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if got := GradleArtifactPath(home, "org.lib", "lib", "2.0", ""); got != jar {
		t.Fatalf("jar = %q, want %q", got, jar)
	}
	if got := GradleArtifactPath(home, "org.lib", "lib", "2.0", "sources"); got != sources {
		t.Fatalf("sources = %q, want %q", got, sources)
	}
	if got := GradleArtifactPath(home, "org.missing", "lib", "2.0", ""); got != "" {
		t.Fatalf("missing artifact = %q", got)
	}
}

func TestGradleUserHome(t *testing.T) {
	if got := GradleUserHome([]string{"PATH=/x", "GRADLE_USER_HOME=C:/gradle", "HOME=C:/users/me"}); got != "C:/gradle" {
		t.Fatalf("GRADLE_USER_HOME = %q", got)
	}
	home, _ := os.UserHomeDir()
	if got := GradleUserHome([]string{"PATH=/x"}); got != filepath.Join(home, ".gradle") {
		t.Fatalf("default = %q", got)
	}
}
