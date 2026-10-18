package java

import (
	"fmt"
	"os"
	"path/filepath"
)

// jdtSettings sono le impostazioni che JDT LS legge con workspace/configuration: i JDK installati (così un progetto
// con `release 17` si compila con il 17 anche se JDT LS gira su un JDK più nuovo) e il settings.xml di Maven
// dell'utente (repository private, mirror, proxy), come nel terminale.
func jdtSettings(installed []JDK, userSettings string) map[string]any {
	var runtimes []map[string]any
	seen := map[string]bool{}
	for _, jdk := range installed {
		name := javaSEName(jdk.Major)
		if name == "" || seen[name] || jdk.Home == "" {
			continue
		}
		seen[name] = true
		runtimes = append(runtimes, map[string]any{"name": name, "path": jdk.Home})
	}
	configuration := map[string]any{}
	if len(runtimes) > 0 {
		configuration["runtimes"] = runtimes
	}
	if userSettings != "" {
		configuration["maven"] = map[string]any{"userSettings": userSettings}
	}
	return map[string]any{"java": map[string]any{"configuration": configuration}}
}

// javaSEName è il nome di execution environment di JDT: JavaSE-1.8 per Java 8, JavaSE-17 dal 9 in poi.
func javaSEName(major int) string {
	switch {
	case major == 8:
		return "JavaSE-1.8"
	case major >= 9:
		return fmt.Sprintf("JavaSE-%d", major)
	}
	return ""
}

// mavenUserSettings è ~/.m2/settings.xml se esiste.
func mavenUserSettings() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	path := filepath.Join(home, ".m2", "settings.xml")
	if isFile(path) {
		return path
	}
	return ""
}
