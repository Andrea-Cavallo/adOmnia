package java

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/eclipsepde"
)

// Eclipse Java projects (Kepler-era workspaces: Dynamic Web, EJB, plain Java, often built with Ant) have a
// .classpath that JDT LS reads, but their WTP containers (the server runtime, the Web App Libraries, the
// EAR modules) exist only in an Eclipse with WTP. JDT LS would report every javax.servlet type as
// missing. They are given a shadow workspace instead, like PDE bundles: one plain Java project per real
// project, its sources linked, the containers resolved to jars.

const (
	eclipseJavaNature     = "org.eclipse.jdt.core.javanature"
	jreContainerPrefix    = "org.eclipse.jdt.launching.JRE_CONTAINER"
	serverRuntimePrefix   = "org.eclipse.jst.server.core.container"
	webLibrariesContainer = "org.eclipse.jst.j2ee.internal.web.container"
	moduleContainer       = "org.eclipse.jst.j2ee.internal.module.container"
	junitContainerPrefix  = "org.eclipse.jdt.junit.JUNIT_CONTAINER"
	// maxEclipseProjects bounds the scan of a workspace folder.
	maxEclipseProjects = 200
	shadowMinimumLevel = 8
)

var dependentModule = regexp.MustCompile(`handle="module:/resource/([^/"]+)/`)

// eclipseProject is one Eclipse Java project of the opened folder.
type eclipseProject struct {
	Name    string
	Dir     string
	WTP     bool
	Entries []eclipseClasspathEntry
}

type eclipseClasspathEntry struct {
	Kind string `xml:"kind,attr"`
	Path string `xml:"path,attr"`
}

// eclipseProjectsIn finds the Eclipse Java projects of root: root itself, or its direct children for a
// workspace folder. Projects managed by Maven or Gradle are left to JDT LS's own importers.
func eclipseProjectsIn(root string) []eclipseProject {
	var projects []eclipseProject
	if project, ok := readEclipseProject(root); ok {
		return []eclipseProject{project}
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil
	}
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") || len(projects) >= maxEclipseProjects {
			continue
		}
		if project, ok := readEclipseProject(filepath.Join(root, entry.Name())); ok {
			projects = append(projects, project)
		}
	}
	return projects
}

func readEclipseProject(dir string) (eclipseProject, bool) {
	if _, managed := unitIn(dir); managed {
		return eclipseProject{}, false
	}
	description, err := readLimited(filepath.Join(dir, ".project"))
	if err != nil || !bytes.Contains(description, []byte(eclipseJavaNature)) {
		return eclipseProject{}, false
	}
	data, err := readLimited(filepath.Join(dir, ".classpath"))
	if err != nil {
		return eclipseProject{}, false
	}
	var parsed struct {
		Name string `xml:"name"`
	}
	_ = xml.Unmarshal(description, &parsed) // a malformed .project keeps the folder name
	var classpath struct {
		Entries []eclipseClasspathEntry `xml:"classpathentry"`
	}
	if err := xml.Unmarshal(data, &classpath); err != nil {
		return eclipseProject{}, false
	}
	name := strings.TrimSpace(parsed.Name)
	if name == "" {
		name = filepath.Base(dir)
	}
	wtp := bytes.Contains(data, []byte("org.eclipse.jst.")) || bytes.Contains(description, []byte("org.eclipse.wst.common"))
	return eclipseProject{Name: name, Dir: dir, WTP: wtp, Entries: classpath.Entries}, true
}

// HasEclipseWebProjects reports whether root holds Eclipse projects with WTP containers: those need the
// shadow workspace for JDT LS. Plain Eclipse Java projects alone are imported as they are.
func HasEclipseWebProjects(root string) bool {
	return slices.ContainsFunc(eclipseProjectsIn(root), func(project eclipseProject) bool { return project.WTP })
}

// EclipseShadow is the result of WriteEclipseShadowWorkspace: the projects written and what could not be
// resolved (shown to the user, never fatal).
type EclipseShadow struct {
	Projects []string
	Problems []string
}

