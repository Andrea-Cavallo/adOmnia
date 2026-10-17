package eclipsepde

import (
	"strings"
	"testing"
)

func TestParseManifestUnfoldsWrappedLines(t *testing.T) {
	data := "Manifest-Version: 1.0\nBundle-ManifestVersion: 2\nBundle-Name: Exam\n ple Bundle\nBundle-SymbolicName: com.example.bundle\n"
	mf, err := ParseManifest([]byte(data))
	if err != nil {
		t.Fatal(err)
	}
	if got := mf.Main["Bundle-Name"]; got != "Example Bundle" {
		t.Errorf("Bundle-Name = %q", got)
	}
	if got := mf.Order; strings.Join(got, ",") != "Manifest-Version,Bundle-ManifestVersion,Bundle-Name,Bundle-SymbolicName" {
		t.Errorf("Order = %v", got)
	}
}

func TestParseManifestEntrySections(t *testing.T) {
	data := "Manifest-Version: 1.0\n\nName: lib/extra.jar\nSealed: true\n"
	mf, err := ParseManifest([]byte(data))
	if err != nil {
		t.Fatal(err)
	}
	if sec, ok := mf.Sections["lib/extra.jar"]; !ok || sec["Sealed"] != "true" {
		t.Errorf("Sections = %v", mf.Sections)
	}
}

func TestParseManifestRejectsGarbage(t *testing.T) {
	if _, err := ParseManifest([]byte("this line has no colon\n")); err == nil {
		t.Error("expected error for malformed line")
	}
	if _, err := ParseManifest([]byte("Name: a\nName: b\n")); err == nil {
		t.Error("expected error for duplicate header")
	}
	if _, err := ParseManifest([]byte("\nName: \nSealed: true\n")); err == nil {
		t.Error("expected error for section without entry name")
	}
}

func TestParseClauseList(t *testing.T) {
	clauses, err := ParseClauseList(`com.acme.util;bundle-version="[2.0.0,3.0.0)";resolution:=optional, com.acme.other`)
	if err != nil {
		t.Fatal(err)
	}
	if len(clauses) != 2 {
		t.Fatalf("got %d clauses", len(clauses))
	}
	c := clauses[0]
	if c.Name != "com.acme.util" {
		t.Errorf("Name = %q", c.Name)
	}
	r, ok, err := c.VersionRangeOf("bundle-version")
	if err != nil || !ok {
		t.Fatalf("VersionRangeOf: ok=%v err=%v", ok, err)
	}
	if r.String() != "[2.0.0,3.0.0)" {
		t.Errorf("range = %q", r.String())
	}
	if !c.IsOptional() {
		t.Error("clause should be optional")
	}
	if clauses[1].Name != "com.acme.other" {
		t.Errorf("second clause = %+v", clauses[1])
	}
}

func TestParseClauseListQuotedSeparators(t *testing.T) {
	clauses, err := ParseClauseList(`org.example.api;version="[1.0,2.0)";uses:="a.b,c.d;e.f"`)
	if err != nil {
		t.Fatal(err)
	}
	if len(clauses) != 1 {
		t.Fatalf("quoted commas/semicolons split the clause: %+v", clauses)
	}
	if got := clauses[0].Directives["uses"]; got != "a.b,c.d;e.f" {
		t.Errorf("uses = %q", got)
	}
}

func TestParseBundle(t *testing.T) {
	data := "" +
		"Manifest-Version: 1.0\n" +
		"Bundle-ManifestVersion: 2\n" +
		"Bundle-SymbolicName: com.example.app;singleton:=true\n" +
		"Bundle-Version: 1.4.2\n" +
		"Bundle-RequiredExecutionEnvironment: JavaSE-1.6\n" +
		"Require-Bundle: com.example.core;bundle-version=\"[2.0.0,3.0.0)\";visibility:=reexport,\n" +
		" com.example.optional;resolution:=optional\n" +
		"Import-Package: org.slf4j;version=\"[1.6,2.0)\"\n" +
		"Export-Package: com.example.api;version=\"1.4.2\";uses:=\"com.example.spi\"\n" +
		"Bundle-ClassPath: .,lib/legacy.jar\n"
	b, err := ParseBundle([]byte(data), "/tmp/com.example.app")
	if err != nil {
		t.Fatal(err)
	}
	if b.SymbolicName != "com.example.app" || !b.Singleton {
		t.Errorf("identity = %q singleton=%v", b.SymbolicName, b.Singleton)
	}
	if b.Version.String() != "1.4.2" {
		t.Errorf("version = %s", b.Version)
	}
	if b.ExecutionEnvironment != "JavaSE-1.6" {
		t.Errorf("EE = %q", b.ExecutionEnvironment)
	}
	if len(b.RequireBundle) != 2 {
		t.Fatalf("Require-Bundle = %+v", b.RequireBundle)
	}
	if !b.RequireBundle[0].IsReexport() || !b.RequireBundle[1].IsOptional() {
		t.Errorf("directives = %+v", b.RequireBundle)
	}
	if len(b.ImportPackage) != 1 || b.ImportPackage[0].Name != "org.slf4j" {
		t.Errorf("Import-Package = %+v", b.ImportPackage)
	}
	if len(b.ExportPackage) != 1 || b.ExportPackage[0].Attributes["version"] != "1.4.2" {
		t.Errorf("Export-Package = %+v", b.ExportPackage)
	}
	if strings.Join(b.BundleClassPath, ",") != ".,lib/legacy.jar" {
		t.Errorf("Bundle-ClassPath = %v", b.BundleClassPath)
	}
	if b.FragmentHost != nil {
		t.Errorf("FragmentHost should be nil, got %+v", b.FragmentHost)
	}
}

func TestParseBundleFragmentHost(t *testing.T) {
	data := "Bundle-SymbolicName: com.example.fragment\nFragment-Host: com.example.host;bundle-version=\"[1.0,2.0)\"\n"
	b, err := ParseBundle([]byte(data), "loc")
	if err != nil {
		t.Fatal(err)
	}
	if b.FragmentHost == nil || b.FragmentHost.Name != "com.example.host" {
		t.Fatalf("FragmentHost = %+v", b.FragmentHost)
	}
}

func TestParseBundleRejectsMissingIdentity(t *testing.T) {
	if _, err := ParseBundle([]byte("Bundle-Name: no identity\n"), "loc"); err == nil {
		t.Error("expected error without Bundle-SymbolicName")
	}
	if _, err := ParseBundle([]byte("Bundle-SymbolicName: a, b\n"), "loc"); err == nil {
		t.Error("expected error for multi-clause Bundle-SymbolicName")
	}
}
