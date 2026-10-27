package gomod

import (
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/securityintel"
)

func TestUpgradeManifestUpdatesTheRequireLine(t *testing.T) {
	before := "module example.com/app\n\ngo 1.22\n\nrequire (\n\texample.com/lib v1.2.3 // indirect\n)\n"
	component := securityintel.Component{Ecosystem: securityintel.EcosystemGo, Name: "example.com/lib", Version: "1.2.3"}
	after, err := New().UpgradeManifest(before, component, "1.2.4")
	if err != nil {
		t.Fatalf("UpgradeManifest: %v", err)
	}
	if !strings.Contains(after, "example.com/lib v1.2.4 // indirect") {
		t.Fatalf("the require line is not updated (and the comment must survive):\n%s", after)
	}
	if strings.Contains(after, "v1.2.3") {
		t.Fatalf("the old version is still present:\n%s", after)
	}
}

func TestUpgradeManifestPinsATransitiveModule(t *testing.T) {
	before := "module example.com/app\n\ngo 1.22\n\nrequire example.com/direct v0.1.0\n"
	component := securityintel.Component{Ecosystem: securityintel.EcosystemGo, Name: "example.com/transitive", Version: "1.0.0"}
	after, err := New().UpgradeManifest(before, component, "1.1.0")
	if err != nil {
		t.Fatalf("UpgradeManifest: %v", err)
	}
	if !strings.Contains(after, "example.com/transitive v1.1.0") {
		t.Fatalf("the transitive module is not pinned:\n%s", after)
	}
}

func TestUpgradeManifestRefusesNonDependencyUpgrades(t *testing.T) {
	before := "module example.com/app\n\ngo 1.22\n"
	toolchain := securityintel.Component{
		Ecosystem: securityintel.EcosystemGo, Name: "std", Version: "1.22.0", Origin: securityintel.OriginToolchain,
	}
	if _, err := New().UpgradeManifest(before, toolchain, "1.23.0"); err == nil {
		t.Fatal("the toolchain cannot be upgraded as if it were a dependency")
	}
	replaced := securityintel.Component{
		Ecosystem: securityintel.EcosystemGo, Name: "example.com/lib", Version: "1.2.3", Replace: "example.com/fork",
	}
	if _, err := New().UpgradeManifest(before, replaced, "1.2.4"); err == nil {
		t.Fatal("a version set by replace must not be edited as a require")
	}
	if _, err := New().UpgradeManifest(before, securityintel.Component{Name: "example.com/lib"}, "not-a-version"); err == nil {
		t.Fatal("an invalid target version must be refused")
	}
}
