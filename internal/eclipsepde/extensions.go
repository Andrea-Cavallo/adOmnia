package eclipsepde

import (
	"bytes"
	"encoding/xml"
	"io"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
)

// ExtensionPoint is an <extension-point> a bundle declares in plugin.xml.
type ExtensionPoint struct {
	ID     string `json:"id"`
	Name   string `json:"name,omitempty"`
	Bundle string `json:"bundle"`
	// Contributors are the workspace bundles that extend it (filled for workspace points).
	Contributors []string `json:"contributors,omitempty"`
}

// Extension is an <extension> a workspace bundle contributes: the point it extends and the
// classes it names, each with its line in plugin.xml and, when found, its source file.
type Extension struct {
	Point   string           `json:"point"`
	ID      string           `json:"id,omitempty"`
	Bundle  string           `json:"bundle"`
	File    string           `json:"file"`
	Line    int              `json:"line"`
	Classes []ExtensionClass `json:"classes,omitempty"`
}

// ExtensionClass is a class an extension names (class="…", the part before ':' of class="x:data").
type ExtensionClass struct {
	Attribute string `json:"attribute"`
	Class     string `json:"class"`
	Line      int    `json:"line"`
	// Source is the .java file of the class in the bundle, relative to the workspace ("" when elsewhere).
	Source string `json:"source,omitempty"`
}

// ExtensionRegistry is the static extension registry of the workspace: the points declared by
// the workspace and the target, and the extensions of the workspace bundles.
type ExtensionRegistry struct {
	Points     map[string]ExtensionPoint
	Extensions []Extension
}

// classAttributes are the attributes that name an executable extension in the platform schemas.
var classAttributes = map[string]bool{"class": true, "defaultHandler": true, "handler": true, "contributorClass": true, "launcher": true, "delegate": true}

// pluginFiles are the files an OSGi bundle declares its extensions in.
var pluginFiles = []string{"plugin.xml", "fragment.xml"}

// BuildExtensionRegistry reads plugin.xml/fragment.xml of the workspace bundles and the extension
// points of the target bundles.
func BuildExtensionRegistry(ws *Workspace, target *BundleIndex) *ExtensionRegistry {
	registry := &ExtensionRegistry{Points: map[string]ExtensionPoint{}}
	if target != nil {
		for _, entry := range target.All() {
			for _, point := range cachedTargetPoints(entry.Bundle) {
				if _, known := registry.Points[point.ID]; !known {
					registry.Points[point.ID] = point
				}
			}
		}
	}
	for _, project := range ws.Bundles() {
		for _, name := range pluginFiles {
			path := filepath.Join(project.Dir, name)
			data, err := os.ReadFile(path)
			if err != nil {
				continue
			}
			file, _ := relativeWithin(ws.Root, path)
			points, extensions := parsePluginXML(data, project.Bundle.SymbolicName, filepath.ToSlash(file))
			for _, point := range points {
				registry.Points[point.ID] = point
			}
			for index := range extensions {
				extensions[index].linkSources(project, ws.Root)
			}
			registry.Extensions = append(registry.Extensions, extensions...)
		}
	}
	for _, extension := range registry.Extensions {
		if point, ok := registry.Points[extension.Point]; ok && !slices.Contains(point.Contributors, extension.Bundle) {
			point.Contributors = append(point.Contributors, extension.Bundle)
			registry.Points[extension.Point] = point
		}
	}
	return registry
}

// pointCache keeps the extension points of a target jar: a target has about a thousand bundles and
// they change only when the target does. ponytail: process-wide and never evicted; a few KB per target.
var pointCache sync.Map // location|size|mtime -> []ExtensionPoint

func cachedTargetPoints(bundle *Bundle) []ExtensionPoint {
	info, err := os.Stat(bundle.Location)
	if err != nil {
		return nil
	}
	key := bundle.Location + "|" + strconv.FormatInt(info.Size(), 10) + "|" + strconv.FormatInt(info.ModTime().UnixNano(), 10)
	if cached, ok := pointCache.Load(key); ok {
		return cached.([]ExtensionPoint)
	}
	var points []ExtensionPoint
	for _, name := range pluginFiles {
		if data, ok := readBundleEntry(bundle, name); ok {
			found, _ := parsePluginXML(data, bundle.SymbolicName, "")
			points = append(points, found...)
		}
	}
	pointCache.Store(key, points)
	return points
}

