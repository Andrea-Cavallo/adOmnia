package java

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestTomcatIsFoundInTheEclipseWorkspaceAndInSharedConfigurations(t *testing.T) {
	t.Setenv("CATALINA_HOME", "")
	t.Setenv("PATH", t.TempDir())
	root, tomcat := keplerWorkspace(t)
	escaped := strings.NewReplacer(`\`, `\\`, `:`, `\:`, `=`, `\=`).Replace(tomcat)
	write(t, filepath.Join(root, filepath.FromSlash(wtpServerPrefs)), "eclipse.preferences.version=1\n"+
		`runtimes=<?xml version\="1.0" encoding\="UTF-8" standalone\="no"?><runtimes><runtime id\="Apache Tomcat v7.0" location\="`+escaped+`" name\="Apache Tomcat v7.0" runtime-type-id\="org.eclipse.jst.server.tomcat.runtime.70" timestamp\="0"/></runtimes>`+"\n")

	if got := discoverCatalinaHome(filepath.Join(root, "billing")); got != filepath.Clean(tomcat) {
		t.Fatalf("from the workspace runtime: %q, want %q", got, tomcat)
	}
	shadow, err := WriteEclipseShadowWorkspace(root, t.TempDir(), "")
	if err != nil || len(shadow.Problems) != 0 {
		t.Fatalf("the servlet API resolves without CATALINA_HOME: %+v, %v", shadow, err)
	}

	project := t.TempDir()
	shared := strings.ReplaceAll(tomcat, `\`, `\\`)
	write(t, filepath.Join(project, filepath.FromSlash(sharedRunConfigurations)), `{"version":1,"configurations":[{"name":"Tomcat","language":"java","kind":"tomcat","languageOptions":{"catalinaHome":"`+shared+`"}}]}`)
	if got := discoverCatalinaHome(filepath.Join(project, "web")); got != filepath.Clean(tomcat) {
		t.Fatalf("from a shared Tomcat configuration: %q", got)
	}
	if got := discoverCatalinaHome(t.TempDir()); got != "" {
		t.Fatalf("nothing to find: %q", got)
	}
}
