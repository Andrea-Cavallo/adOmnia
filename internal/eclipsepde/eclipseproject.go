package eclipsepde

import (
	"encoding/xml"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// EclipseProject is the read-only model of one PDE project as Eclipse stores it:
// `.project`, `.classpath`, `build.properties` and the bundle manifest. Nothing
// here is written back to disk (spec section 6: import never alters the original
// workspace).
type EclipseProject struct {
	// Name is the Eclipse project name from .project (not necessarily the folder).
	Name string
	// Dir is the absolute project directory.
	Dir string
	// Natures lists .project natures (e.g. org.eclipse.pde.PluginNature).
	Natures []string
	// Builders lists the build command names in order.
	Builders []string
	// ClasspathEntries comes from .classpath.
	ClasspathEntries []ClasspathEntry
	// BuildProperties is the parsed build.properties (nil when absent).
	BuildProperties map[string]string
	// Bundle is the parsed META-INF/MANIFEST.MF (nil for non-bundle projects).
	Bundle *Bundle
	// PdeFiles lists the PDE metadata files present in the project, relative to
	// it: plugin.xml, feature.xml, *.product, *.launch, build.properties
	// (spec section 5: recognize them when present, never assume they exist).
	PdeFiles []string
	// Problems collects non-fatal issues found while reading (missing libs,
	// absolute paths that will not resolve elsewhere, malformed files...).
	Problems []Problem
}

// ClasspathEntry is one `.classpath` entry.
type ClasspathEntry struct {
	// Kind is "src", "output", "lib", "con", "var" or "src"-like containers.
	Kind string
	Path string
	// Sourcepath is the optional sources attachment of a lib entry.
	Sourcepath string
	// Exported mirrors the exported attribute (contributes to dependents).
	Exported bool
}

// Problem is one non-fatal issue discovered during import or resolution.
type Problem struct {
	// Severity is "error", "warning" or "info".
	Severity string
	// Project is the owning project name, when the problem is project-scoped.
	Project string
	// File is the file the problem refers to, relative to the workspace when possible.
	File string
	// Message is a human-readable, actionable description.
	Message string
}

func (p Problem) String() string {
	loc := p.Project
	if p.File != "" {
		if loc != "" {
			loc += ": "
		}
		loc += p.File
	}
	if loc != "" {
		return fmt.Sprintf("%s: %s: %s", p.Severity, loc, p.Message)
	}
	return fmt.Sprintf("%s: %s", p.Severity, p.Message)
}

// ReadEclipseProject loads one project directory. It never writes anything.
// A missing .project is an error; a missing MANIFEST.MF just means the project
// is not a bundle.
func ReadEclipseProject(dir string) (*EclipseProject, error) {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("%s: not a directory", abs)
	}
	proj := &EclipseProject{Dir: abs}

	projectFile := filepath.Join(abs, ".project")
	raw, err := os.ReadFile(projectFile)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", projectFile, err)
	}
	if err := parseProjectXML(raw, proj); err != nil {
		return nil, fmt.Errorf("%s: %w", projectFile, err)
	}

	if raw, err := os.ReadFile(filepath.Join(abs, ".classpath")); err == nil {
		entries, perr := parseClasspathXML(raw)
		if perr != nil {
			proj.Problems = append(proj.Problems, Problem{
				Severity: "error", Project: proj.Name, File: ".classpath",
				Message: "malformed .classpath: " + perr.Error(),
			})
		} else {
			proj.ClasspathEntries = entries
		}
	}

	if raw, err := os.ReadFile(filepath.Join(abs, "build.properties")); err == nil {
		props, perr := ParseBuildProperties(string(raw))
		if perr != nil {
			proj.Problems = append(proj.Problems, Problem{
				Severity: "error", Project: proj.Name, File: "build.properties",
				Message: "malformed build.properties: " + perr.Error(),
			})
		} else {
			proj.BuildProperties = props
		}
	}

	manifestPath := filepath.Join(abs, "META-INF", "MANIFEST.MF")
	if raw, err := os.ReadFile(manifestPath); err == nil {
		bundle, berr := ParseBundle(raw, abs)
		if berr != nil {
			proj.Problems = append(proj.Problems, Problem{
				Severity: "error", Project: proj.Name, File: filepath.Join("META-INF", "MANIFEST.MF"),
				Message: "malformed bundle manifest: " + berr.Error(),
			})
		} else {
			proj.Bundle = bundle
		}
	}

	proj.reportLocalProblems()
	proj.reportExecutionEnvironment()
	proj.scanPdeFiles()
	return proj, nil
}

// pdeFileNames are the PDE metadata files to recognize when present.
var pdeFileNames = []string{"plugin.xml", "feature.xml", "build.properties"}

// scanPdeFiles records which PDE metadata files the project carries: the
// extension points file, the feature definition, product and launch
// configurations (spec section 5).
func (p *EclipseProject) scanPdeFiles() {
	for _, name := range pdeFileNames {
		if fileExists(filepath.Join(p.Dir, name)) {
			p.PdeFiles = append(p.PdeFiles, name)
		}
	}
	if fileExists(filepath.Join(p.Dir, "META-INF", "MANIFEST.MF")) {
		p.PdeFiles = append(p.PdeFiles, filepath.ToSlash(filepath.Join("META-INF", "MANIFEST.MF")))
	}
	if entries, err := os.ReadDir(p.Dir); err == nil {
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			ext := strings.ToLower(filepath.Ext(entry.Name()))
			if ext == ".product" || ext == ".launch" {
				p.PdeFiles = append(p.PdeFiles, entry.Name())
			}
		}
	}
	sort.Strings(p.PdeFiles)
}

