package java

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json/v2"
	"errors"
	"fmt"
	"html"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
)

// KindTomcat runs a web module on a local Apache Tomcat, like an Eclipse WTP server: the exploded WAR is
// published through a context descriptor in a private CATALINA_BASE, the installation is never modified.
const KindTomcat = "tomcat"

const (
	defaultTomcatHTTPPort = 8080
	tomcatBaseFolder      = "tomcat"
	tomcatConfFileMode    = 0o600
)

// TomcatOptions are the fields of a Tomcat run configuration (LanguageOptions).
type TomcatOptions struct {
	// CatalinaHome is the Tomcat installation; empty = CATALINA_HOME.
	CatalinaHome string `json:"catalinaHome,omitempty"`
	// Webapp is the exploded WAR, relative to the module; empty = detected (target/<war>, WebContent…).
	Webapp string `json:"webapp,omitempty"`
	// ContextPath is where the application answers ("/billing"); empty = the module name, "/" = ROOT.
	ContextPath string   `json:"contextPath,omitempty"`
	HTTPPort    string   `json:"httpPort,omitempty"`
	VMOptions   []string `json:"vmOptions,omitempty"`
	JavaHome    string   `json:"javaHome,omitempty"`
}

// TomcatLaunch is what the host runs: the command, and the URL to show.
type TomcatLaunch struct {
	Spec run.CommandSpec
	URL  string
}

// webappCandidates are the exploded-WAR folders of the usual layouts, in order: Eclipse WTP (Kepler),
// MyEclipse, Ant layouts, Maven/Gradle sources.
var webappCandidates = []string{"WebContent", "WebRoot", "web", "src/main/webapp"}

// classesCandidates are the compiled classes of a source webapp without WEB-INF/classes.
var classesCandidates = []string{"target/classes", "build/classes", "build/classes/java/main", "bin"}

// isWebModule tells whether the module is a web application Tomcat can serve.
func isWebModule(unit project.Unit) bool {
	if unit.Kind == UnitMaven && readPom(unit.Manifest).Packaging == "war" {
		return true
	}
	for _, candidate := range webappCandidates {
		if isDirectory(filepath.Join(unit.Root, filepath.FromSlash(candidate), "WEB-INF")) {
			return true
		}
	}
	return false
}

// resolveCatalinaHome is the configured installation, else the Tomcat discovered around the project
// (discoverCatalinaHome), checked for bin/catalina.
func resolveCatalinaHome(configured, project string) (string, error) {
	home := strings.TrimSpace(configured)
	if home == "" {
		home = discoverCatalinaHome(project)
	}
	if home == "" {
		return "", fmt.Errorf("set the Tomcat installation (Tomcat home), CATALINA_HOME, or register Tomcat as a server runtime in the Eclipse workspace")
	}
	if !isFile(catalinaScript(home)) {
		return "", fmt.Errorf("%s is not a Tomcat installation: bin/%s is missing", home, filepath.Base(catalinaScript(home)))
	}
	return filepath.Clean(home), nil
}

func catalinaScript(home string) string {
	if runtime.GOOS == "windows" {
		return filepath.Join(home, "bin", "catalina.bat")
	}
	return filepath.Join(home, "bin", "catalina.sh")
}

// TomcatCommand prepares the private CATALINA_BASE and returns `catalina run` (`catalina jpda run` with a
// debug port). module is the module folder, inside the project.
func TomcatCommand(module string, options TomcatOptions, debugPort int, environment []string) (TomcatLaunch, error) {
	home, err := resolveCatalinaHome(options.CatalinaHome, module)
	if err != nil {
		return TomcatLaunch{}, err
	}
	port, err := tomcatPort(options.HTTPPort)
	if err != nil {
		return TomcatLaunch{}, err
	}
	webapp, err := resolveWebapp(module, options.Webapp)
	if err != nil {
		return TomcatLaunch{}, err
	}
	contextPath, err := tomcatContextPath(module, options.ContextPath)
	if err != nil {
		return TomcatLaunch{}, err
	}
	base, err := prepareCatalinaBase(home, module, port)
	if err != nil {
		return TomcatLaunch{}, err
	}
	classes := append(classesFor(module, webapp), dependentModuleClasses(module)...)
	descriptor := contextDescriptor(webapp, classes, tomcatMajor(home))
	if err := writeContext(base, contextPath, descriptor); err != nil {
		return TomcatLaunch{}, err
	}
	arguments := []string{"run"}
	extra := []string{"CATALINA_HOME=" + home, "CATALINA_BASE=" + base, "CATALINA_OPTS=" + strings.Join(options.VMOptions, " ")}
	if debugPort > 0 {
		arguments = []string{"jpda", "run"}
		extra = append(extra, "JPDA_TRANSPORT=dt_socket", "JPDA_ADDRESS=127.0.0.1:"+strconv.Itoa(debugPort), "JPDA_SUSPEND=y")
	}
	extra = append(extra, JavaEnvironment(options.JavaHome)...)
	url := "http://localhost:" + strconv.Itoa(port) + strings.TrimSuffix(contextPath, "/") + "/"
	executable := catalinaScript(home)
	return TomcatLaunch{
		URL: url,
		Spec: run.CommandSpec{
			Executable: executable, Arguments: arguments, WorkingDirectory: module,
			Environment:    append(append([]string(nil), environment...), extra...),
			DisplayCommand: "catalina " + strings.Join(arguments, " ") + " · " + url,
		},
	}, nil
}