// parsePluginXML reads the extension points and the extensions of one plugin.xml, with lines.
func parsePluginXML(data []byte, bundle, file string) ([]ExtensionPoint, []Extension) {
	decoder := xml.NewDecoder(bytes.NewReader(data))
	decoder.Strict = false
	lineAt := lineCounter(data)
	var points []ExtensionPoint
	var extensions []Extension
	var current *Extension
	depth := 0
	for {
		offset := decoder.InputOffset()
		token, err := decoder.Token()
		if err == io.EOF || err != nil {
			break
		}
		switch element := token.(type) {
		case xml.StartElement:
			depth++
			line := lineAt(offset)
			switch {
			case depth == 2 && element.Name.Local == "extension-point":
				id, name := attribute(element, "id"), attribute(element, "name")
				if id != "" {
					points = append(points, ExtensionPoint{ID: qualifiedPointID(bundle, id), Name: name, Bundle: bundle})
				}
			case depth == 2 && element.Name.Local == "extension":
				extensions = append(extensions, Extension{Point: attribute(element, "point"), ID: attribute(element, "id"), Bundle: bundle, File: file, Line: line})
				current = &extensions[len(extensions)-1]
			case depth > 2 && current != nil:
				for _, attr := range element.Attr {
					if classAttributes[attr.Name.Local] && attr.Value != "" {
						class, _, _ := strings.Cut(strings.TrimSpace(attr.Value), ":")
						current.Classes = append(current.Classes, ExtensionClass{Attribute: attr.Name.Local, Class: class, Line: line})
					}
				}
			}
		case xml.EndElement:
			if depth == 2 {
				current = nil
			}
			depth--
		}
	}
	return points, extensions
}

// qualifiedPointID: a simple id is relative to the declaring bundle; one with a dot is already qualified (3.2+).
func qualifiedPointID(bundle, id string) string {
	if strings.Contains(id, ".") {
		return id
	}
	return bundle + "." + id
}

func attribute(element xml.StartElement, name string) string {
	for _, attr := range element.Attr {
		if attr.Name.Local == name {
			return attr.Value
		}
	}
	return ""
}

// lineCounter maps a byte offset to its 1-based line. The decoder's offset is before the token's
// leading whitespace, so the line is taken at the next '<'.
func lineCounter(data []byte) func(offset int64) int {
	return func(offset int64) int {
		position := int(offset)
		if next := bytes.IndexByte(data[min(position, len(data)):], '<'); next >= 0 {
			position += next
		}
		return bytes.Count(data[:min(position, len(data))], []byte{'\n'}) + 1
	}
}

// linkSources finds the .java file of each class in the bundle's source folders.
func (e *Extension) linkSources(project *EclipseProject, root string) {
	for index, class := range e.Classes {
		relative := filepath.FromSlash(strings.ReplaceAll(class.Class, ".", "/")) + ".java"
		for _, folder := range project.sourceFolders() {
			path := filepath.Join(folder, relative)
			if fileExists(path) {
				source, _ := relativeWithin(root, path)
				e.Classes[index].Source = filepath.ToSlash(source)
				break
			}
		}
	}
}

// extensionDiagnostics are the plugin.xml problems PDE shows: an extension of a point no bundle
// declares, and a class that is missing from the bundle that should contain it (its package is
// one of the bundle's own source packages, so it is not a class of another bundle).
func extensionDiagnostics(ws *Workspace, registry *ExtensionRegistry) []Diagnostic {
	projects := map[string]*EclipseProject{}
	for _, project := range ws.Bundles() {
		projects[project.Bundle.SymbolicName] = project
	}
	var out []Diagnostic
	for _, extension := range registry.Extensions {
		if extension.Point != "" && len(registry.Points) > 0 {
			if _, ok := registry.Points[extension.Point]; !ok {
				out = append(out, Diagnostic{
					ID: extension.Bundle + "|unknown-extension-point|" + extension.Point + "|" + strconv.Itoa(extension.Line), Bundle: extension.Bundle,
					Severity: "warning", Kind: "unknown-extension-point", Title: "Unknown extension point " + extension.Point,
					Cause:    "no bundle of the workspace or of the target declares it: the extension is ignored at runtime",
					Evidence: []string{extension.File + ":" + strconv.Itoa(extension.Line)}, Actions: []string{"check the point id", "add the bundle that declares it to Require-Bundle and to the target"},
					File: extension.File, Line: extension.Line,
				})
			}
		}
		project := projects[extension.Bundle]
		for _, class := range extension.Classes {
			if class.Source != "" || project == nil || !ownsPackage(project, class.Class) {
				continue
			}
			out = append(out, Diagnostic{
				ID: extension.Bundle + "|missing-extension-class|" + class.Class + "|" + strconv.Itoa(class.Line), Bundle: extension.Bundle,
				Severity: "error", Kind: "missing-extension-class", Title: "Class " + class.Class + " not found",
				Cause:    "the " + class.Attribute + " of the " + extension.Point + " extension names a class of this bundle that does not exist: the platform fails to create it",
				Evidence: []string{extension.File + ":" + strconv.Itoa(class.Line)}, Actions: []string{"fix the class name in plugin.xml", "create the class"},
				File: extension.File, Line: class.Line,
			})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// ownsPackage reports whether the class's package is a folder of the bundle's sources.
func ownsPackage(project *EclipseProject, class string) bool {
	dot := strings.LastIndex(class, ".")
	if dot <= 0 {
		return false
	}
	folder := filepath.FromSlash(strings.ReplaceAll(class[:dot], ".", "/"))
	for _, source := range project.sourceFolders() {
		if info, err := os.Stat(filepath.Join(source, folder)); err == nil && info.IsDir() {
			return true
		}
	}
	return false
}
