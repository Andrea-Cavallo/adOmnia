package java

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
)

const tomcat7ServerXML = `<?xml version='1.0' encoding='utf-8'?>
<Server port="8005" shutdown="SHUTDOWN">
  <!-- <Connector port="8443" protocol="HTTP/1.1" SSLEnabled="true"/> -->
  <Service name="Catalina">
    <Connector port="8080" protocol="HTTP/1.1" connectionTimeout="20000" redirectPort="8443" />
    <Connector port="8009" protocol="AJP/1.3" redirectPort="8443" />
    <Engine name="Catalina" defaultHost="localhost">
      <Host name="localhost" appBase="webapps" unpackWARs="true" autoDeploy="true"/>
    </Engine>
  </Service>
</Server>`

func fakeTomcat(t *testing.T, version string) string {
	t.Helper()
	home := t.TempDir()
	write(t, catalinaScript(home), "#!/bin/sh\n")
	write(t, filepath.Join(home, "conf", "server.xml"), tomcat7ServerXML)
	write(t, filepath.Join(home, "conf", "web.xml"), "<web-app/>")
	write(t, filepath.Join(home, "RELEASE-NOTES"), "Apache Tomcat Version "+version+"\n")
	return home
}

func TestTomcatPublishesAnEclipseWebProjectInAPrivateBase(t *testing.T) {
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	t.Setenv("LocalAppData", t.TempDir())
	home := fakeTomcat(t, "7.0.47")
	module := filepath.Join(t.TempDir(), "billing")
	write(t, filepath.Join(module, "WebContent", "WEB-INF", "web.xml"), "<web-app/>")
	write(t, filepath.Join(module, "build", "classes", "com", "acme", "A.class"), "")

	launch, err := TomcatCommand(module, TomcatOptions{CatalinaHome: home, HTTPPort: "9090"}, 5006, []string{"PATH=/bin"})
	if err != nil {
		t.Fatal(err)
	}
	if launch.URL != "http://localhost:9090/billing/" || strings.Join(launch.Spec.Arguments, " ") != "jpda run" || launch.Spec.Executable != catalinaScript(home) {
		t.Fatalf("launch = %+v", launch)
	}
	base := envValue(launch.Spec.Environment, "CATALINA_BASE")
	if base == "" || strings.HasPrefix(base, home) || !slices.Contains(launch.Spec.Environment, "JPDA_ADDRESS=127.0.0.1:5006") || !slices.Contains(launch.Spec.Environment, "PATH=/bin") {
		t.Fatalf("environment = %v", launch.Spec.Environment)
	}
	server, err := os.ReadFile(filepath.Join(base, "conf", "server.xml"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(server)
	if !strings.Contains(text, `<Server port="-1"`) || !strings.Contains(text, `port="9090" protocol="HTTP/1.1"`) || strings.Contains(text, "AJP") || strings.Contains(text, "8443\" protocol=\"HTTP/1.1\" SSLEnabled") {
		t.Fatalf("server.xml = %s", text)
	}
	original, _ := os.ReadFile(filepath.Join(home, "conf", "server.xml"))
	if string(original) != tomcat7ServerXML {
		t.Fatal("the Tomcat installation must never be modified")
	}
	context, err := os.ReadFile(filepath.Join(base, "conf", "Catalina", "localhost", "billing.xml"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(context), `docBase="`+filepath.Join(module, "WebContent")+`"`) || !strings.Contains(string(context), "VirtualWebappLoader") {
		t.Fatalf("context = %s", context)
	}
}

func TestTomcatUsesTheExplodedMavenWarAndRootContext(t *testing.T) {
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	t.Setenv("LocalAppData", t.TempDir())
	home := fakeTomcat(t, "9.0.85")
	module := t.TempDir()
	write(t, filepath.Join(module, "pom.xml"), `<project><artifactId>shop</artifactId><version>2.1</version><packaging>war</packaging></project>`)
	write(t, filepath.Join(module, "target", "shop-2.1", "WEB-INF", "web.xml"), "<web-app/>")

	launch, err := TomcatCommand(module, TomcatOptions{CatalinaHome: home, ContextPath: "/"}, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	if launch.URL != "http://localhost:8080/" || strings.Join(launch.Spec.Arguments, " ") != "run" {
		t.Fatalf("launch = %+v", launch)
	}
	base := envValue(launch.Spec.Environment, "CATALINA_BASE")
	context, err := os.ReadFile(filepath.Join(base, "conf", "Catalina", "localhost", "ROOT.xml"))
	if err != nil || !strings.Contains(string(context), filepath.Join(module, "target", "shop-2.1")) || strings.Contains(string(context), "Resources") {
		t.Fatalf("context = %s, %v", context, err)
	}
}

func TestTomcatExplainsWhatIsMissing(t *testing.T) {
	t.Setenv("CATALINA_HOME", "")
	module := t.TempDir()
	if _, err := TomcatCommand(module, TomcatOptions{}, 0, nil); err == nil || !strings.Contains(err.Error(), "CATALINA_HOME") {
		t.Fatalf("err = %v", err)
	}
	home := fakeTomcat(t, "8.5.0")
	if _, err := TomcatCommand(module, TomcatOptions{CatalinaHome: home}, 0, nil); err == nil || !strings.Contains(err.Error(), "exploded WAR") {
		t.Fatalf("err = %v", err)
	}
	if _, err := TomcatCommand(module, TomcatOptions{CatalinaHome: home, Webapp: "../outside"}, 0, nil); err == nil {
		t.Fatal("a webapp outside the module must be refused")
	}
}

func TestTomcatIsSuggestedForWebModulesWhenInstalled(t *testing.T) {
	module := t.TempDir()
	write(t, filepath.Join(module, "build.xml"), `<project name="legacy" default="dist"><target name="dist"/></project>`)
	write(t, filepath.Join(module, "WebContent", "WEB-INF", "web.xml"), "<web-app/>")
	unit := project.Unit{Language: ID, Kind: UnitAnt, Root: module, Manifest: filepath.Join(module, "build.xml")}
	stubTools(t)
	t.Setenv("ANT_HOME", "")
	t.Setenv("CATALINA_HOME", fakeTomcat(t, "7.0.47"))
	suggestions := (&Language{}).Suggest(t.Context(), module, unit)
	if len(suggestions) != 1 || suggestions[0].Configuration.Kind != KindTomcat || suggestions[0].Action != "run" {
		t.Fatalf("suggestions = %+v", suggestions)
	}
}

func envValue(environment []string, key string) string {
	for _, entry := range environment {
		if after, ok := strings.CutPrefix(entry, key+"="); ok {
			return after
		}
	}
	return ""
}
