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

// KindWildFly runs a web module on a local WildFly (or JBoss EAP 7+), like Tomcat: a private server base
// directory, the installation never modified, the exploded WAR published in place as an unmanaged
// fs-exploded deployment of the copied standalone.xml.
const KindWildFly = "wildfly"

const (
	wildflyBaseFolder    = "wildfly"
	wildflyDefaultConfig = "standalone.xml"
)

// WildFlyOptions are the fields of a WildFly run configuration (LanguageOptions).
type WildFlyOptions struct {
	// JBossHome is the installation; empty = JBOSS_HOME, the Eclipse workspace runtime, standalone on PATH.
	JBossHome   string   `json:"jbossHome,omitempty"`
	Webapp      string   `json:"webapp,omitempty"`
	ContextPath string   `json:"contextPath,omitempty"`
	HTTPPort    string   `json:"httpPort,omitempty"`
	Config      string   `json:"config,omitempty"` // standalone.xml, standalone-full.xml…
	VMOptions   []string `json:"vmOptions,omitempty"`
	JavaHome    string   `json:"javaHome,omitempty"`
}

// wildflyConfigFiles are copied from standalone/configuration into the private base: a fixed list.
var wildflyConfigFiles = []string{
	"standalone.xml", "standalone-full.xml", "standalone-ha.xml", "standalone-full-ha.xml", "standalone-microprofile.xml",
	"application-users.properties", "application-roles.properties", "mgmt-users.properties", "mgmt-groups.properties", "logging.properties",
}

var (
	configNamePattern = regexp.MustCompile(`^standalone[\w-]*\.xml$`)
	jbossContextRoot  = regexp.MustCompile(`<context-root>\s*([^<\s]+)\s*</context-root>`)
	serverEndTag      = regexp.MustCompile(`</server>\s*$`)
)

func standaloneScript(home string) string {
	if runtime.GOOS == "windows" {
		return filepath.Join(home, "bin", "standalone.bat")
	}
	return filepath.Join(home, "bin", "standalone.sh")
}

// resolveJBossHome is the configured installation, else JBOSS_HOME, the WildFly/JBoss runtime of the
// Eclipse workspace, or standalone on the PATH.
func resolveJBossHome(configured, project string) (string, error) {
	candidates := []string{configured, os.Getenv("JBOSS_HOME")}
	for dir, level := filepath.Clean(project), 0; project != "" && level <= discoveryParents; dir, level = filepath.Dir(dir), level+1 {
		candidates = append(candidates, eclipseServerRuntimes(filepath.Join(dir, filepath.FromSlash(wtpServerPrefs)), "jboss", "wildfly")...)
		if filepath.Dir(dir) == dir {
			break
		}
	}
	candidates = append(candidates, installationOnPath(filepath.Base(standaloneScript(""))))
	for _, candidate := range candidates {
		if home := strings.TrimSpace(candidate); home != "" && isFile(standaloneScript(home)) {
			return filepath.Clean(home), nil
		}
	}
	if strings.TrimSpace(configured) != "" {
		return "", fmt.Errorf("%s is not a WildFly installation: bin/%s is missing", configured, filepath.Base(standaloneScript("")))
	}
	return "", fmt.Errorf("set the WildFly installation (WildFly home) or JBOSS_HOME")
}

// WildFlyCommand prepares the private base directory and returns `standalone` (with `--debug` and a port).
func WildFlyCommand(module string, options WildFlyOptions, debugPort int, environment []string) (ServerLaunch, error) {
	home, err := resolveJBossHome(options.JBossHome, module)
	if err != nil {
		return ServerLaunch{}, err
	}
	port, err := tomcatPort(options.HTTPPort)
	if err != nil {
		return ServerLaunch{}, err
	}
	config := strings.TrimSpace(options.Config)
	if config == "" {
		config = wildflyDefaultConfig
	}
	if !configNamePattern.MatchString(config) {
		return ServerLaunch{}, fmt.Errorf("%q is not a standalone configuration (standalone.xml, standalone-full.xml…)", config)
	}
	webapp, err := resolveWebapp(module, options.Webapp)
	if err != nil {
		return ServerLaunch{}, err
	}
	if !isDirectory(filepath.Join(webapp, "WEB-INF", "classes")) && (len(classesFor(module, webapp)) > 0 || len(antSourceFolders(module)) > 0) {
		return ServerLaunch{}, fmt.Errorf("WildFly deploys a complete exploded WAR: %s has no WEB-INF/classes (build the WAR, e.g. mvn package, or use Tomcat)", webapp)
	}
	contextPath, err := tomcatContextPath(module, wildflyContextPath(webapp, options.ContextPath))
	if err != nil {
		return ServerLaunch{}, err
	}
	base, err := prepareWildFlyBase(home, module, config, webapp, contextPath)
	if err != nil {
		return ServerLaunch{}, err
	}
	arguments := []string{"-Djboss.server.base.dir=" + base, "-Djboss.http.port=" + strconv.Itoa(port), "-c", config}
	if debugPort > 0 {
		arguments = append(arguments, "--debug", "127.0.0.1:"+strconv.Itoa(debugPort))
	}
	extra := []string{"JBOSS_HOME=" + home}
	if len(options.VMOptions) > 0 {
		// WildFly's own rule: JAVA_OPTS replaces the defaults of standalone.conf.
		extra = append(extra, "JAVA_OPTS="+strings.Join(options.VMOptions, " "))
	}
	extra = append(extra, JavaEnvironment(options.JavaHome)...)
	executable := standaloneScript(home)
	if err := run.CheckBatchSafe(executable, arguments); err != nil {
		return ServerLaunch{}, err
	}
	url := "http://localhost:" + strconv.Itoa(port) + strings.TrimSuffix(contextPath, "/") + "/"
	return ServerLaunch{
		URL: url,
		Spec: run.CommandSpec{
			Executable: executable, Arguments: arguments, WorkingDirectory: module,
			Environment:    append(append([]string(nil), environment...), extra...),
			DisplayCommand: "standalone -c " + config + " · " + url,
		},
	}, nil
}