// HasPdeFile reports whether the project carries the given PDE metadata file.
func (p *EclipseProject) HasPdeFile(name string) bool {
	for _, f := range p.PdeFiles {
		if f == name {
			return true
		}
	}
	return false
}

// reportExecutionEnvironment flags the JDK requirement of the bundle
// (spec section 6: "Rilevare JDK richiesto e preferenze di compilazione")
// and unknown execution environments that cannot be judged.
func (p *EclipseProject) reportExecutionEnvironment() {
	if p.Bundle == nil || p.Bundle.ExecutionEnvironment == "" {
		return
	}
	ee := p.Bundle.ExecutionEnvironment
	if _, err := ParseExecutionEnvironment(ee); err != nil {
		p.Problems = append(p.Problems, Problem{
			Severity: "warning", Project: p.Name, File: filepath.Join("META-INF", "MANIFEST.MF"),
			Message: fmt.Sprintf("unrecognized Bundle-RequiredExecutionEnvironment %q: JDK requirement cannot be determined", ee),
		})
		return
	}
	if _, ok := MaxClassVersion(ee); !ok {
		p.Problems = append(p.Problems, Problem{
			Severity: "info", Project: p.Name, File: filepath.Join("META-INF", "MANIFEST.MF"),
			Message: fmt.Sprintf("requires %s (bytecode level of this EE is not known to the checker)", ee),
		})
	}
}

// reportLocalProblems flags the import-time issues the spec calls out: absolute
// paths and missing libraries in .classpath (section 6).
func (p *EclipseProject) reportLocalProblems() {
	for _, e := range p.ClasspathEntries {
		switch e.Kind {
		case "lib":
			if filepath.IsAbs(e.Path) {
				p.Problems = append(p.Problems, Problem{
					Severity: "warning", Project: p.Name, File: ".classpath",
					Message: fmt.Sprintf("library %q uses an absolute path: it will not resolve on other machines", e.Path),
				})
				continue
			}
			if !fileExists(filepath.Join(p.Dir, e.Path)) {
				p.Problems = append(p.Problems, Problem{
					Severity: "warning", Project: p.Name, File: ".classpath",
					Message: fmt.Sprintf("library %q does not exist in the project", e.Path),
				})
			}
		case "src":
			if e.Path == "" {
				continue
			}
			if !fileExists(filepath.Join(p.Dir, e.Path)) {
				p.Problems = append(p.Problems, Problem{
					Severity: "warning", Project: p.Name, File: ".classpath",
					Message: fmt.Sprintf("source folder %q does not exist", e.Path),
				})
			}
		}
	}
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// eclipseProjectXML mirrors the `.project` structure.
type eclipseProjectXML struct {
	Name      string `xml:"name"`
	BuildSpec []struct {
		Name string `xml:"name"`
	} `xml:"buildSpec>buildCommand"`
	Natures []struct {
		Nature string `xml:",chardata"`
	} `xml:"natures>nature"`
	LinkedResources []struct {
		Link struct {
			Name     string `xml:"name"`
			Type     string `xml:"type"`
			Location string `xml:"location"`
		} `xml:"link"`
	} `xml:"linkedResources>link"`
}

func parseProjectXML(raw []byte, proj *EclipseProject) error {
	var doc eclipseProjectXML
	if err := xml.Unmarshal(raw, &doc); err != nil {
		return fmt.Errorf("malformed .project: %w", err)
	}
	if doc.Name == "" {
		return fmt.Errorf(".project has no <name>")
	}
	proj.Name = doc.Name
	for _, b := range doc.BuildSpec {
		proj.Builders = append(proj.Builders, b.Name)
	}
	for _, n := range doc.Natures {
		proj.Natures = append(proj.Natures, n.Nature)
	}
	return nil
}

type eclipseClasspathXML struct {
	Entries []struct {
		Kind       string `xml:"kind,attr"`
		Path       string `xml:"path,attr"`
		Sourcepath string `xml:"sourcepath,attr"`
		Exported   string `xml:"exported,attr"`
	} `xml:"classpathentry"`
}

func parseClasspathXML(raw []byte) ([]ClasspathEntry, error) {
	var doc eclipseClasspathXML
	if err := xml.Unmarshal(raw, &doc); err != nil {
		return nil, err
	}
	entries := make([]ClasspathEntry, 0, len(doc.Entries))
	for _, e := range doc.Entries {
		entries = append(entries, ClasspathEntry{
			Kind:       e.Kind,
			Path:       e.Path,
			Sourcepath: e.Sourcepath,
			Exported:   strings.EqualFold(e.Exported, "true"),
		})
	}
	return entries, nil
}

// ParseBuildProperties parses the PDE build.properties format: `key=value`
// lines, `\` continuations, `#` comments.
func ParseBuildProperties(text string) (map[string]string, error) {
	props := map[string]string{}
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	for i := 0; i < len(lines); i++ {
		line := strings.TrimSpace(lines[i])
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "!") {
			continue
		}
		for strings.HasSuffix(line, "\\") && i+1 < len(lines) {
			line = strings.TrimSuffix(line, "\\") + strings.TrimSpace(lines[i+1])
			i++
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			key, value, ok = strings.Cut(line, ":")
		}
		if !ok {
			return nil, fmt.Errorf("malformed build.properties line %q: expected key=value", line)
		}
		props[strings.TrimSpace(key)] = strings.TrimSpace(value)
	}
	return props, nil
}

// IsPdePlugin reports whether the project is an OSGi bundle (PDE plug-in).
func (p *EclipseProject) IsPdePlugin() bool {
	return p.Bundle != nil
}

// HasNature reports whether the project declares the given .project nature.
func (p *EclipseProject) HasNature(nature string) bool {
	for _, n := range p.Natures {
		if n == nature {
			return true
		}
	}
	return false
}
