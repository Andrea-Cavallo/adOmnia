package java

import (
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
)

func TestMavenCommandUsesReactorWrapperInSelectedModule(t *testing.T) {
	root := t.TempDir()
	module := filepath.Join(root, "rest-heroes")
	write(t, filepath.Join(module, "pom.xml"), "<project/>")
	wrapper := "mvnw"
	if runtime.GOOS == "windows" {
		wrapper += ".cmd"
	}
	write(t, filepath.Join(root, wrapper), "wrapper")
	write(t, filepath.Join(root, ".mvn", "wrapper", "maven-wrapper.properties"), "distributionUrl=unused")
	// No system Maven: this must find the ancestor wrapper.
	t.Setenv("PATH", t.TempDir())
	spec, err := New().CommandSpec(run.Request{Kind: KindMaven, Root: root, WorkingDirectory: module, ProgramArguments: []string{"clean", "package"}, Environment: []string{"JAVA_HOME=selected"}})
	if err != nil {
		t.Fatal(err)
	}
	if spec.Executable != filepath.Join(root, wrapper) || spec.WorkingDirectory != module || !reflect.DeepEqual(spec.Arguments, []string{"-B", "clean", "package"}) || !reflect.DeepEqual(spec.Environment, []string{"JAVA_HOME=selected"}) {
		t.Fatalf("%+v", spec)
	}
	if _, err = os.Stat(spec.Executable); err != nil {
		t.Fatal(err)
	}
	// Never borrow a wrapper outside the project boundary.
	_, err = New().CommandSpec(run.Request{Kind: KindMaven, Root: module, WorkingDirectory: module, ProgramArguments: []string{"clean"}})
	if err == nil {
		t.Fatal("used wrapper outside project")
	}
}
func TestMavenCommandRejectsNonPomFoldersAndUnknownGoals(t *testing.T) {
	root := t.TempDir()
	for _, args := range [][]string{nil, {"clean"}, {"package", ";echo"}} {
		if _, err := New().CommandSpec(run.Request{Kind: KindMaven, Root: root, WorkingDirectory: root, ProgramArguments: args}); err == nil {
			t.Fatal("accepted non-Maven folder")
		}
	}
	write(t, filepath.Join(root, "pom.xml"), "<project/>")
	if _, err := New().CommandSpec(run.Request{Kind: KindMaven, Root: root, WorkingDirectory: root, ProgramArguments: []string{"--file=other"}}); err == nil {
		t.Fatal("accepted arbitrary goal")
	}
}
