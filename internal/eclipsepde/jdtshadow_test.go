package eclipsepde

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestShadowWorkspaceLinksSourcesAndTheTargetForJDTLS(t *testing.T) {
	root, target := keplerWorkspace(t)
	dest := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dest, "gone"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dest, "gone", ".project"), []byte("<x/>"), 0o644); err != nil {
		t.Fatal(err)
	}
	shadow, err := WriteShadowWorkspace(root, dest)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(shadow.Projects, ",") != "app,core" {
		t.Fatalf("projects = %v", shadow.Projects)
	}
	read := func(parts ...string) string {
		data, err := os.ReadFile(filepath.Join(append([]string{dest}, parts...)...))
		if err != nil {
			t.Fatal(err)
		}
		return string(data)
	}
	project := read("app", ".project")
	if !strings.Contains(project, "<location>"+filepath.ToSlash(filepath.Join(root, "app", "src"))+"</location>") || strings.Contains(project, "pde") {
		t.Fatalf(".project must link the real sources and carry no PDE nature:\n%s", project)
	}
	classpath := read("app", ".classpath")
	for _, want := range []string{`path="/core"`, filepath.ToSlash(filepath.Join(target, "plugins", "org.eclipse.swt_3.102.jar"))} {
		if !strings.Contains(classpath, want) {
			t.Fatalf(".classpath misses %s:\n%s", want, classpath)
		}
	}
	if strings.Contains(classpath, "unrelated") {
		t.Fatalf("only what the manifest requires belongs on the classpath:\n%s", classpath)
	}
	if !strings.Contains(read("app", ".settings", "org.eclipse.jdt.core.prefs"), "compliance=1.8") {
		t.Fatal("a Java 6 bundle must be checked at 1.8, the lowest level JDT LS compiles")
	}
	if _, err := os.Stat(filepath.Join(dest, "gone")); !os.IsNotExist(err) {
		t.Fatal("a project of a bundle that is gone must be removed")
	}
	if _, err := os.Stat(filepath.Join(root, "app", ".adomnia")); err == nil {
		t.Fatal("the real project must not be written")
	}
}
