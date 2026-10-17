package eclipsepde

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseTargetDefinition(t *testing.T) {
	data := `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<?pde version="3.8"?>
<target name="Eclipse Kepler Legacy" sequenceNumber="1">
  <locations>
    <location includeAllPlatforms="false" includeMode="planner" includeSource="true" type="InstallableUnit">
      <repository location="http://download.eclipse.org/releases/kepler"/>
      <unit id="org.eclipse.sdk.feature.group" version="4.3.0.v20130605-2000"/>
    </location>
    <location path="C:/development/eclipse-target" type="Directory"/>
    <location type="Feature">
      <feature id="com.company.custom" version="1.2.3"/>
    </location>
  </locations>
</target>`
	def, err := ParseTargetDefinition([]byte(data))
	if err != nil {
		t.Fatal(err)
	}
	if def.Name != "Eclipse Kepler Legacy" {
		t.Errorf("name = %q", def.Name)
	}
	if len(def.Locations) != 3 {
		t.Fatalf("locations = %+v", def.Locations)
	}
	if def.Locations[0].Kind != "InstallableUnit" || def.Locations[0].ID != "org.eclipse.sdk.feature.group" {
		t.Errorf("loc0 = %+v", def.Locations[0])
	}
	if def.Locations[1].Kind != "Directory" || !strings.Contains(def.Locations[1].Path, "eclipse-target") {
		t.Errorf("loc1 = %+v", def.Locations[1])
	}
	if def.Locations[2].Kind != "Feature" || def.Locations[2].Version != "1.2.3" {
		t.Errorf("loc2 = %+v", def.Locations[2])
	}
	dirs := def.DirectoryLocations()
	if len(dirs) != 1 {
		t.Errorf("DirectoryLocations = %v", dirs)
	}
}

func TestReadTargetDefinitionAndErrors(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "custom.target")
	if err := os.WriteFile(path, []byte(`<target name="T"><locations><location path="p" type="Directory"/></locations></target>`), 0o644); err != nil {
		t.Fatal(err)
	}
	def, err := ReadTargetDefinition(path)
	if err != nil {
		t.Fatal(err)
	}
	if def.Name != "T" || len(def.Locations) != 1 {
		t.Errorf("def = %+v", def)
	}
	if _, err := ReadTargetDefinition(filepath.Join(dir, "missing.target")); err == nil {
		t.Error("missing file should fail")
	}
	if err := os.WriteFile(filepath.Join(dir, "bad.target"), []byte("not xml"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadTargetDefinition(filepath.Join(dir, "bad.target")); err == nil {
		t.Error("malformed .target should fail")
	}
}
