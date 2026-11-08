package java

import (
	"encoding/json/v2"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

// The Tomcat a project uses is often not in CATALINA_HOME: a Kepler workspace registers it as a WTP server
// runtime, a team shares it in a Tomcat run configuration. discoverCatalinaHome finds it the same way for
// the Run configuration and for the servlet API of the language server.

const (
	sharedRunConfigurations = ".adomnia/run-configurations.json"
	wtpServerPrefs          = ".metadata/.plugins/org.eclipse.core.runtime/.settings/org.eclipse.wst.server.core.prefs"
	// discoveryParents is how far up from a module the project and the Eclipse workspace are looked for.
	discoveryParents = 3
)

// wtpRuntimeElement is a Tomcat runtime of org.eclipse.wst.server.core.prefs, a Java properties file
// holding XML (`location\="C\:\\apache-tomcat-7.0.47"` … `runtime-type-id\="org.eclipse.jst.server.tomcat.runtime.70"`).
var wtpRuntimeElement = regexp.MustCompile(`<runtime\b[^>]*>`)
var wtpAttribute = regexp.MustCompile(`([\w-]+)\\?="([^"]*)"`)

// discoverCatalinaHome is the first valid Tomcat among CATALINA_HOME, the shared Tomcat run configurations
// and the WTP server runtimes of the Eclipse workspace around start, and catalina on the PATH; "" if none.
func discoverCatalinaHome(start string) string {
	candidates := []string{os.Getenv("CATALINA_HOME")}
	for dir, level := filepath.Clean(start), 0; start != "" && level <= discoveryParents; dir, level = filepath.Dir(dir), level+1 {
		candidates = append(candidates, sharedTomcatHomes(filepath.Join(dir, filepath.FromSlash(sharedRunConfigurations)))...)
		candidates = append(candidates, eclipseServerRuntimes(filepath.Join(dir, filepath.FromSlash(wtpServerPrefs)), "tomcat")...)
		if filepath.Dir(dir) == dir {
			break
		}
	}
	candidates = append(candidates, installationOnPath(filepath.Base(catalinaScript(""))))
	for _, candidate := range candidates {
		if home := strings.TrimSpace(candidate); home != "" && isFile(catalinaScript(home)) {
			return filepath.Clean(home)
		}
	}
	return ""
}

// sharedTomcatHomes are the catalinaHome options of the Tomcat configurations shared with the project.
func sharedTomcatHomes(file string) []string {
	data, err := readLimited(file)
	if err != nil {
		return nil
	}
	var shared struct {
		Configurations []struct {
			Language        string        `json:"language"`
			Kind            string        `json:"kind"`
			LanguageOptions TomcatOptions `json:"languageOptions"`
		} `json:"configurations"`
	}
	if json.Unmarshal(data, &shared) != nil {
		return nil
	}
	var homes []string
	for _, configuration := range shared.Configurations {
		if configuration.Language == ID && configuration.Kind == KindTomcat && configuration.LanguageOptions.CatalinaHome != "" {
			homes = append(homes, configuration.LanguageOptions.CatalinaHome)
		}
	}
	return homes
}

// eclipseServerRuntimes are the locations of the server runtimes an Eclipse workspace registered whose
// runtime type contains one of types (tomcat, jboss, wildfly).
func eclipseServerRuntimes(file string, types ...string) []string {
	data, err := readLimited(file)
	if err != nil {
		return nil
	}
	var homes []string
	for _, element := range wtpRuntimeElement.FindAll(data, -1) {
		attributes := map[string]string{}
		for _, match := range wtpAttribute.FindAllSubmatch(element, -1) {
			attributes[string(match[1])] = unescapeProperty(string(match[2]))
		}
		kind := strings.ToLower(attributes["runtime-type-id"])
		for _, wanted := range types {
			if strings.Contains(kind, wanted) && attributes["location"] != "" {
				homes = append(homes, attributes["location"])
				break
			}
		}
	}
	return homes
}

// unescapeProperty undoes the escapes of a Java properties value (`C\:\\tomcat`).
func unescapeProperty(value string) string {
	var builder strings.Builder
	for index := 0; index < len(value); index++ {
		if value[index] == '\\' && index+1 < len(value) {
			index++
		}
		builder.WriteByte(value[index])
	}
	return builder.String()
}

// installationOnPath is the installation of a server script (catalina, standalone) found on the PATH: the
// folder above its bin.
func installationOnPath(script string) string {
	found, err := exec.LookPath(script)
	if err != nil {
		return ""
	}
	if resolved, err := filepath.EvalSymlinks(found); err == nil {
		found = resolved
	}
	return filepath.Dir(filepath.Dir(found))
}
