package java

import (
	"encoding/json"
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

func TestRequiredJavaReadsModulesOfAMultiModuleProject(t *testing.T) {
	// La release si dichiara nei moduli, non nell'aggregatore: un progetto multi-modulo
	// (es. quarkus-super-heroes) senza questo controllo risulta senza requisiti.
	root := writeFixture(t, map[string]string{
		"pom.xml":             `<project><modules><module>rest-a</module><module>rest-b</module><module>../outside</module></modules></project>`,
		"rest-a/pom.xml":      `<project><properties><maven.compiler.release>25</maven.compiler.release></properties></project>`,
		"rest-b/pom.xml":      `<project><modules><module>deep</module></modules></project>`,
		"rest-b/deep/pom.xml": `<project><properties><maven.compiler.release>17</maven.compiler.release></properties></project>`,
	})
	if got := RequiredJava(root); got != 25 {
		t.Fatalf("maven reactor RequiredJava = %d, want 25 (the highest of aggregator + modules)", got)
	}
	// Gradle: i progetti `include`d in settings.gradle valgono come moduli.
	gradle := writeFixture(t, map[string]string{
		"settings.gradle":       `include 'api', 'web:deep'`,
		"build.gradle":          `// aggregator`,
		"api/build.gradle.kts":  `java { toolchain { languageVersion = JavaLanguageVersion.of(21) } }`,
		"web/deep/build.gradle": `targetCompatibility = JavaVersion.VERSION_17`,
	})
	if got := RequiredJava(gradle); got != 21 {
		t.Fatalf("gradle reactor RequiredJava = %d, want 21", got)
	}
	if got := RequiredJava(filepath.Join(root, "rest-a")); got != 25 {
		t.Fatalf("single module RequiredJava = %d, want 25", got)
	}
}

func TestRequiredJavaNeverReadsOutsideTheUnitRoot(t *testing.T) {
	root := writeFixture(t, map[string]string{
		"unit/pom.xml":    `<project><modules><module>../sibling</module></modules></project>`,
		"sibling/pom.xml": `<project><properties><maven.compiler.release>25</maven.compiler.release></properties></project>`,
	})
	if got := RequiredJava(filepath.Join(root, "unit")); got != 0 {
		t.Fatalf("RequiredJava followed a module outside the unit root: %d", got)
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

func TestJDTSettingsCarryTheProjectJDKFirst(t *testing.T) {
	// La toolchain del progetto deve arrivare a JDT LS per prima: Run, Debug, Test e build JDT
	// lavorano sullo stesso JDK, e un JDK scelto fuori dai posti noti resta comunque visibile.
	selected := fakeJDK(t, "25.0.4")
	data, err := json.Marshal(map[string]string{"javaHome": selected})
	if err != nil {
		t.Fatal(err)
	}
	root := writeFixture(t, map[string]string{".adomnia/java.local.json": string(data)})
	if home := ProjectJavaHome(root); home != selected {
		t.Fatalf("ProjectJavaHome = %q, want %q", home, selected)
	}
	settings := JDTSettingsFor(root)
	configuration := settings["java"].(map[string]any)["configuration"].(map[string]any)
	runtimes, ok := configuration["runtimes"].([]map[string]any)
	if !ok || len(runtimes) == 0 {
		t.Fatalf("runtimes: %#v", configuration)
	}
	if runtimes[0]["path"] != selected || runtimes[0]["name"] != "JavaSE-25" {
		t.Fatalf("il JDK del progetto deve essere il primo runtime: %#v", runtimes[0])
	}
	// Senza scelta il progetto non impone nulla.
	if home := ProjectJavaHome(writeFixture(t, map[string]string{"pom.xml": "<project/>"})); home != "" {
		t.Fatalf("ProjectJavaHome senza scelta = %q", home)
	}
	if err := SetProjectJavaHome(root, ""); err != nil || ProjectJavaHome(root) != "" {
		t.Fatalf("rimozione della scelta: %v", err)
	}
	if err := SetProjectJavaHome(root, filepath.Join(root, "missing")); err == nil {
		t.Fatal("una cartella senza bin/java deve essere rifiutata")
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
