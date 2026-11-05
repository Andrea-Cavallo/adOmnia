package java

import (
	"os"
	"path/filepath"
	"testing"
)

// An OSGi/PDE workspace is not something JDT LS can model: the adapter must ask the host to leave
// it stopped instead of filling Problems with "Java 1.6 is no longer supported" for every bundle.
func TestServerIsBlockedOnAnOsgiWorkspace(t *testing.T) {
	root := t.TempDir()
	bundle := filepath.Join(root, "plugins", "com.acme.core")
	writeTestFile(t, filepath.Join(bundle, ".project"), `<?xml version="1.0"?>
<projectDescription>
  <name>com.acme.core</name>
  <buildSpec/>
  <natures><nature>org.eclipse.pde.PluginNature</nature></natures>
</projectDescription>`)
	writeTestFile(t, filepath.Join(bundle, "META-INF", "MANIFEST.MF"), "Manifest-Version: 1.0\nBundle-ManifestVersion: 2\nBundle-SymbolicName: com.acme.core\nBundle-Version: 1.0.0\n")

	language := &Language{}
	if reason := language.ServerBlocked(root); reason == "" {
		t.Fatal("a Tycho/PDE workspace must block the Java language server")
	}
	if reason := language.ServerBlocked(t.TempDir()); reason != "" {
		t.Fatalf("a folder without bundles must keep the language server: %q", reason)
	}
}

// Outside OSGi the same upstream limit applies: a Maven project that declares Java 6 must not be
// given a language server that would report its own compiler as unsupported.
func TestServerIsBlockedOnAPlainLegacyProject(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, "pom.xml"), `<project><properties>
  <maven.compiler.source>1.6</maven.compiler.source>
  <maven.compiler.target>1.6</maven.compiler.target>
</properties></project>`)
	language := &Language{}
	if reason := language.ServerBlocked(root); reason == "" {
		t.Fatal("a Maven project at Java 1.6 must block a language server that supports only 1.8+")
	}

	modern := t.TempDir()
	writeTestFile(t, filepath.Join(modern, "pom.xml"), `<project><properties><maven.compiler.release>17</maven.compiler.release></properties></project>`)
	if reason := language.ServerBlocked(modern); reason != "" {
		t.Fatalf("a Java 17 project keeps the language server: %q", reason)
	}

	java8 := t.TempDir()
	writeTestFile(t, filepath.Join(java8, "pom.xml"), `<project><properties><maven.compiler.source>1.8</maven.compiler.source></properties></project>`)
	if reason := language.ServerBlocked(java8); reason != "" {
		t.Fatalf("Java 1.8 is supported by JDT LS: %q", reason)
	}
}

func writeTestFile(t *testing.T, path, text string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}
