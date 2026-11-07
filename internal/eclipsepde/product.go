package eclipsepde

import (
	"archive/zip"
	"encoding/xml"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
)

// AppLaunch is what a `.product` or a PDE `.launch` declares about starting an Eclipse application:
// which application or product, which bundles (listed, or through features) and which arguments.
type AppLaunch struct {
	// Name is the file name without extension; File is relative to the workspace root.
	Name string `json:"name"`
	File string `json:"file"`
	// Kind is "product" or "launch".
	Kind        string `json:"kind"`
	Application string `json:"application,omitempty"`
	Product     string `json:"product,omitempty"`
	// Plugins and Features are the declared roots; empty both means "the workspace bundles".
	Plugins  []string `json:"plugins,omitempty"`
	Features []string `json:"features,omitempty"`
	// VMArguments go before -jar, ProgramArguments after the framework options.
	VMArguments      []string `json:"vmArguments,omitempty"`
	ProgramArguments []string `json:"programArguments,omitempty"`
	// StartLevels are the product's <configurations>: bundle -> "@<level>:start" suffix.
	StartLevels map[string]string `json:"-"`
}

// ListAppLaunches lists the `.product` and `.launch` files of the workspace projects that start an
// Eclipse application (or a plain OSGi framework launch). Unreadable files are skipped: the list
// shows what can be launched.
func ListAppLaunches(root string) ([]AppLaunch, error) {
	ws, err := ImportWorkspace(root)
	if err != nil {
		return nil, err
	}
	var launches []AppLaunch
	for _, project := range ws.Projects {
		for _, file := range project.PdeFiles {
			path := filepath.Join(project.Dir, file)
			launch, err := ReadAppLaunch(path)
			if err != nil || launch == nil {
				continue
			}
			launch.File, _ = relativeWithin(ws.Root, path)
			launch.File = filepath.ToSlash(launch.File)
			launches = append(launches, *launch)
		}
	}
	return launches, nil
}

// ReadAppLaunch reads a `.product` or a `.launch`; nil, nil for a launch configuration that does
// not start an Eclipse application (a JUnit or Java one).
func ReadAppLaunch(path string) (*AppLaunch, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	name := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	switch strings.ToLower(filepath.Ext(path)) {
	case ".product":
		return parseProduct(name, data)
	case ".launch":
		return parseLaunchConfiguration(name, data)
	}
	return nil, nil
}

func parseProduct(name string, data []byte) (*AppLaunch, error) {
	var doc struct {
		ID          string `xml:"id,attr"`
		UID         string `xml:"uid,attr"`
		Application string `xml:"application,attr"`
		UseFeatures string `xml:"useFeatures,attr"`
		Type        string `xml:"type,attr"`
		Launcher    struct {
			Arguments []osArguments `xml:",any"`
		} `xml:"launcherArgs"`
		Plugins []struct {
			ID string `xml:"id,attr"`
		} `xml:"plugins>plugin"`
		Features []struct {
			ID string `xml:"id,attr"`
		} `xml:"features>feature"`
		Configurations []struct {
			ID         string `xml:"id,attr"`
			AutoStart  string `xml:"autoStart,attr"`
			StartLevel string `xml:"startLevel,attr"`
		} `xml:"configurations>plugin"`
	}
	if err := xml.Unmarshal(data, &doc); err != nil {
		return nil, fmt.Errorf("%s.product: %w", name, err)
	}
	launch := &AppLaunch{Name: name, Kind: "product", Application: doc.Application, Product: doc.ID, StartLevels: map[string]string{}}
	// PDE: type="features" (or the older useFeatures="true") takes the features, otherwise the plugins.
	if doc.Type == "features" || doc.Type == "mixed" || strings.EqualFold(doc.UseFeatures, "true") {
		for _, feature := range doc.Features {
			launch.Features = append(launch.Features, feature.ID)
		}
	}
	if doc.Type != "features" && !strings.EqualFold(doc.UseFeatures, "true") {
		for _, plugin := range doc.Plugins {
			launch.Plugins = append(launch.Plugins, plugin.ID)
		}
	}
	for _, configuration := range doc.Configurations {
		suffix := "@"
		if level, err := strconv.Atoi(configuration.StartLevel); err == nil && level > 0 {
			suffix += strconv.Itoa(level) + ":"
		}
		if strings.EqualFold(configuration.AutoStart, "true") {
			launch.StartLevels[configuration.ID] = suffix + "start"
		} else if suffix != "@" {
			launch.StartLevels[configuration.ID] = strings.TrimSuffix(suffix, ":")
		}
	}
	launch.ProgramArguments = argumentsForThisOS(doc.Launcher.Arguments, "programArgs")
	launch.VMArguments = argumentsForThisOS(doc.Launcher.Arguments, "vmArgs")
	return launch, nil
}

