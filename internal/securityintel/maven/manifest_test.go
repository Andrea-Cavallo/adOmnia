package maven

import (
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/securityintel"
)

func TestUpgradeManifestUpdatesTheDeclaredVersion(t *testing.T) {
	before := `<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>org.example</groupId>
  <artifactId>app</artifactId>
  <version>1.0.0</version>
  <dependencies>
    <dependency>
      <groupId>org.example</groupId>
      <artifactId>lib</artifactId>
      <version>1.2.3</version>
    </dependency>
  </dependencies>
</project>
`
	component := securityintel.Component{Ecosystem: securityintel.EcosystemMaven, Name: "org.example:lib", Version: "1.2.3"}
	after, err := New().UpgradeManifest(before, component, "1.2.4")
	if err != nil {
		t.Fatalf("UpgradeManifest: %v", err)
	}
	if !strings.Contains(after, "<version>1.2.4</version>") || strings.Contains(after, "<version>1.2.3</version>") {
		t.Fatalf("the dependency version is not updated:\n%s", after)
	}
	// La versione del progetto non deve essere toccata.
	if !strings.Contains(after, "<artifactId>app</artifactId>\n  <version>1.0.0</version>") {
		t.Fatalf("the project version changed:\n%s", after)
	}
}

func TestUpgradeManifestUpdatesThePropertyInstead(t *testing.T) {
	before := `<project>
  <properties>
    <lib.version>1.2.3</lib.version>
  </properties>
  <dependencies>
    <dependency>
      <groupId>org.example</groupId>
      <artifactId>lib</artifactId>
      <version>${lib.version}</version>
    </dependency>
  </dependencies>
</project>
`
	component := securityintel.Component{Ecosystem: securityintel.EcosystemMaven, Name: "org.example:lib", Version: "1.2.3"}
	after, err := New().UpgradeManifest(before, component, "1.2.4")
	if err != nil {
		t.Fatalf("UpgradeManifest: %v", err)
	}
	if !strings.Contains(after, "<lib.version>1.2.4</lib.version>") {
		t.Fatalf("the property that drives the version is not updated:\n%s", after)
	}
	if !strings.Contains(after, "<version>${lib.version}</version>") {
		t.Fatalf("the indirection must be preserved:\n%s", after)
	}
}

func TestUpgradeManifestBlocksVersionsManagedElsewhere(t *testing.T) {
	component := securityintel.Component{Ecosystem: securityintel.EcosystemMaven, Name: "org.example:lib", Version: "1.2.3"}

	transitive := `<project><dependencies></dependencies></project>`
	if _, err := New().UpgradeManifest(transitive, component, "1.2.4"); err == nil ||
		!strings.Contains(err.Error(), "transitive") {
		t.Fatalf("a transitive dependency must be blocked with its reason, got %v", err)
	}

	managed := `<project>
  <dependencies>
    <dependency>
      <groupId>org.example</groupId>
      <artifactId>lib</artifactId>
    </dependency>
  </dependencies>
</project>
`
	if _, err := New().UpgradeManifest(managed, component, "1.2.4"); err == nil ||
		!strings.Contains(err.Error(), "managed") {
		t.Fatalf("a managed version must be blocked with its reason, got %v", err)
	}

	fromParent := `<project>
  <dependencies>
    <dependency>
      <groupId>org.example</groupId>
      <artifactId>lib</artifactId>
      <version>${parent.lib.version}</version>
    </dependency>
  </dependencies>
</project>
`
	if _, err := New().UpgradeManifest(fromParent, component, "1.2.4"); err == nil {
		t.Fatal("a version defined by a parent POM must be blocked")
	}
}

func TestUpgradeManifestRefusesToChangeTheProjectVersion(t *testing.T) {
	before := `<project>
  <version>1.2.3</version>
  <dependencies>
    <dependency>
      <groupId>org.example</groupId>
      <artifactId>lib</artifactId>
      <version>${project.version}</version>
    </dependency>
  </dependencies>
</project>
`
	component := securityintel.Component{Ecosystem: securityintel.EcosystemMaven, Name: "org.example:lib", Version: "1.2.3"}
	if _, err := New().UpgradeManifest(before, component, "2.0.0"); err == nil {
		t.Fatal("the project's own version must never be rewritten as a dependency fix")
	}
}
