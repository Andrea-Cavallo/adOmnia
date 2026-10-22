package java

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// jdtSettings sono le impostazioni che JDT LS legge con workspace/configuration: i JDK installati (cosÃ¬ un progetto
// con `release 17` si compila con il 17 anche se JDT LS gira su un JDK piÃ¹ nuovo) e il settings.xml di Maven
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

// JDTSettings sono le impostazioni di produzione di JDT LS: servono anche ai test di integrazione,
// che devono vedere il server come lo vede l'utente (JDK installati compresi).
func JDTSettings() map[string]any { return JDTSettingsFor("") }

// JDTSettingsFor Ã¨ JDTSettings per un progetto: il JDK scelto per il progetto (`.adomnia/java.local.json`)
// viene prima degli altri installati, cosÃ¬ JDT compila con la stessa toolchain di Run, Debug e Test.
func JDTSettingsFor(root string) map[string]any {
	installed := DiscoverJDKs()
	if home := ProjectJavaHome(root); home != "" {
		installed = append([]JDK{{Available: true, Binary: filepath.Join(home, "bin", "java"), Home: home, Source: "project", Version: releaseVersion(home), Major: Major(releaseVersion(home))}}, installed...)
	}
	return jdtSettings(installed, mavenUserSettings())
}

// ProjectJavaSettingsFile tiene il JDK scelto per il progetto: Run, Debug, Test e JDT LS lo usano
// allo stesso modo. Sta in .adomnia/ come le run configuration, ma non Ã¨ condiviso via Git: il
// percorso Ã¨ di questa macchina.
const ProjectJavaSettingsFile = ".adomnia/java.local.json"

type projectJavaSettings struct {
	JavaHome string `json:"javaHome"`
}

// ProjectJavaHome Ã¨ il JDK scelto per il progetto, "" se non c'Ã¨ una scelta valida.
func ProjectJavaHome(root string) string {
	var settings projectJavaSettings
	data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(ProjectJavaSettingsFile)))
	if err != nil {
		return ""
	}
	_ = json.Unmarshal(data, &settings)
	if ValidJavaHome(settings.JavaHome) {
		return settings.JavaHome
	}
	return ""
}

// SetProjectJavaHome sceglie il JDK del progetto; una stringa vuota torna al JDK di sistema.
func SetProjectJavaHome(root, home string) error {
	if home != "" && !ValidJavaHome(home) {
		return fmt.Errorf("%q is not a JDK folder: it must contain bin/java", home)
	}
	path := filepath.Join(root, filepath.FromSlash(ProjectJavaSettingsFile))
	if home == "" {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	data, err := json.MarshalIndent(projectJavaSettings{JavaHome: home}, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o644)
}

// javaSEName Ã¨ il nome di execution environment di JDT: JavaSE-1.8 per Java 8, JavaSE-17 dal 9 in poi.
func javaSEName(major int) string {
	switch {
	case major == 8:
		return "JavaSE-1.8"
	case major >= 9:
		return fmt.Sprintf("JavaSE-%d", major)
	}
	return ""
}

// mavenUserSettings Ã¨ ~/.m2/settings.xml se esiste.
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
