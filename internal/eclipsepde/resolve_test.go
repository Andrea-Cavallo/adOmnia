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

func TestResolverWarnsAboutAnOlderSingleton(t *testing.T) {
	idx := indexWith(t,
		"Bundle-SymbolicName: s;singleton:=true\nBundle-Version: 1.0.0\n",
		"Bundle-SymbolicName: s;singleton:=true\nBundle-Version: 2.0.0\n",
	)
	root, err := ParseBundle([]byte("Bundle-SymbolicName: app\nBundle-Version: 1.0.0\nRequire-Bundle: s;bundle-version=\"[1,2)\"\n"), "app")
	if err != nil {
		t.Fatal(err)
	}
	res := NewResolver(idx).Resolve(&IndexedBundle{Bundle: root, Source: SourceWorkspace}).Root
	if res.Status != StatusWarning || len(res.Notes) != 1 || !strings.Contains(res.Notes[0], "selects s 2.0.0") {
		t.Fatalf("resolution = %+v", res)
	}
}

func TestResolverChecksTheExecutionEnvironment(t *testing.T) {
	idx := indexWith(t, "Bundle-SymbolicName: lib\nBundle-Version: 1.0.0\n")
	for _, tc := range []struct {
		target, required string
		resolved         bool
	}{
		{"JavaSE-1.6", "JavaSE-1.7", false},
		{"JavaSE-1.6", "J2SE-1.5", true},
		{"JavaSE-1.6", "JavaSE-1.7,J2SE-1.4", true},
		{"JavaSE-1.6", "CDC-1.1/Foundation-1.1", false},
		{"JavaSE-11", "JavaSE-1.8", true},
		{"JavaSE-1.8", "JavaSE/compact1-1.8", true},
		{"", "JavaSE-17", true},
	} {
		root, err := ParseBundle([]byte("Bundle-SymbolicName: app\nBundle-Version: 1.0.0\nBundle-RequiredExecutionEnvironment: "+tc.required+"\n"), "app")
		if err != nil {
			t.Fatal(err)
		}
		resolver := NewResolver(idx)
		resolver.ExecutionEnvironment = tc.target
		if got := resolver.Resolve(&IndexedBundle{Bundle: root}).Root.Status != StatusUnresolved; got != tc.resolved {
			t.Errorf("%s on %s: resolved = %v", tc.required, tc.target, got)
		}
	}
}

func TestResolverMatchesImportAttributesAndFragmentExports(t *testing.T) {
	idx := indexWith(t,
		"Bundle-SymbolicName: p1\nBundle-Version: 1.0.0\nExport-Package: x;version=\"1.0\";vendor=acme\n",
		"Bundle-SymbolicName: p2\nBundle-Version: 2.0.0\nExport-Package: x;version=\"2.0\"\n",
		"Bundle-SymbolicName: m\nBundle-Version: 1.0.0\nExport-Package: y;secret=yes;mandatory:=secret\n",
		"Bundle-SymbolicName: host\nBundle-Version: 1.0.0\n",
		"Bundle-SymbolicName: frag\nBundle-Version: 1.0.0\nFragment-Host: host\nExport-Package: frag.api\n",
	)
	wired := func(imports string) string {
		root, err := ParseBundle([]byte("Bundle-SymbolicName: app\nBundle-Version: 1.0.0\nImport-Package: "+imports+"\n"), "app")
		if err != nil {
			t.Fatal(err)
		}
		res := NewResolver(idx).Resolve(&IndexedBundle{Bundle: root}).Root
		if len(res.Wires) == 0 {
			return "unresolved"
		}
		return res.Wires[0].Provider
	}
	cases := []struct{ imports, want string }{
		{"x", "p2"},
		{"x;bundle-symbolic-name=p1", "p1"},
		{"x;bundle-version=\"[1,2)\"", "p1"},
		{"x;vendor=acme", "p1"},
		{"y", "unresolved"},
		{"y;secret=yes", "m"},
		{"frag.api", "host"},
	}
	for _, tc := range cases {
		if got := wired(tc.imports); got != tc.want {
			t.Errorf("Import-Package: %s wired to %s, want %s", tc.imports, got, tc.want)
		}
	}
}
