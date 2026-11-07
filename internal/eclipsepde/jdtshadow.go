package eclipsepde

import (
	"encoding/xml"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strconv"
)

// shadowJavaLevel is the lowest level JDT LS compiles: a Java 6 bundle is checked at 1.8, which
// accepts its sources. The real build stays on the ECJ of the target at the bundle's own level.
const shadowJavaLevel = 8

// ShadowWorkspace is a folder of plain Java projects that mirrors a PDE workspace for JDT LS:
// one project per bundle, its source folders linked to the real ones, the target bundles it
// requires as libraries and the workspace bundles as project references. JDT LS knows no PDE
// and no target platform, so it is given this instead of the real metadata, which it never sees
// and never writes.
type ShadowWorkspace struct {
	Root     string
	Projects []string
	Problems []Problem
}

// WriteShadowWorkspace (re)writes the shadow workspace of root in dest. Projects of a previous
// run that are gone are removed, so a deleted bundle does not linger in the language server.
func WriteShadowWorkspace(root, dest string) (*ShadowWorkspace, error) {
	ws, target, err := openWorkspaceTarget(root)
	if err != nil {
		return nil, err
	}
	resolver := NewResolver(withWorkspace(target, ws))
	byName := map[string]*EclipseProject{}
	for _, project := range ws.Bundles() {
		byName[project.Bundle.SymbolicName] = project
	}
	shadow := &ShadowWorkspace{Root: dest}
	for _, project := range ws.Bundles() {
		sources := project.sourceFolders()
		if len(sources) == 0 {
			continue // a binary bundle: nothing to edit, its jar reaches the others as a library
		}
		elements, problems := resolver.BuildClasspath(project)
		shadow.Problems = append(shadow.Problems, problems...)
		name := project.Bundle.SymbolicName
		if err := writeShadowProject(filepath.Join(dest, name), name, project, sources, elements, byName); err != nil {
			return nil, err
		}
		shadow.Projects = append(shadow.Projects, name)
	}
	if err := removeStaleShadowProjects(dest, shadow.Projects); err != nil {
		return nil, err
	}
	return shadow, nil
}

func writeShadowProject(dir, name string, project *EclipseProject, sources []string, elements []ClasspathElement, byName map[string]*EclipseProject) error {
	if err := os.MkdirAll(filepath.Join(dir, ".settings"), 0o755); err != nil {
		return fmt.Errorf("cannot create the JDT LS project of %s: %w", name, err)
	}
	links := make([]shadowLink, 0, len(sources))
	entries := make([]shadowEntry, 0, len(sources)+len(elements)+2)
	for index, source := range sources {
		link := "src" + strconv.Itoa(index)
		links = append(links, shadowLink{Name: link, Type: 2, Location: filepath.ToSlash(source)})
		entries = append(entries, shadowEntry{Kind: "src", Path: link})
	}
	entries = append(entries, shadowEntry{Kind: "con", Path: "org.eclipse.jdt.launching.JRE_CONTAINER"})
	var seen []string
	addLibrary := func(path string) {
		if fileExists(path) && !slices.Contains(seen, path) {
			seen = append(seen, path)
			entries = append(entries, shadowEntry{Kind: "lib", Path: filepath.ToSlash(path)})
		}
	}
	for _, library := range project.libraries() {
		addLibrary(library)
	}
	for _, element := range elements {
		if element.Kind != "project" {
			addLibrary(element.Path)
			continue
		}
		dependency, ok := byName[element.Path]
		if !ok || dependency == project {
			continue
		}
		if len(dependency.sourceFolders()) == 0 {
			for _, library := range dependency.libraries() {
				addLibrary(library)
			}
			continue
		}
		entries = append(entries, shadowEntry{Kind: "src", Path: "/" + element.Path, CombineAccessRules: "false"})
	}
	entries = append(entries, shadowEntry{Kind: "output", Path: "bin"})

	description, err := xml.MarshalIndent(shadowDescription{Name: name, Natures: []string{"org.eclipse.jdt.core.javanature"}, Builders: []shadowBuilder{{Name: "org.eclipse.jdt.core.javabuilder"}}, Links: links}, "", "\t")
	if err != nil {
		return err
	}
	classpath, err := xml.MarshalIndent(shadowClasspath{Entries: entries}, "", "\t")
	if err != nil {
		return err
	}
	level := "1." + strconv.Itoa(shadowLevel(project))
	prefs := "eclipse.preferences.version=1\n" +
		"org.eclipse.jdt.core.compiler.compliance=" + level + "\n" +
		"org.eclipse.jdt.core.compiler.source=" + level + "\n" +
		"org.eclipse.jdt.core.compiler.codegen.targetPlatform=" + level + "\n"
	if encoding := project.BuildProperties["javacDefaultEncoding.."]; encoding != "" {
		prefs += "encoding/<project>=" + encoding + "\n"
	}
	files := map[string][]byte{
		".project":   append([]byte(xml.Header), description...),
		".classpath": append([]byte(xml.Header), classpath...),
		filepath.Join(".settings", "org.eclipse.jdt.core.prefs"): []byte(prefs),
	}
	for file, content := range files {
		if err := writeIfChanged(filepath.Join(dir, file), content); err != nil {
			return fmt.Errorf("cannot write the JDT LS project of %s: %w", name, err)
		}
	}
	return nil
}

