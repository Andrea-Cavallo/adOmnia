package eclipsepde

import (
	"strings"
	"testing"
)

func indexWith(t *testing.T, manifests ...string) *BundleIndex {
	t.Helper()
	idx := NewBundleIndex()
	for i, mf := range manifests {
		b, err := ParseBundle([]byte(mf), "loc"+string(rune('a'+i)))
		if err != nil {
			t.Fatal(err)
		}
		idx.Add(&IndexedBundle{Bundle: b, Source: SourceTarget})
	}
	return idx
}

func TestResolveSatisfiedRequirements(t *testing.T) {
	idx := indexWith(t,
		"Bundle-SymbolicName: it.company.core\nBundle-Version: 2.1.0\nExport-Package: it.company.core.api;version=\"2.1.0\"\n",
		"Bundle-SymbolicName: org.slf4j\nBundle-Version: 1.6.1\nExport-Package: org.slf4j;version=\"1.6.1\"\n",
	)
	root, err := ParseBundle([]byte(
		"Bundle-SymbolicName: it.company.app\nBundle-Version: 1.0.0\n"+
			"Require-Bundle: it.company.core;bundle-version=\"[2.0.0,3.0.0)\"\n"+
			"Import-Package: org.slf4j;version=\"[1.6,2.0)\"\n"), "app")
	if err != nil {
		t.Fatal(err)
	}
	res := NewResolver(idx).Resolve(&IndexedBundle{Bundle: root, Source: SourceWorkspace, Exploded: true})
	if res.Root.Status != StatusResolved {
		t.Fatalf("status = %s, missing=%v notes=%v", res.Root.Status, res.Root.Missing, res.Root.Notes)
	}
	// Require-Bundle is a transitive edge: core is in the resolution.
	if _, ok := res.Transitive["it.company.core 2.1.0"]; !ok {
		t.Errorf("transitive = %v", keysOf(res.Transitive))
	}
}

func TestResolveMissingBundleExplainsChain(t *testing.T) {
	idx := indexWith(t,
		"Bundle-SymbolicName: it.company.core\nBundle-Version: 2.1.0\nRequire-Bundle: it.company.auth;bundle-version=\"[2.0.0,3.0.0)\"\n",
		"Bundle-SymbolicName: it.company.auth\nBundle-Version: 1.5.0\n",
	)
	root, err := ParseBundle([]byte(
		"Bundle-SymbolicName: it.company.application\nBundle-Version: 1.0.0\n"+
			"Require-Bundle: it.company.core;bundle-version=\"[2.0.0,3.0.0)\"\n"), "app")
	if err != nil {
		t.Fatal(err)
	}
	res := NewResolver(idx).Resolve(&IndexedBundle{Bundle: root, Source: SourceWorkspace, Exploded: true})

	// The root is resolved at its own level but notes the transitive failure;
	// the failing bundle (core) is Unresolved with the full diagnostic.
	core := res.Transitive["it.company.core 2.1.0"]
	if core == nil || core.Status != StatusUnresolved {
		t.Fatalf("core resolution = %+v", core)
	}
	if len(core.Missing) != 1 {
		t.Fatalf("missing = %+v", core.Missing)
	}
	m := core.Missing[0]
	if m.Requirement.Name != "it.company.auth" || m.Requirement.Kind != "Require-Bundle" {
		t.Errorf("requirement = %+v", m.Requirement)
	}
	if strings.Join(m.Available, ",") != "1.5.0" {
		t.Errorf("available = %v", m.Available)
	}
	if strings.Join(m.Chain, " → ") != "it.company.application 1.0.0 → it.company.core 2.1.0" {
		t.Errorf("chain = %v", m.Chain)
	}
	// The diagnostic block matches the spec example's shape.
	block := m.String()
	for _, want := range []string{"Require-Bundle: it.company.auth", "Required: [2.0.0,3.0.0)", "Available in target: 1.5.0", "Status: UNRESOLVED", "Chain:", "Action:"} {
		if !strings.Contains(block, want) {
			t.Errorf("diagnostic missing %q:\n%s", want, block)
		}
	}
	// The root carries the note pointing at the transitive failure.
	if len(res.Root.Notes) == 0 {
		t.Errorf("root notes = %v", res.Root.Notes)
	}
}

