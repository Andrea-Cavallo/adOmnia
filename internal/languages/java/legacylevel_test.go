package java

import (
	"path/filepath"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/lsp"
)

// A Java 6 Maven module: JDT's "no longer supported" error asks to raise that module, not the file.
func TestLegacyLevelRepairRaisesTheProjectToTheMinimumLevel(t *testing.T) {
	root := t.TempDir()
	module := filepath.Join(root, "core")
	writeTestFile(t, filepath.Join(module, "pom.xml"), "<project/>")
	file := filepath.Join(module, "src", "main", "java", "A.java")
	writeTestFile(t, file, "class A {}")
	unsupported := []lsp.Diagnostic{{Message: "Compiling for Java version '1.6' is no longer supported. Minimal supported version is '1.8'"}}

	repair, ok := legacyLevelRepair(lsp.FileURI(file), unsupported)
	if !ok || repair.Key != module || repair.Command != "java.project.updateSettings" || repair.Arguments[0] != lsp.FileURI(module) {
		t.Fatalf("repair = %+v, %v", repair, ok)
	}
	if options := repair.Arguments[1].(map[string]string); options["org.eclipse.jdt.core.compiler.compliance"] != "1.8" {
		t.Fatalf("options = %+v", options)
	}
	if _, ok := legacyLevelRepair(lsp.FileURI(file), []lsp.Diagnostic{{Message: "undefinedName cannot be resolved"}}); ok {
		t.Fatal("an ordinary error needs no repair")
	}
}
