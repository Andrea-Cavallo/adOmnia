package eclipsepde

import (
	"archive/zip"
	"bytes"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// ExportResult is what an export wrote: a folder with plugins/ and features/, the layout of an
// Eclipse installation, of a dropins folder and of the input of the p2 publisher.
type ExportResult struct {
	Folder   string    `json:"folder"`
	Bundles  []string  `json:"bundles"`
	Features []string  `json:"features"`
	Problems []Problem `json:"problems"`
	// Qualifier is what replaced ".qualifier" in the versions.
	Qualifier string `json:"qualifier"`
}

// exportQualifier is PDE's default: "v" + build date and time.
func exportQualifier(now time.Time) string {
	return "v" + now.UTC().Format("20060102-1504")
}

// ExportBundles writes every compiled workspace bundle as a jar of its bin.includes, and every
// workspace feature with the real versions of its plug-ins, into dest/plugins and dest/features.
// The bundles must be built first: the classes come from their output folders.
func ExportBundles(root, dest string, now time.Time) (*ExportResult, error) {
	ws, target, err := openWorkspaceTarget(root)
	if err != nil {
		return nil, err
	}
	if dest == "" {
		return nil, errors.New("choose the export folder")
	}
	result := &ExportResult{Folder: dest, Bundles: []string{}, Features: []string{}, Problems: []Problem{}, Qualifier: exportQualifier(now)}
	versions := map[string]string{}
	for _, project := range ws.Bundles() {
		name, version, problems, err := exportBundle(project, filepath.Join(dest, "plugins"), result.Qualifier)
		if err != nil {
			return nil, err
		}
		result.Problems = append(result.Problems, problems...)
		if name != "" {
			versions[project.Bundle.SymbolicName] = version
			result.Bundles = append(result.Bundles, name)
		}
	}
	for _, project := range ws.Projects {
		if !fileExists(filepath.Join(project.Dir, "feature.xml")) {
			continue
		}
		name, problems, err := exportFeature(project, filepath.Join(dest, "features"), result.Qualifier, versions, target)
		if err != nil {
			return nil, err
		}
		result.Problems = append(result.Problems, problems...)
		result.Features = append(result.Features, name)
	}
	if len(result.Bundles) == 0 && len(result.Features) == 0 {
		return nil, errors.New("nothing to export: build the bundles first (Java > Build OSGi Bundles)")
	}
	return result, nil
}

// qualified replaces the ".qualifier" segment of a version, as the PDE build does.
func qualified(version, qualifier string) string {
	return strings.Replace(version, "qualifier", qualifier, 1)
}

var bundleVersionLine = regexp.MustCompile(`(?mi)^(Bundle-Version:[ \t]*)(\S+)`)

// exportBundle writes one bundle jar: the manifest first (JarInputStream needs it there), then the
// bin.includes entries, "." being the classes of the output folder.
func exportBundle(project *EclipseProject, folder, qualifier string) (name, version string, problems []Problem, err error) {
	sources := project.sourceFolders()
	output, err := project.outputFolder()
	if err != nil {
		return "", "", nil, err
	}
	if len(sources) > 0 && !fileExists(output) {
		return "", "", []Problem{{Severity: "error", Project: project.Name, Message: "not exported: it is not compiled, build the bundles first"}}, nil
	}
	manifest, err := os.ReadFile(filepath.Join(project.Dir, "META-INF", "MANIFEST.MF"))
	if err != nil {
		return "", "", nil, fmt.Errorf("%s: %w", project.Name, err)
	}
	version = qualified(project.Bundle.Version.String(), qualifier)
	if match := bundleVersionLine.FindSubmatch(manifest); match != nil {
		version = qualified(string(match[2]), qualifier)
		manifest = bundleVersionLine.ReplaceAll(manifest, []byte("${1}"+version))
	}
	includes := splitList(project.BuildProperties["bin.includes"])
	if len(includes) == 0 {
		includes = []string{"META-INF/", "."}
		problems = append(problems, Problem{Severity: "warning", Project: project.Name, File: "build.properties", Message: "no bin.includes: exported META-INF and the classes only"})
	}
	excludes := splitList(project.BuildProperties["bin.excludes"])
	name = project.Bundle.SymbolicName + "_" + version + ".jar"
	if err := os.MkdirAll(folder, 0o755); err != nil {
		return "", "", nil, err
	}
	var buffer bytes.Buffer
	jar := zip.NewWriter(&buffer)
	if err := writeZipEntry(jar, "META-INF/MANIFEST.MF", manifest); err != nil {
		return "", "", nil, err
	}
	written := map[string]bool{"META-INF/MANIFEST.MF": true}
	for _, include := range includes {
		if include == "." {
			if err := addTree(jar, output, "", excludes, written); err != nil {
				return "", "", nil, fmt.Errorf("%s: %w", project.Name, err)
			}
			continue
		}
		path := filepath.Join(project.Dir, filepath.FromSlash(include))
		if _, within := relativeWithin(project.Dir, path); !within {
			problems = append(problems, Problem{Severity: "warning", Project: project.Name, File: "build.properties", Message: include + " is outside the project: not exported"})
			continue
		}
		if !fileExists(path) {
			// A jar built from source.<name>.jar is a nested library PDE compiles separately.
			problems = append(problems, Problem{Severity: "warning", Project: project.Name, File: "build.properties", Message: include + " is in bin.includes but does not exist: not exported"})
			continue
		}
		if err := addTree(jar, path, strings.TrimSuffix(include, "/"), excludes, written); err != nil {
			return "", "", nil, fmt.Errorf("%s: %w", project.Name, err)
		}
	}
	if err := jar.Close(); err != nil {
		return "", "", nil, err
	}
	if err := os.WriteFile(filepath.Join(folder, name), buffer.Bytes(), 0o644); err != nil {
		return "", "", nil, err
	}
	return name, version, problems, nil
}

// addTree adds a file or a folder under prefix, skipping bin.excludes and what is already there.
func addTree(jar *zip.Writer, source, prefix string, excludes []string, written map[string]bool) error {
	return filepath.WalkDir(source, func(file string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		relative, _ := filepath.Rel(source, file)
		name := path.Join(prefix, filepath.ToSlash(relative))
		if relative == "." {
			name = prefix
		}
		if written[name] || excluded(name, excludes) {
			return nil
		}
		data, err := os.ReadFile(file)
		if err != nil {
			return err
		}
		written[name] = true
		return writeZipEntry(jar, name, data)
	})
}

func excluded(name string, excludes []string) bool {
	for _, exclude := range excludes {
		if exclude = strings.TrimSuffix(exclude, "/"); name == exclude || strings.HasPrefix(name, exclude+"/") {
			return true
		}
	}
	return false
}

func writeZipEntry(jar *zip.Writer, name string, data []byte) error {
	writer, err := jar.Create(name)
	if err != nil {
		return err
	}
	_, err = io.Copy(writer, bytes.NewReader(data))
	return err
}

func splitList(value string) []string {
	var items []string
	for item := range strings.SplitSeq(value, ",") {
		if item = strings.TrimSpace(item); item != "" {
			items = append(items, item)
		}
	}
	return items
}

var (
	featureVersionAttr = regexp.MustCompile(`(<feature\b[^>]*?\bversion=")([^"]*)(")`)
	pluginElement      = regexp.MustCompile(`<plugin\b[^>]*>`)
	idAttr             = regexp.MustCompile(`\bid="([^"]*)"`)
	versionAttr        = regexp.MustCompile(`\bversion="([^"]*)"`)
)

// exportFeature writes features/<id>_<version>.jar: feature.xml with the qualifier applied and
// every plug-in at "0.0.0" pinned to the version that was exported (or the target's).
func exportFeature(project *EclipseProject, folder, qualifier string, versions map[string]string, target *BundleIndex) (string, []Problem, error) {
	raw, err := os.ReadFile(filepath.Join(project.Dir, "feature.xml"))
	if err != nil {
		return "", nil, err
	}
	text := string(raw)
	var problems []Problem
	version := "0.0.0"
	if match := featureVersionAttr.FindStringSubmatch(text); match != nil {
		version = qualified(match[2], qualifier)
		text = featureVersionAttr.ReplaceAllString(text, "${1}"+version+"${3}")
	}
	text = pluginElement.ReplaceAllStringFunc(text, func(element string) string {
		id := idAttr.FindStringSubmatch(element)
		current := versionAttr.FindStringSubmatch(element)
		if id == nil || (current != nil && current[1] != "0.0.0") {
			return element
		}
		resolved, ok := versions[id[1]]
		if !ok {
			if entry, _, found := target.BestMatch(id[1], VersionRange{}, false); found {
				resolved, ok = entry.Bundle.Version.String(), true
			}
		}
		if !ok {
			problems = append(problems, Problem{Severity: "warning", Project: project.Name, File: "feature.xml", Message: id[1] + " is in the feature but not in the workspace or the target: left at 0.0.0"})
			return element
		}
		if current == nil {
			return strings.Replace(element, "<plugin", `<plugin version="`+resolved+`"`, 1)
		}
		return versionAttr.ReplaceAllString(element, `version="`+resolved+`"`)
	})
	id := project.Name
	if match := regexp.MustCompile(`<feature\b[^>]*?\bid="([^"]*)"`).FindStringSubmatch(text); match != nil {
		id = match[1]
	}
	if err := os.MkdirAll(folder, 0o755); err != nil {
		return "", nil, err
	}
	var buffer bytes.Buffer
	jar := zip.NewWriter(&buffer)
	if err := writeZipEntry(jar, "feature.xml", []byte(text)); err != nil {
		return "", nil, err
	}
	written := map[string]bool{"feature.xml": true}
	includes := splitList(project.BuildProperties["bin.includes"])
	for _, include := range includes {
		path := filepath.Join(project.Dir, filepath.FromSlash(include))
		if _, within := relativeWithin(project.Dir, path); !within || !fileExists(path) {
			continue
		}
		if err := addTree(jar, path, strings.TrimSuffix(include, "/"), nil, written); err != nil {
			return "", nil, err
		}
	}
	if err := jar.Close(); err != nil {
		return "", nil, err
	}
	name := id + "_" + version + ".jar"
	return name, problems, os.WriteFile(filepath.Join(folder, name), buffer.Bytes(), 0o644)
}

// PublishP2 is the command that turns an export folder into a p2 repository with the publisher of
// the target platform, as PDE does: it runs on the project JVM through the target's launcher. It
// returns an error when the target has no publisher (an installation without p2).
func PublishP2(root, folder string) (*Launch, error) {
	_, target, err := openWorkspaceTarget(root)
	if err != nil {
		return nil, err
	}
	launcher, _, ok := target.BestMatch("org.eclipse.equinox.launcher", VersionRange{}, false)
	if !ok || launcher.Exploded {
		return nil, errors.New("the target platform has no org.eclipse.equinox.launcher jar: choose an Eclipse installation as target to publish a p2 repository")
	}
	if _, _, ok := target.BestMatch("org.eclipse.equinox.p2.publisher.eclipse", VersionRange{}, false); !ok {
		return nil, errors.New("the target platform has no p2 publisher (org.eclipse.equinox.p2.publisher.eclipse): choose an Eclipse SDK installation as target")
	}
	repository := fileURL(folder)
	// Its own configuration area: the installation's is shared (cascaded) and never written.
	configuration := filepath.Join(root, filepath.FromSlash(launchFolder), "p2-publisher")
	if err := os.MkdirAll(configuration, 0o755); err != nil {
		return nil, err
	}
	return &Launch{
		Directory: folder,
		Arguments: []string{
			"-jar", launcher.Bundle.Location, "-configuration", configuration,
			"-application", "org.eclipse.equinox.p2.publisher.FeaturesAndBundlesPublisher",
			"-metadataRepository", repository, "-artifactRepository", repository,
			"-source", folder, "-compress", "-publishArtifacts", "-append",
			"-nosplash", "-consoleLog",
		},
	}, nil
}