// osArguments is one <programArgs> / <programArgsWin> … element: the os is in the element name.
type osArguments struct {
	XMLName xml.Name
	Text    string `xml:",chardata"`
}

// argumentsForThisOS joins the generic arguments (programArgs) with the ones of this OS (programArgsWin…).
func argumentsForThisOS(groups []osArguments, kind string) []string {
	suffix := map[string]string{"win32": "Win", "linux": "Lin", "macosx": "Mac"}[p2Environment(false)["osgi.os"]]
	var arguments []string
	for _, group := range groups {
		if name := group.XMLName.Local; name == kind || (suffix != "" && name == kind+suffix) {
			arguments = append(arguments, splitArguments(group.Text)...)
		}
	}
	return arguments
}

// pdeLaunchTypes are the launch configurations that start an Eclipse application or a framework.
var pdeLaunchTypes = []string{"org.eclipse.pde.ui.RuntimeWorkbench", "org.eclipse.pde.ui.EquinoxLauncher", "org.eclipse.pde.ui.JunitLaunchConfig"}

func parseLaunchConfiguration(name string, data []byte) (*AppLaunch, error) {
	var doc struct {
		Type       string `xml:"type,attr"`
		Attributes []struct {
			Key   string `xml:"key,attr"`
			Value string `xml:"value,attr"`
		} `xml:"stringAttribute"`
		Booleans []struct {
			Key   string `xml:"key,attr"`
			Value string `xml:"value,attr"`
		} `xml:"booleanAttribute"`
		Sets []struct {
			Key     string `xml:"key,attr"`
			Entries []struct {
				Value string `xml:"value,attr"`
			} `xml:"setEntry"`
		} `xml:"setAttribute"`
	}
	if err := xml.Unmarshal(data, &doc); err != nil {
		return nil, fmt.Errorf("%s.launch: %w", name, err)
	}
	if !slices.Contains(pdeLaunchTypes[:2], doc.Type) {
		return nil, nil
	}
	strings_ := map[string]string{}
	for _, attribute := range doc.Attributes {
		strings_[attribute.Key] = attribute.Value
	}
	booleans := map[string]bool{}
	for _, attribute := range doc.Booleans {
		booleans[attribute.Key] = strings.EqualFold(attribute.Value, "true")
	}
	launch := &AppLaunch{Name: name, Kind: "launch", StartLevels: map[string]string{}}
	if doc.Type == pdeLaunchTypes[0] {
		launch.Application = strings_["application"]
		if booleans["useProduct"] {
			launch.Product = strings_["product"]
		}
	}
	launch.VMArguments = splitArguments(strings_["org.eclipse.jdt.launching.VM_ARGUMENTS"])
	launch.ProgramArguments = splitArguments(strings_["org.eclipse.jdt.launching.PROGRAM_ARGUMENTS"])
	if !booleans["useDefaultConfig"] && !booleans["default"] {
		// selected_workspace_bundles / selected_target_bundles (Kepler) or *_plugins (older): id[*version]@start
		for _, set := range doc.Sets {
			if !strings.HasPrefix(set.Key, "selected_") && set.Key != "workspace_bundles" && set.Key != "target_bundles" {
				continue
			}
			for _, entry := range set.Entries {
				id, suffix := splitLaunchBundle(entry.Value)
				launch.Plugins = append(launch.Plugins, id)
				if suffix != "" && suffix != "@default:default" {
					launch.StartLevels[id] = strings.NewReplacer("default:", "", ":default", "").Replace(suffix)
				}
			}
		}
	}
	return launch, nil
}

// splitLaunchBundle splits "org.acme.core*1.0.0@4:true" into the id and an osgi.bundles suffix.
func splitLaunchBundle(entry string) (id, suffix string) {
	id, rest, _ := strings.Cut(entry, "@")
	id, _, _ = strings.Cut(id, "*")
	if rest == "" {
		return id, ""
	}
	level, start, _ := strings.Cut(rest, ":")
	switch {
	case start == "true" && level != "default":
		return id, "@" + level + ":start"
	case start == "true":
		return id, "@start"
	case level != "default":
		return id, "@" + level
	}
	return id, ""
}

