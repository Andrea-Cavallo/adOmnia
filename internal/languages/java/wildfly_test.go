package java

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

const wildflyStandaloneXML = `<?xml version='1.0' encoding='UTF-8'?>
<server xmlns="urn:jboss:domain:20.0">
    <profile/>
    <socket-binding-group name="standard-sockets" default-interface="public">
        <socket-binding name="http" port="${jboss.http.port:8080}"/>
    </socket-binding-group>
</server>
`

func fakeWildFly(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	write(t, standaloneScript(home), "#!/bin/sh\n")
	write(t, filepath.Join(home, "standalone", "configuration", "standalone.xml"), wildflyStandaloneXML)
	write(t, filepath.Join(home, "standalone", "configuration", "mgmt-users.properties"), "")
	return home
}

func TestWildFlyDeploysTheExplodedWarInPlace(t *testing.T) {
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	t.Setenv("LocalAppData", t.TempDir())
	home := fakeWildFly(t)
	module := t.TempDir()
	write(t, filepath.Join(module, "pom.xml"), `<project><artifactId>shop</artifactId><version>1.0</version><packaging>war</packaging></project>`)
	war := filepath.Join(module, "target", "shop-1.0")
	write(t, filepath.Join(war, "WEB-INF", "classes", "A.class"), "")
	write(t, filepath.Join(war, "WEB-INF", "jboss-web.xml"), "<jboss-web><context-root>/shop-api</context-root></jboss-web>")

	launch, err := ServerCommand(KindWildFly, module, []byte(`{"jbossHome":"`+strings.ReplaceAll(home, `\`, `\\`)+`","httpPort":"8180"}`), 8787, nil)
	if err != nil {
		t.Fatal(err)
	}
	if launch.URL != "http://localhost:8180/shop-api/" || launch.Spec.Executable != standaloneScript(home) {
		t.Fatalf("launch = %+v", launch)
	}
	arguments := launch.Spec.Arguments
	if !slices.Contains(arguments, "-Djboss.http.port=8180") || !slices.Contains(arguments, "--debug") || !slices.Contains(arguments, "127.0.0.1:8787") {
		t.Fatalf("arguments = %v", arguments)
	}
	base := ""
	for _, argument := range arguments {
		if after, ok := strings.CutPrefix(argument, "-Djboss.server.base.dir="); ok {
			base = after
		}
	}
	config, err := os.ReadFile(filepath.Join(base, "configuration", "standalone.xml"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(config), `runtime-name="shop-api.war"`) || !strings.Contains(string(config), `<fs-exploded path="`+war+`"/>`) || !strings.HasSuffix(strings.TrimSpace(string(config)), "</server>") {
		t.Fatalf("standalone.xml = %s", config)
	}
	original, _ := os.ReadFile(filepath.Join(home, "standalone", "configuration", "standalone.xml"))
	if string(original) != wildflyStandaloneXML {
		t.Fatal("the installation is never modified")
	}
}

func TestWildFlyNeedsACompleteWar(t *testing.T) {
	home := fakeWildFly(t)
	root, _ := keplerWorkspace(t)
	module := filepath.Join(root, "billing")
	if _, err := WildFlyCommand(module, WildFlyOptions{JBossHome: home}, 0, nil); err == nil || !strings.Contains(err.Error(), "WEB-INF/classes") {
		t.Fatalf("err = %v", err)
	}
	t.Setenv("JBOSS_HOME", "")
	t.Setenv("PATH", t.TempDir())
	if _, err := resolveJBossHome("", t.TempDir()); err == nil || !strings.Contains(err.Error(), "JBOSS_HOME") {
		t.Fatalf("err = %v", err)
	}
}
