package eclipsepde

import (
	"strings"
	"testing"
)

const editManifest = `Manifest-Version: 1.0
Bundle-ManifestVersion: 2
Bundle-SymbolicName: com.acme.core
Bundle-Version: 1.0.0
Import-Package: javax.swing,
 org.w3c.dom

Name: section/entry.txt
Content-Type: text/plain
`

func TestSetManifestHeaderReplacesAndFolds(t *testing.T) {
	edited, changed, err := SetManifestHeader([]byte(editManifest), "Import-Package", "javax.swing,org.w3c.dom,com.acme.core.api;version=\"[1.0.0,2.0.0)\"")
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("the header changed")
	}
	text := string(edited)
	for _, line := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		if len(line) > maxManifestLineBytes {
			t.Fatalf("line longer than the manifest limit: %q", line)
		}
	}
	manifest, err := ParseManifest(edited)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(manifest.Main["Import-Package"], "com.acme.core.api") {
		t.Fatalf("import = %q", manifest.Main["Import-Package"])
	}
	// The entry section and the other headers survive.
	if manifest.Sections["section/entry.txt"]["Content-Type"] != "text/plain" {
		t.Fatalf("sections = %+v", manifest.Sections)
	}
	if manifest.Main["Bundle-SymbolicName"] != "com.acme.core" {
		t.Fatalf("main = %+v", manifest.Main)
	}
}

func TestSetManifestHeaderAddsAndRemoves(t *testing.T) {
	added, changed, err := SetManifestHeader([]byte(editManifest), "Require-Bundle", "com.acme.core;bundle-version=\"[1.0.0,2.0.0)\"")
	if err != nil || !changed {
		t.Fatalf("err = %v changed = %v", err, changed)
	}
	manifest, err := ParseManifest(added)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.Main["Require-Bundle"] != "com.acme.core;bundle-version=\"[1.0.0,2.0.0)\"" {
		t.Fatalf("require = %q", manifest.Main["Require-Bundle"])
	}

	removed, changed, err := SetManifestHeader(added, "Require-Bundle", "")
	if err != nil || !changed {
		t.Fatalf("err = %v changed = %v", err, changed)
	}
	manifest, err = ParseManifest(removed)
	if err != nil {
		t.Fatal(err)
	}
	if _, exists := manifest.Main["Require-Bundle"]; exists {
		t.Fatal("the header was not removed")
	}
	if _, changed, err := SetManifestHeader(removed, "Require-Bundle", ""); err != nil || changed {
		t.Fatalf("removing an absent header must be a no-op: %v %v", err, changed)
	}
}

func TestAddManifestRequirementSkipsExisting(t *testing.T) {
	edited, added, err := AddManifestRequirement([]byte(editManifest), "import-package", "javax.servlet", "[2.5.0,3.0.0)")
	if err != nil || !added {
		t.Fatalf("err = %v added = %v", err, added)
	}
	manifest, err := ParseManifest(edited)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(manifest.Main["Import-Package"], "javax.servlet;version=\"[2.5.0,3.0.0)\"") {
		t.Fatalf("import = %q", manifest.Main["Import-Package"])
	}
	if _, added, err := AddManifestRequirement(edited, "Import-Package", "javax.servlet", ""); err != nil || added {
		t.Fatalf("an existing clause must not be duplicated: %v %v", err, added)
	}
	if _, _, err := AddManifestRequirement([]byte(editManifest), "unknown", "x", ""); err == nil {
		t.Fatal("an unknown kind must fail")
	}
}

func TestSetManifestHeaderKeepsCRLFAndRejectsMalformed(t *testing.T) {
	crlf := strings.ReplaceAll(editManifest, "\n", "\r\n")
	edited, _, err := SetManifestHeader([]byte(crlf), "Bundle-Vendor", "ACME")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(edited), "\r\n") {
		t.Fatal("the CRLF style was not preserved")
	}
	if _, _, err := SetManifestHeader([]byte("not a manifest\n"), "Bundle-Vendor", "ACME"); err == nil {
		t.Fatal("a malformed manifest must not be edited")
	}
	if _, _, err := SetManifestHeader([]byte(editManifest), "Bad:Name", "x"); err == nil {
		t.Fatal("a header name with ':' must fail")
	}
	if _, _, err := SetManifestHeader([]byte(editManifest), "Manifest-Version", ""); err == nil {
		t.Fatal("Manifest-Version cannot be removed")
	}
}