// splitArguments splits a command line as Eclipse does: on spaces, with "double quotes" grouping.
func splitArguments(line string) []string {
	var arguments []string
	var current strings.Builder
	quoted, started := false, false
	for _, char := range line {
		switch {
		case char == '"':
			quoted, started = !quoted, true
		case (char == ' ' || char == '\t' || char == '\n' || char == '\r') && !quoted:
			if started {
				arguments = append(arguments, current.String())
				current.Reset()
				started = false
			}
		default:
			current.WriteRune(char)
			started = true
		}
	}
	if started {
		arguments = append(arguments, current.String())
	}
	return arguments
}

// featureContent is what a feature brings: its plugins and the features it includes.
type featureContent struct {
	plugins  []string
	includes []string
}

// featureIndex finds feature.xml in the workspace projects and in the target folders (features/x/
// or features/x.jar next to the plugins). A feature that only exists in a p2 repository is not
// there yet: its plugins are reported missing.
func featureIndex(ws *Workspace, target *BundleIndex) map[string]featureContent {
	features := map[string]featureContent{}
	add := func(data []byte) {
		var doc struct {
			ID      string `xml:"id,attr"`
			Plugins []struct {
				ID string `xml:"id,attr"`
			} `xml:"plugin"`
			Includes []struct {
				ID string `xml:"id,attr"`
			} `xml:"includes"`
		}
		if xml.Unmarshal(data, &doc) != nil || doc.ID == "" {
			return
		}
		content := featureContent{}
		for _, plugin := range doc.Plugins {
			content.plugins = append(content.plugins, plugin.ID)
		}
		for _, include := range doc.Includes {
			content.includes = append(content.includes, include.ID)
		}
		if _, known := features[doc.ID]; !known {
			features[doc.ID] = content
		}
	}
	for _, project := range ws.Projects {
		if data, err := os.ReadFile(filepath.Join(project.Dir, "feature.xml")); err == nil {
			add(data)
		}
	}
	folders := map[string]bool{}
	for _, entry := range target.All() {
		folders[filepath.Join(filepath.Dir(filepath.Dir(entry.Bundle.Location)), "features")] = true
	}
	for folder := range folders {
		entries, err := os.ReadDir(folder)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			path := filepath.Join(folder, entry.Name())
			if entry.IsDir() {
				if data, err := os.ReadFile(filepath.Join(path, "feature.xml")); err == nil {
					add(data)
				}
			} else if strings.EqualFold(filepath.Ext(path), ".jar") {
				if data, err := featureXMLFromJar(path); err == nil {
					add(data)
				}
			}
		}
	}
	return features
}

func featureXMLFromJar(path string) ([]byte, error) {
	reader, err := zip.OpenReader(path)
	if err != nil {
		return nil, err
	}
	defer func() { _ = reader.Close() }() // read-only
	for _, file := range reader.File {
		if file.Name == "feature.xml" {
			content, err := file.Open()
			if err != nil {
				return nil, err
			}
			defer func() { _ = content.Close() }()
			return io.ReadAll(io.LimitReader(content, 16<<20))
		}
	}
	return nil, os.ErrNotExist
}

// rootBundles are the bundles the launch names: its plugins plus the plugins of its features,
// included features followed. Missing features and plugins are reported, not fatal: the closure
// of what exists still starts and Equinox says what is missing.
func (l *AppLaunch) rootBundles(ws *Workspace, target *BundleIndex) (names []string, problems []Problem) {
	seen := map[string]bool{}
	addPlugin := func(id string) {
		if !seen[id] {
			seen[id] = true
			names = append(names, id)
		}
	}
	for _, id := range l.Plugins {
		addPlugin(id)
	}
	if len(l.Features) == 0 {
		return names, nil
	}
	features := featureIndex(ws, target)
	visited := map[string]bool{}
	var visit func(id string)
	visit = func(id string) {
		if visited[id] {
			return
		}
		visited[id] = true
		content, ok := features[id]
		if !ok {
			problems = append(problems, Problem{Severity: "warning", File: l.File, Message: "feature " + id + " is not in the workspace or in the target folder: its plug-ins are not launched"})
			return
		}
		for _, plugin := range content.plugins {
			addPlugin(plugin)
		}
		for _, include := range content.includes {
			visit(include)
		}
	}
	for _, id := range l.Features {
		visit(id)
	}
	return names, problems
}
