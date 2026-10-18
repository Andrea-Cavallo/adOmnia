package java

import "testing"

func TestJDTSettingsListJDKsAndMavenSettings(t *testing.T) {
	settings := jdtSettings([]JDK{{Home: "/j21", Major: 21}, {Home: "/j8", Major: 8}, {Home: "/j21b", Major: 21}, {Home: "", Major: 17}, {Home: "/old", Major: 5}}, "/home/me/.m2/settings.xml")
	configuration := settings["java"].(map[string]any)["configuration"].(map[string]any)
	runtimes := configuration["runtimes"].([]map[string]any)
	if len(runtimes) != 2 || runtimes[0]["name"] != "JavaSE-21" || runtimes[0]["path"] != "/j21" || runtimes[1]["name"] != "JavaSE-1.8" {
		t.Fatalf("runtimes = %+v", runtimes)
	}
	if configuration["maven"].(map[string]any)["userSettings"] != "/home/me/.m2/settings.xml" {
		t.Fatalf("maven = %+v", configuration["maven"])
	}
	empty := jdtSettings(nil, "")["java"].(map[string]any)["configuration"].(map[string]any)
	if len(empty) != 0 {
		t.Fatalf("nothing known, nothing sent: %+v", empty)
	}
}