// WriteEclipseShadowWorkspace writes the shadow of every Eclipse Java project of root into dest.
// catalinaHome resolves the server runtime container ("" = CATALINA_HOME).
func WriteEclipseShadowWorkspace(root, dest, catalinaHome string) (EclipseShadow, error) {
	projects := eclipseProjectsIn(root)
	byName := make(map[string]eclipseProject, len(projects))
	for _, project := range projects {
		byName[project.Name] = project
	}
	var shadow EclipseShadow
	for _, project := range projects {
		resolved, problems := resolveEclipseProject(project, byName, catalinaHome)
		shadow.Problems = append(shadow.Problems, problems...)
		if err := eclipsepde.WriteJavaShadowProject(filepath.Join(dest, project.Name), resolved); err != nil {
			return shadow, err
		}
		shadow.Projects = append(shadow.Projects, project.Name)
	}
	return shadow, eclipsepde.RemoveStaleShadowProjects(dest, shadow.Projects)
}

// resolveEclipseProject turns the .classpath of a project into the shadow's plain entries.
func resolveEclipseProject(project eclipseProject, byName map[string]eclipseProject, catalinaHome string) (eclipsepde.JavaShadowProject, []string) {
	shadow := eclipsepde.JavaShadowProject{Name: project.Name, Level: eclipseJavaLevel(project.Dir), Encoding: eclipseEncoding(project.Dir)}
	var problems []string
	addLibrary := func(path string) {
		if path != "" && fileOrFolderExists(path) && !slices.Contains(shadow.Libraries, path) {
			shadow.Libraries = append(shadow.Libraries, path)
		}
	}
	addProject := func(name string) {
		if _, ok := byName[name]; ok && name != project.Name && !slices.Contains(shadow.Projects, name) {
			shadow.Projects = append(shadow.Projects, name)
		}
	}
	for _, entry := range project.Entries {
		switch entry.Kind {
		case "src":
			if strings.HasPrefix(entry.Path, "/") {
				addProject(strings.TrimPrefix(entry.Path, "/"))
			} else if source := filepath.Join(project.Dir, filepath.FromSlash(entry.Path)); isDirectory(source) {
				shadow.Sources = append(shadow.Sources, source)
			}
		case "lib":
			addLibrary(eclipseLibraryPath(project, entry.Path, byName))
		case "var":
			addLibrary(eclipseVariablePath(entry.Path))
		case "con":
			switch {
			case strings.HasPrefix(entry.Path, jreContainerPrefix):
				// the shadow always has the JRE
			case strings.HasPrefix(entry.Path, serverRuntimePrefix):
				jars, err := serverRuntimeJars(catalinaHome)
				if err != nil {
					problems = append(problems, project.Name+": "+err.Error())
				}
				for _, jar := range jars {
					addLibrary(jar)
				}
			case entry.Path == webLibrariesContainer:
				for _, jar := range jarsIn(filepath.Join(webRootOf(project.Dir), "WEB-INF", "lib")) {
					addLibrary(jar)
				}
			case entry.Path == moduleContainer:
				for _, name := range dependentModules(project.Dir) {
					addProject(name)
				}
			case strings.HasPrefix(entry.Path, junitContainerPrefix):
				shadow.Containers = append(shadow.Containers, entry.Path)
			}
		}
	}
	return shadow, problems
}

// eclipseLibraryPath resolves a lib entry: relative to the project, a workspace path (/Project/lib/a.jar)
// or an absolute path on disk.
func eclipseLibraryPath(project eclipseProject, path string, byName map[string]eclipseProject) string {
	if !strings.HasPrefix(path, "/") && !filepath.IsAbs(path) {
		return filepath.Join(project.Dir, filepath.FromSlash(path))
	}
	if first, rest, ok := strings.Cut(strings.TrimPrefix(path, "/"), "/"); ok {
		if owner, known := byName[first]; known {
			return filepath.Join(owner.Dir, filepath.FromSlash(rest))
		}
	}
	return filepath.FromSlash(path)
}

// eclipseVariablePath resolves a var entry (TOMCAT_HOME/lib/x.jar) from an environment variable of the
// same name; Eclipse's own variables are not known outside Eclipse.
func eclipseVariablePath(path string) string {
	name, rest, _ := strings.Cut(path, "/")
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return ""
	}
	return filepath.Join(value, filepath.FromSlash(rest))
}