func tomcatPort(value string) (int, error) {
	if strings.TrimSpace(value) == "" {
		return defaultTomcatHTTPPort, nil
	}
	port, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || port < 1 || port > 65535 {
		return 0, fmt.Errorf("the HTTP port must be between 1 and 65535")
	}
	return port, nil
}

// resolveWebapp is the exploded WAR: the configured folder, Maven's target/<finalName>, then the source
// layouts. It must stay inside the module.
func resolveWebapp(module, configured string) (string, error) {
	if configured = strings.TrimSpace(configured); configured != "" {
		path := containedDirectory(module, module, configured)
		if path == "" || !isDirectory(path) {
			return "", fmt.Errorf("the webapp folder %q is not a folder inside the module", configured)
		}
		return path, nil
	}
	if pom := filepath.Join(module, "pom.xml"); isFile(pom) {
		info := readPom(pom)
		if exploded := filepath.Join(module, "target", info.warName()); info.ArtifactID != "" && isDirectory(filepath.Join(exploded, "WEB-INF")) {
			return exploded, nil
		}
	}
	// A WTP project declares its web root (.settings/org.eclipse.wst.common.component).
	if root := webRootOf(module); isDirectory(filepath.Join(root, "WEB-INF")) {
		return root, nil
	}
	for _, candidate := range webappCandidates {
		if path := filepath.Join(module, filepath.FromSlash(candidate)); isDirectory(filepath.Join(path, "WEB-INF")) {
			return path, nil
		}
	}
	return "", fmt.Errorf("no exploded WAR in the module: build it (mvn package, the Ant dist target) or set the webapp folder")
}

// classesFor is the compiled output a source webapp needs (WebContent has no WEB-INF/classes in Eclipse):
// the Eclipse output folder of the project, else the usual build folders.
func classesFor(module, webapp string) []string {
	if isDirectory(filepath.Join(webapp, "WEB-INF", "classes")) {
		return nil
	}
	if output := eclipseOutputFolder(module); output != "" {
		return []string{output}
	}
	for _, candidate := range classesCandidates {
		if path := filepath.Join(module, filepath.FromSlash(candidate)); isDirectory(path) {
			return []string{path}
		}
	}
	return nil
}

// dependentModuleClasses are the compiled outputs of the projects a WTP module deploys with it (utility
// and EJB projects next to it in the workspace): WTP would package them in WEB-INF/lib.
func dependentModuleClasses(module string) []string {
	var folders []string
	for _, name := range dependentModules(module) {
		if output := eclipseOutputFolder(filepath.Join(filepath.Dir(module), name)); output != "" {
			folders = append(folders, output)
		}
	}
	return folders
}

// eclipseOutputFolder is the existing output folder of an Eclipse project (.classpath kind="output").
func eclipseOutputFolder(projectDir string) string {
	project, ok := readEclipseProject(projectDir)
	if !ok {
		return ""
	}
	for _, entry := range project.Entries {
		if entry.Kind == "output" {
			if folder := filepath.Join(projectDir, filepath.FromSlash(entry.Path)); isDirectory(folder) {
				return folder
			}
		}
	}
	return ""
}

var contextPathPattern = regexp.MustCompile(`^(/[A-Za-z0-9._~-]+)*/?$`)