// wildflyContextPath: the configured path, else WEB-INF/jboss-web.xml's context-root, else the WAR name.
func wildflyContextPath(webapp, configured string) string {
	if strings.TrimSpace(configured) != "" {
		return configured
	}
	if data, err := readLimited(filepath.Join(webapp, "WEB-INF", "jboss-web.xml")); err == nil {
		if match := jbossContextRoot.FindSubmatch(data); match != nil {
			return string(match[1])
		}
	}
	return ""
}

// prepareWildFlyBase writes <cache>/adomnia/wildfly/<hash>: configuration copied from the installation,
// the chosen config with the module as an unmanaged exploded deployment, and empty data, log, tmp.
func prepareWildFlyBase(home, module, config, webapp, contextPath string) (string, error) {
	cache, err := os.UserCacheDir()
	if err != nil {
		cache = os.TempDir()
	}
	sum := sha256.Sum256([]byte(module))
	base := filepath.Join(cache, "adomnia", wildflyBaseFolder, hex.EncodeToString(sum[:])[:16])
	for _, folder := range []string{"configuration", "deployments", "data", "log", "tmp"} {
		if err := os.MkdirAll(filepath.Join(base, folder), 0o755); err != nil {
			return "", fmt.Errorf("could not prepare the WildFly folder: %w", err)
		}
	}
	source := filepath.Join(home, "standalone", "configuration")
	for _, name := range wildflyConfigFiles {
		data, err := os.ReadFile(filepath.Join(source, name)) // #nosec G304 -- a fixed file of the installation the user chose
		if errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if err != nil {
			return "", fmt.Errorf("could not read the WildFly configuration: %w", err)
		}
		if name == config {
			if data, err = withExplodedDeployment(data, webapp, contextPath); err != nil {
				return "", err
			}
		}
		if err := os.WriteFile(filepath.Join(base, "configuration", name), data, tomcatConfFileMode); err != nil { // #nosec G703 -- base is adOmnia's cache folder plus a hash, name a constant of wildflyConfigFiles
			return "", err
		}
	}
	if !isFile(filepath.Join(base, "configuration", config)) {
		return "", fmt.Errorf("%s has no standalone/configuration/%s", home, config)
	}
	return base, nil
}

// withExplodedDeployment adds the module as an unmanaged deployment: WildFly serves the folder in place.
// A runtime name ROOT.war answers at /.
func withExplodedDeployment(data []byte, webapp, contextPath string) ([]byte, error) {
	text := string(data)
	if !serverEndTag.MatchString(text) {
		return nil, fmt.Errorf("the WildFly configuration has no </server> end")
	}
	if strings.Contains(text, "<deployments>") {
		return nil, fmt.Errorf("the WildFly configuration already lists deployments: run it with its own configuration, outside adOmnia")
	}
	name := "ROOT.war"
	if contextPath != "/" {
		name = strings.ReplaceAll(strings.TrimPrefix(contextPath, "/"), "/", "-") + ".war"
	}
	deployment := "    <deployments>\n" +
		`        <deployment name="adomnia-` + html.EscapeString(name) + `" runtime-name="` + html.EscapeString(name) + `">` + "\n" +
		`            <fs-exploded path="` + html.EscapeString(webapp) + `"/>` + "\n" +
		"        </deployment>\n    </deployments>\n</server>\n"
	return []byte(serverEndTag.ReplaceAllString(text, deployment)), nil
}

func wildflyOptionsOf(raw []byte) (WildFlyOptions, error) {
	var options WildFlyOptions
	if len(raw) == 0 {
		return options, nil
	}
	if err := json.Unmarshal(raw, &options); err != nil {
		return options, fmt.Errorf("invalid WildFly options: %w", err)
	}
	return options, nil
}

// wildflySuggestion proposes WildFly for a web module whose exploded WAR is complete, when one is installed.
func wildflySuggestion(unit project.Unit) (run.Suggestion, bool) {
	if !isWebModule(unit) {
		return run.Suggestion{}, false
	}
	if _, err := resolveJBossHome("", unit.Root); err != nil {
		return run.Suggestion{}, false
	}
	options, err := json.Marshal(WildFlyOptions{})
	if err != nil {
		return run.Suggestion{}, false
	}
	name := defaultContextName(unit.Root)
	return run.Suggestion{
		ID: ID + "|" + unit.Root + "|wildfly", Language: ID, Action: "run", UnitRoot: unit.Root,
		Title: "WildFly · /" + name + " on :8080",
		Configuration: run.Configuration{
			Language: ID, Name: "WildFly " + name, Kind: KindWildFly, LanguageOptions: options,
		},
	}, true
}

// ServerCommand is the command of an application-server configuration (Tomcat, WildFly) for Run (debugPort
// 0) or Debug, so the host has one path for every server.
func ServerCommand(kind, module string, rawOptions []byte, debugPort int, environment []string) (ServerLaunch, error) {
	switch kind {
	case KindTomcat:
		options, err := tomcatOptionsOf(rawOptions)
		if err != nil {
			return ServerLaunch{}, err
		}
		return TomcatCommand(module, options, debugPort, environment)
	case KindWildFly:
		options, err := wildflyOptionsOf(rawOptions)
		if err != nil {
			return ServerLaunch{}, err
		}
		return WildFlyCommand(module, options, debugPort, environment)
	}
	return ServerLaunch{}, fmt.Errorf("%q is not an application server configuration", kind)
}