// shadowLevel is the bundle's Java level, raised to what JDT LS compiles.
func shadowLevel(project *EclipseProject) int {
	level, ok := executionEnvironmentLevel(firstEnvironment(project.Bundle.ExecutionEnvironment))
	if !ok || level < shadowJavaLevel {
		return shadowJavaLevel
	}
	return level
}

// writeIfChanged leaves an identical file alone: JDT LS re-imports a project whose metadata changes.
func writeIfChanged(path string, content []byte) error {
	if current, err := os.ReadFile(path); err == nil && string(current) == string(content) {
		return nil
	}
	return os.WriteFile(path, content, 0o644)
}

func removeStaleShadowProjects(dest string, keep []string) error {
	entries, err := os.ReadDir(dest)
	if err != nil {
		return nil //nolint:nilerr // nothing written yet, nothing to remove
	}
	for _, entry := range entries {
		if !entry.IsDir() || slices.Contains(keep, entry.Name()) || !fileExists(filepath.Join(dest, entry.Name(), ".project")) {
			continue
		}
		if err := os.RemoveAll(filepath.Join(dest, entry.Name())); err != nil {
			return fmt.Errorf("cannot remove the stale JDT LS project %s: %w", entry.Name(), err)
		}
	}
	return nil
}

type shadowDescription struct {
	XMLName  xml.Name        `xml:"projectDescription"`
	Name     string          `xml:"name"`
	Comment  string          `xml:"comment"`
	Builders []shadowBuilder `xml:"buildSpec>buildCommand"`
	Natures  []string        `xml:"natures>nature"`
	Links    []shadowLink    `xml:"linkedResources>link"`
}

type shadowBuilder struct {
	Name string `xml:"name"`
}

type shadowLink struct {
	Name     string `xml:"name"`
	Type     int    `xml:"type"`
	Location string `xml:"location"`
}

type shadowClasspath struct {
	XMLName xml.Name      `xml:"classpath"`
	Entries []shadowEntry `xml:"classpathentry"`
}

type shadowEntry struct {
	Kind               string `xml:"kind,attr"`
	Path               string `xml:"path,attr"`
	CombineAccessRules string `xml:"combineaccessrules,attr,omitempty"`
}

// HasActiveTarget reports whether the workspace has chosen a target platform: without one the
// bundles have no classpath, and a language server could only report missing types.
func HasActiveTarget(root string) bool {
	settings, err := LoadTargetSettings(root)
	if err != nil || settings.Active == "" {
		return false
	}
	for _, profile := range settings.Profiles {
		if profile.Name == settings.Active {
			return true
		}
	}
	return false
}