// tomcatContextPath is "/<module name>" by default, "/" for ROOT.
func tomcatContextPath(module, configured string) (string, error) {
	path := strings.TrimSpace(configured)
	if path == "" {
		path = "/" + defaultContextName(module)
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	if !contextPathPattern.MatchString(path) {
		return "", fmt.Errorf("%q is not a valid context path", configured)
	}
	if path != "/" {
		path = strings.TrimSuffix(path, "/")
	}
	return path, nil
}

// defaultContextName is the WAR name a server would deploy: Maven finalName/artifactId, else the folder.
func defaultContextName(module string) string {
	if pom := filepath.Join(module, "pom.xml"); isFile(pom) {
		info := readPom(pom)
		if info.FinalName != "" && !strings.Contains(info.FinalName, "$") {
			return info.FinalName
		}
		if info.ArtifactID != "" {
			return info.ArtifactID
		}
	}
	name := filepath.Base(module)
	return regexp.MustCompile(`[^A-Za-z0-9._~-]`).ReplaceAllString(name, "-")
}

// contextFileName is the descriptor name Tomcat maps to a context path: ROOT.xml, a#b.xml for /a/b.
func contextFileName(contextPath string) string {
	if contextPath == "/" {
		return "ROOT.xml"
	}
	return strings.ReplaceAll(strings.TrimPrefix(contextPath, "/"), "/", "#") + ".xml"
}

// contextDescriptor publishes the exploded WAR in place, reloadable, adding the compiled classes of a
// source webapp: VirtualWebappLoader on Tomcat 7, a PreResources set from Tomcat 8.
func contextDescriptor(webapp string, classes []string, major int) string {
	var builder strings.Builder
	builder.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n")
	builder.WriteString(`<!-- Written by adOmnia for this run: the project is published in place. -->` + "\n")
	builder.WriteString(`<Context docBase="` + html.EscapeString(webapp) + `" reloadable="true">` + "\n")
	switch {
	case len(classes) == 0:
	case major > 0 && major < 8:
		builder.WriteString(`  <Loader className="org.apache.catalina.loader.VirtualWebappLoader" virtualClasspath="` + html.EscapeString(strings.Join(classes, ";")) + `"/>` + "\n")
	default:
		builder.WriteString("  <Resources>\n")
		for _, folder := range classes {
			builder.WriteString(`    <PreResources className="org.apache.catalina.webresources.DirResourceSet" base="` + html.EscapeString(folder) + `" webAppMount="/WEB-INF/classes"/>` + "\n")
		}
		builder.WriteString("  </Resources>\n")
	}
	builder.WriteString("</Context>\n")
	return builder.String()
}

var tomcatVersionPattern = regexp.MustCompile(`Apache Tomcat Version (\d+)\.`)

// tomcatMajor reads RELEASE-NOTES; 0 when unknown (treated as 8+).
func tomcatMajor(home string) int {
	data, err := readLimited(filepath.Join(home, "RELEASE-NOTES"))
	if err != nil {
		return 0
	}
	match := tomcatVersionPattern.FindSubmatch(data)
	if match == nil {
		return 0
	}
	major, _ := strconv.Atoi(string(match[1])) // digits matched by the pattern
	return major
}

var (
	connectorPattern = regexp.MustCompile(`(?s)<Connector\b[^>]*?(/>|>.*?</Connector>)`)
	portAttribute    = regexp.MustCompile(`\bport="[^"]*"`)
	serverElement    = regexp.MustCompile(`<Server\b[^>]*>`)
	xmlComment       = regexp.MustCompile(`(?s)<!--.*?-->`)
)

// rewriteServerXML sets the HTTP port, disables the shutdown port and drops the AJP connectors, so two
// projects (or the user's own Tomcat) never fight over 8005/8009.
func rewriteServerXML(data string, httpPort int) (string, error) {
	data = xmlComment.ReplaceAllString(data, "")
	server := serverElement.FindString(data)
	if server == "" {
		return "", fmt.Errorf("conf/server.xml has no <Server> element")
	}
	data = strings.Replace(data, server, portAttribute.ReplaceAllString(server, `port="-1"`), 1)
	http := false
	data = connectorPattern.ReplaceAllStringFunc(data, func(connector string) string {
		if strings.Contains(connector, "AJP") || http {
			return ""
		}
		http = true
		return portAttribute.ReplaceAllString(connector, `port="`+strconv.Itoa(httpPort)+`"`)
	})
	if !http {
		return "", fmt.Errorf("conf/server.xml has no HTTP connector")
	}
	return data, nil
}

// tomcatConfFiles are the configuration files a CATALINA_BASE needs, copied from the installation (Tomcat 7
// to 11). A fixed list: nothing else of the installation reaches the private base.
var tomcatConfFiles = []string{
	"server.xml", "web.xml", "context.xml", "tomcat-users.xml", "tomcat-users.xsd", "logging.properties",
	"catalina.properties", "catalina.policy", "jaspic-providers.xml", "jaspic-providers.xsd",
}

// prepareCatalinaBase writes <cache>/adomnia/tomcat/<module hash>: conf copied from the installation with
// server.xml rewritten, and empty logs, temp, work and webapps.
func prepareCatalinaBase(home, module string, httpPort int) (string, error) {
	cache, err := os.UserCacheDir()
	if err != nil {
		cache = os.TempDir()
	}
	sum := sha256.Sum256([]byte(module))
	base := filepath.Join(cache, "adomnia", tomcatBaseFolder, hex.EncodeToString(sum[:])[:16])
	for _, folder := range []string{"conf", "logs", "temp", "work", "webapps", filepath.Join("conf", "Catalina", "localhost")} {
		if err := os.MkdirAll(filepath.Join(base, folder), 0o755); err != nil {
			return "", fmt.Errorf("could not prepare the Tomcat folder: %w", err)
		}
	}
	for _, name := range tomcatConfFiles {
		data, err := os.ReadFile(filepath.Join(home, "conf", name)) // #nosec G304 -- a fixed file of the Tomcat installation the user chose
		if errors.Is(err, fs.ErrNotExist) {
			continue // not every Tomcat version ships every file
		}
		if err != nil {
			return "", fmt.Errorf("could not read the Tomcat configuration: %w", err)
		}
		if name == "server.xml" {
			rewritten, err := rewriteServerXML(string(data), httpPort)
			if err != nil {
				return "", err
			}
			data = []byte(rewritten)
		}
		if err := os.WriteFile(filepath.Join(base, "conf", name), data, tomcatConfFileMode); err != nil { // #nosec G703 -- base is adOmnia's cache folder plus a hash, name a constant of tomcatConfFiles
			return "", err
		}
	}
	if !isFile(filepath.Join(base, "conf", "server.xml")) {
		return "", fmt.Errorf("%s has no conf/server.xml", home)
	}
	return base, nil
}

// writeContext replaces every descriptor of the base with this one: one application per run.
func writeContext(base, contextPath, descriptor string) error {
	folder := filepath.Join(base, "conf", "Catalina", "localhost")
	entries, err := os.ReadDir(folder)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".xml") {
			if err := os.Remove(filepath.Join(folder, entry.Name())); err != nil {
				return err
			}
		}
	}
	return os.WriteFile(filepath.Join(folder, contextFileName(contextPath)), []byte(descriptor), tomcatConfFileMode)
}

