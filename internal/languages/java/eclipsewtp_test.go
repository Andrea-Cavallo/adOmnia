package java

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
)

const keplerWebProject = `<?xml version="1.0" encoding="UTF-8"?>
<projectDescription><name>billing</name><natures>
  <nature>org.eclipse.jem.workbench.JavaEMFNature</nature>
  <nature>org.eclipse.wst.common.modulecore.ModuleCoreNature</nature>
  <nature>org.eclipse.jdt.core.javanature</nature>
  <nature>org.eclipse.wst.common.project.facet.core.nature</nature>
</natures></projectDescription>`

const keplerWebClasspath = `<?xml version="1.0" encoding="UTF-8"?>
<classpath>
  <classpathentry kind="src" path="src"/>
  <classpathentry kind="con" path="org.eclipse.jdt.launching.JRE_CONTAINER/org.eclipse.jdt.internal.debug.ui.launcher.StandardVMType/JavaSE-1.6"/>
  <classpathentry kind="con" path="org.eclipse.jst.server.core.container/org.eclipse.jst.server.tomcat.runtimeTarget/Apache Tomcat v7.0"/>
  <classpathentry kind="con" path="org.eclipse.jst.j2ee.internal.web.container"/>
  <classpathentry kind="con" path="org.eclipse.jst.j2ee.internal.module.container"/>
  <classpathentry kind="con" path="org.eclipse.jdt.junit.JUNIT_CONTAINER/4"/>
  <classpathentry kind="lib" path="/common/lib/commons-lang.jar"/>
  <classpathentry kind="output" path="build/classes"/>
</classpath>`

const keplerComponent = `<?xml version="1.0" encoding="UTF-8"?>
<project-modules id="moduleCoreId" project-version="1.5.0"><wb-module deploy-name="billing">
  <wb-resource deploy-path="/" source-path="/WebRoot"/>
  <wb-resource deploy-path="/WEB-INF/classes" source-path="/src"/>
  <dependent-module archiveName="common.jar" deploy-path="/WEB-INF/lib" handle="module:/resource/common/common"/>
</wb-module></project-modules>`

func keplerWorkspace(t *testing.T) (root, tomcat string) {
	t.Helper()
	root = t.TempDir()
	billing := filepath.Join(root, "billing")
	write(t, filepath.Join(billing, ".project"), keplerWebProject)
	write(t, filepath.Join(billing, ".classpath"), keplerWebClasspath)
	write(t, filepath.Join(billing, ".settings", "org.eclipse.wst.common.component"), keplerComponent)
	write(t, filepath.Join(billing, ".settings", "org.eclipse.jdt.core.prefs"), "org.eclipse.jdt.core.compiler.compliance=1.6\n")
	write(t, filepath.Join(billing, "src", "com", "acme", "Tool.java"), "package com.acme;\npublic class Tool { public static void main(String[] args) {} }\n")
	write(t, filepath.Join(billing, "WebRoot", "WEB-INF", "lib", "struts.jar"), "")
	write(t, filepath.Join(billing, "build.xml"), `<project name="billing" default="war"><target name="war"/></project>`)
	common := filepath.Join(root, "common")
	write(t, filepath.Join(common, ".project"), `<projectDescription><name>common</name><natures><nature>org.eclipse.jdt.core.javanature</nature></natures></projectDescription>`)
	write(t, filepath.Join(common, ".classpath"), `<classpath><classpathentry kind="src" path="src"/><classpathentry kind="output" path="bin"/></classpath>`)
	write(t, filepath.Join(common, "src", "Util.java"), "class Util {}")
	write(t, filepath.Join(common, "lib", "commons-lang.jar"), "")
	tomcat = fakeTomcat(t, "7.0.47")
	write(t, filepath.Join(tomcat, "lib", "servlet-api.jar"), "")
	write(t, filepath.Join(tomcat, "lib", "jsp-api.jar"), "")
	return root, tomcat
}