func TestResolveOptionalRequirementIsWarningOnly(t *testing.T) {
	idx := indexWith(t, "Bundle-SymbolicName: it.company.core\nBundle-Version: 1.0.0\n")
	root, err := ParseBundle([]byte(
		"Bundle-SymbolicName: it.company.app\nBundle-Version: 1.0.0\n"+
			"Require-Bundle: it.company.missing;resolution:=optional\n"), "app")
	if err != nil {
		t.Fatal(err)
	}
	res := NewResolver(idx).Resolve(&IndexedBundle{Bundle: root, Source: SourceWorkspace, Exploded: true})
	if res.Root.Status != StatusWarning {
		t.Errorf("status = %s, want Warning", res.Root.Status)
	}
	// The unsatisfied optional stays visible (flagged Optional) but does not
	// make the bundle Unresolved.
	if len(res.Root.Missing) != 1 || !res.Root.Missing[0].Requirement.Optional {
		t.Errorf("missing = %+v", res.Root.Missing)
	}
	if len(res.Root.Notes) == 0 {
		t.Error("expected a note for the unsatisfied optional requirement")
	}
}

func TestResolveFragmentAttachesToHost(t *testing.T) {
	idx := indexWith(t,
		"Bundle-SymbolicName: it.company.host\nBundle-Version: 1.0.0\n",
		"Bundle-SymbolicName: it.company.fragment\nBundle-Version: 1.0.0\nFragment-Host: it.company.host;bundle-version=\"[1.0,2.0)\"\n",
	)
	host := idx.ByName("it.company.host")[0]
	res := NewResolver(idx).Resolve(host)
	if res.Root.Status != StatusResolved {
		t.Errorf("status = %s", res.Root.Status)
	}

	// A fragment whose host is absent is unresolved with the host requirement.
	frag := idx.ByName("it.company.fragment")[0]
	bad := indexWith(t, "Bundle-SymbolicName: it.company.fragment\nBundle-Version: 1.0.0\nFragment-Host: it.company.absent\n")
	res2 := NewResolver(bad).Resolve(bad.ByName("it.company.fragment")[0])
	if frag == nil || res2.Root.Status != StatusUnresolved {
		t.Errorf("fragment without host = %+v", res2.Root.Status)
	}
	if res2.Root.Missing[0].Requirement.Kind != "Fragment-Host" {
		t.Errorf("missing = %+v", res2.Root.Missing)
	}
}

func TestResolveImportPackageVersionMismatch(t *testing.T) {
	idx := indexWith(t, "Bundle-SymbolicName: org.slf4j\nBundle-Version: 1.6.1\nExport-Package: org.slf4j;version=\"1.6.1\"\n")
	root, err := ParseBundle([]byte(
		"Bundle-SymbolicName: it.company.app\nBundle-Version: 1.0.0\n"+
			"Import-Package: org.slf4j;version=\"[2.0,3.0)\"\n"), "app")
	if err != nil {
		t.Fatal(err)
	}
	res := NewResolver(idx).Resolve(&IndexedBundle{Bundle: root, Source: SourceWorkspace, Exploded: true})
	if res.Root.Status != StatusUnresolved {
		t.Fatalf("status = %s", res.Root.Status)
	}
	m := res.Root.Missing[0]
	if m.Requirement.Kind != "Import-Package" || m.Requirement.Name != "org.slf4j" {
		t.Errorf("missing = %+v", m)
	}
	if strings.Join(m.Available, ",") != "1.6.1 (org.slf4j)" {
		t.Errorf("available = %v", m.Available)
	}
}

func keysOf(m map[string]*BundleResolution) []string {
	var out []string
	for k := range m {
		out = append(out, k)
	}
	return out
}