// tomcatSuggestion proposes the Tomcat configuration of a web module when an installation is known.
func tomcatSuggestion(unit project.Unit) (run.Suggestion, bool) {
	if !isWebModule(unit) {
		return run.Suggestion{}, false
	}
	if _, err := resolveCatalinaHome("", unit.Root); err != nil {
		return run.Suggestion{}, false
	}
	options, err := json.Marshal(TomcatOptions{})
	if err != nil {
		return run.Suggestion{}, false
	}
	return run.Suggestion{
		ID: ID + "|" + unit.Root + "|tomcat", Language: ID, Action: "run", UnitRoot: unit.Root,
		Title: "Tomcat · /" + defaultContextName(unit.Root) + " on :8080",
		Configuration: run.Configuration{
			Language: ID, Name: "Tomcat " + defaultContextName(unit.Root), Kind: KindTomcat, LanguageOptions: options,
		},
	}, true
}

func tomcatOptionsOf(raw []byte) (TomcatOptions, error) {
	var options TomcatOptions
	if len(raw) == 0 {
		return options, nil
	}
	if err := json.Unmarshal(raw, &options); err != nil {
		return options, fmt.Errorf("invalid Tomcat options: %w", err)
	}
	return options, nil
}

// TomcatOptionsOf decodes the options of a Tomcat configuration for the host (Debug).
func TomcatOptionsOf(raw []byte) (TomcatOptions, error) { return tomcatOptionsOf(raw) }