func TestEclipseWebProjectsGetTheirWTPContainersAsJars(t *testing.T) {
	root, tomcat := keplerWorkspace(t)
	if !HasEclipseWebProjects(root) || HasEclipseWebProjects(filepath.Join(root, "common")) {
		t.Fatal("only a folder with WTP projects needs the shadow")
	}
	dest := t.TempDir()
	shadow, err := WriteEclipseShadowWorkspace(root, dest, tomcat)
	if err != nil || len(shadow.Problems) != 0 || strings.Join(shadow.Projects, ",") != "billing,common" {
		t.Fatalf("shadow = %+v, %v", shadow, err)
	}
	classpath, err := os.ReadFile(filepath.Join(dest, "billing", ".classpath"))
	if err != nil {
		t.Fatal(err)
	}
	text := filepath.ToSlash(string(classpath))
	for _, want := range []string{
		"servlet-api.jar", "jsp-api.jar", "WebRoot/WEB-INF/lib/struts.jar", "common/lib/commons-lang.jar",
		`path="/common"`, "org.eclipse.jdt.junit.JUNIT_CONTAINER/4", "JRE_CONTAINER",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("the shadow classpath misses %s:\n%s", want, text)
		}
	}
	if strings.Contains(text, "org.eclipse.jst.") {
		t.Errorf("WTP containers must be resolved, not kept:\n%s", text)
	}
	description, _ := os.ReadFile(filepath.Join(dest, "billing", ".project"))
	if !strings.Contains(filepath.ToSlash(string(description)), filepath.ToSlash(filepath.Join(root, "billing", "src"))) {
		t.Errorf("the sources are linked, not copied:\n%s", description)
	}
	if !strings.Contains(text, `kind="output" path="output"`) || !strings.Contains(filepath.ToSlash(string(description)), filepath.ToSlash(filepath.Join(root, "billing", "build", "classes"))) {
		t.Errorf("JDT LS compiles into the project's own output, which Tomcat publishes:\n%s\n%s", text, description)
	}
	if info, err := os.Stat(filepath.Join(root, "billing", "build", "classes")); err != nil || !info.IsDir() {
		t.Error("the declared output folder is created")
	}
	prefs, _ := os.ReadFile(filepath.Join(dest, "billing", ".settings", "org.eclipse.jdt.core.prefs"))
	if !strings.Contains(string(prefs), "compliance=1.8") {
		t.Errorf("Java 6 is checked at 1.8:\n%s", prefs)
	}
	if _, err := os.Stat(filepath.Join(root, "billing", ".classpath")); err != nil {
		t.Fatal("the real project is never touched")
	}
}

func TestEclipseShadowExplainsAMissingServerRuntime(t *testing.T) {
	root, _ := keplerWorkspace(t)
	t.Setenv("CATALINA_HOME", "")
	shadow, err := WriteEclipseShadowWorkspace(root, t.TempDir(), "")
	if err != nil || len(shadow.Problems) != 1 || !strings.Contains(shadow.Problems[0], "CATALINA_HOME") {
		t.Fatalf("shadow = %+v, %v", shadow, err)
	}
}

func TestAntProjectsProposeTheirMainClasses(t *testing.T) {
	root, _ := keplerWorkspace(t)
	module := filepath.Join(root, "billing")
	unit := project.Unit{Language: ID, Kind: UnitAnt, Root: module, Manifest: filepath.Join(module, "build.xml")}
	stubTools(t, "ant")
	t.Setenv("CATALINA_HOME", "")
	var mains []string
	for _, suggestion := range (&Language{}).Suggest(t.Context(), module, unit) {
		if suggestion.Configuration.Kind == KindMain {
			mains = append(mains, string(suggestion.Configuration.LanguageOptions))
		}
	}
	if len(mains) != 1 || !strings.Contains(mains[0], "com.acme.Tool") {
		t.Fatalf("mains = %v", mains)
	}
	if _, _, _, _, err := MainCommandWith(module, MainOptions{MainClass: "com.acme.Tool"}, nil); err == nil || !strings.Contains(err.Error(), "language server") {
		t.Fatalf("without JDT LS the error says what to wait for: %v", err)
	}
}

func TestTomcatAddsTheDependentModulesOfAWTPProject(t *testing.T) {
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	t.Setenv("LocalAppData", t.TempDir())
	root, tomcat := keplerWorkspace(t)
	write(t, filepath.Join(root, "billing", "build", "classes", "com", "acme", "Tool.class"), "")
	write(t, filepath.Join(root, "common", "bin", "Util.class"), "")
	launch, err := TomcatCommand(filepath.Join(root, "billing"), TomcatOptions{CatalinaHome: tomcat}, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	context, err := os.ReadFile(filepath.Join(envValue(launch.Spec.Environment, "CATALINA_BASE"), "conf", "Catalina", "localhost", "billing.xml"))
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(root, "billing", "build", "classes") + ";" + filepath.Join(root, "common", "bin")
	if !strings.Contains(string(context), `docBase="`+filepath.Join(root, "billing", "WebRoot")+`"`) || !strings.Contains(string(context), want) {
		t.Fatalf("context = %s", context)
	}
}