// serverRuntimeJars are the API jars of the Tomcat a WTP project targets: everything in CATALINA_HOME/lib.
func serverRuntimeJars(catalinaHome string) ([]string, error) {
	home, err := resolveCatalinaHome(catalinaHome)
	if err != nil {
		return nil, fmt.Errorf("the server runtime of the project (servlet and JSP APIs) is unknown: %w", err)
	}
	return jarsIn(filepath.Join(home, "lib")), nil
}

func jarsIn(folder string) []string {
	entries, err := os.ReadDir(folder)
	if err != nil {
		return nil
	}
	var jars []string
	for _, entry := range entries {
		if !entry.IsDir() && strings.EqualFold(filepath.Ext(entry.Name()), ".jar") {
			jars = append(jars, filepath.Join(folder, entry.Name()))
		}
	}
	return jars
}

var webRootResource = regexp.MustCompile(`<wb-resource\s+deploy-path="/"\s+source-path="([^"]+)"`)

// webRootOf is the web content folder of a WTP project (.settings/org.eclipse.wst.common.component),
// WebContent by default.
func webRootOf(projectDir string) string {
	if data, err := readLimited(filepath.Join(projectDir, ".settings", "org.eclipse.wst.common.component")); err == nil {
		if match := webRootResource.FindSubmatch(data); match != nil {
			return filepath.Join(projectDir, filepath.FromSlash(strings.TrimPrefix(string(match[1]), "/")))
		}
	}
	return filepath.Join(projectDir, "WebContent")
}

// dependentModules are the projects a WTP module deploys with it (EJB and utility projects).
func dependentModules(projectDir string) []string {
	data, err := readLimited(filepath.Join(projectDir, ".settings", "org.eclipse.wst.common.component"))
	if err != nil {
		return nil
	}
	var names []string
	for _, match := range dependentModule.FindAllSubmatch(data, -1) {
		names = append(names, string(match[1]))
	}
	return names
}

var compliancePattern = regexp.MustCompile(`(?m)^org\.eclipse\.jdt\.core\.compiler\.compliance=([\d.]+)`)

// eclipseJavaLevel is the project's compliance, raised to 1.8: JDT LS compiles nothing older, and Java
// 6/7 sources are valid 1.8 (the real build keeps its own level).
func eclipseJavaLevel(projectDir string) string {
	level := shadowMinimumLevel
	if data, err := readLimited(filepath.Join(projectDir, ".settings", "org.eclipse.jdt.core.prefs")); err == nil {
		if match := compliancePattern.FindSubmatch(data); match != nil {
			if found := Major(string(match[1])); found > level {
				level = found
			}
		}
	}
	if level <= shadowMinimumLevel {
		return "1." + strconv.Itoa(shadowMinimumLevel)
	}
	return strconv.Itoa(level)
}

var encodingPattern = regexp.MustCompile(`(?m)^encoding/<project>=(\S+)`)

func eclipseEncoding(projectDir string) string {
	data, err := readLimited(filepath.Join(projectDir, ".settings", "org.eclipse.core.resources.prefs"))
	if err != nil {
		return ""
	}
	if match := encodingPattern.FindSubmatch(data); match != nil {
		return string(match[1])
	}
	return ""
}

func fileOrFolderExists(path string) bool {
	_, err := os.Stat(path) // #nosec G703 -- a classpath entry of the opened project
	return err == nil
}

// EclipseSourceFolders are the source folders of an Eclipse project (.classpath kind="src"), used to find
// the main classes of Ant projects; nil without a .classpath.
func EclipseSourceFolders(projectDir string) []string {
	project, ok := readEclipseProject(projectDir)
	if !ok {
		return nil
	}
	var folders []string
	for _, entry := range project.Entries {
		if entry.Kind == "src" && !strings.HasPrefix(entry.Path, "/") {
			folders = append(folders, filepath.Join(projectDir, filepath.FromSlash(entry.Path)))
		}
	}
	return folders
}
