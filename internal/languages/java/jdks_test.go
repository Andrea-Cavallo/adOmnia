package java

import (
	"path/filepath"
	"strings"
	"testing"

	"adomnia/internal/ide/sdk"
)

func fakeJDK(t *testing.T, version string) string {
	t.Helper()
	return writeFixture(t, map[string]string{
		"bin/" + sdk.ExecutableName("java"): "",
		"release":                           "IMPLEMENTOR=\"x\"\nJAVA_VERSION=\"" + version + "\"\n",
	})
}

func TestRequiredJavaReadsMavenAndGradleDeclarations(t *testing.T) {
	cases := map[string]struct {
		files map[string]string
		want  int
	}{
		"maven release":      {map[string]string{"pom.xml": "<project><properties><maven.compiler.release>17</maven.compiler.release></properties></project>"}, 17},
		"maven java.version": {map[string]string{"pom.xml": "<project><properties><java.version>21</java.version></properties></project>"}, 21},
		"maven legacy":       {map[string]string{"pom.xml": "<project><properties><maven.compiler.source>1.8</maven.compiler.source><maven.compiler.target>1.8</maven.compiler.target></properties></project>"}, 8},
		"gradle compat":      {map[string]string{"build.gradle": "sourceCompatibility = '11'\ntargetCompatibility = JavaVersion.VERSION_11"}, 11},
		"gradle toolchain":   {map[string]string{"build.gradle.kts": "java { toolchain { languageVersion = JavaLanguageVersion.of(21) } }"}, 21},
		"nothing":            {map[string]string{"pom.xml": "<project/>"}, 0},
	}
	for name, test := range cases {
		if got := RequiredJava(writeFixture(t, test.files)); got != test.want {
			t.Errorf("%s: RequiredJava = %d, want %d", name, got, test.want)
		}
	}
}

func TestPickJDKPrefersTheSmallestSatisfyingVersion(t *testing.T) {
	installed := []JDK{{Home: "/j21", Major: 21}, {Home: "/j17", Major: 17}, {Home: "/j8", Major: 8}}
	if got, ok := PickJDK(installed, 11); !ok || got.Home != "/j17" {
		t.Fatalf("required 11: %+v %v", got, ok)
	}
	if got, ok := PickJDK(installed, 0); !ok || got.Home != "/j21" {
		t.Fatalf("no requirement picks the newest: %+v %v", got, ok)
	}
	if _, ok := PickJDK(installed, 25); ok {
		t.Fatal("no JDK satisfies 25")
	}
}

func TestJavaHomeIsValidatedAndExported(t *testing.T) {
	home := fakeJDK(t, "21.0.4")
	if !ValidJavaHome(home) || ValidJavaHome(filepath.Join(home, "missing")) || ValidJavaHome("") || ValidJavaHome(home+"\nX") {
		t.Fatal("ValidJavaHome should accept only folders with bin/java and clean paths")
	}
	if version := releaseVersion(home); version != "21.0.4" {
		t.Fatalf("release version = %q", version)
	}
	environment := strings.Join(JavaEnvironment(home), "|")
	if !strings.Contains(environment, "JAVA_HOME="+home) || !strings.Contains(environment, "PATH="+filepath.Join(home, "bin")) {
		t.Fatalf("environment = %q", environment)
	}
	if JavaEnvironment("") != nil {
		t.Fatal("no home, no environment")
	}
}

func TestMainCommandCarriesTheChosenJDK(t *testing.T) {
	withSystemTools(t, "mvn")
	home := fakeJDK(t, "17.0.2")
	module := writeFixture(t, map[string]string{"pom.xml": "<project><artifactId>a</artifactId></project>"})
	_, _, _, environment, err := MainCommandWith(module, MainOptions{MainClass: "a.App", JavaHome: home}, nil)
	if err != nil || !strings.Contains(strings.Join(environment, "|"), "JAVA_HOME="+home) {
		t.Fatalf("environment = %v, err = %v", environment, err)
	}
	if _, _, _, _, err := MainCommandWith(module, MainOptions{MainClass: "a.App", JavaHome: filepath.Join(home, "nope")}, nil); err == nil {
		t.Fatal("an invalid JDK home must be rejected")
	}
}
