package eclipsepde

import (
	"archive/zip"
	"encoding/xml"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

// ServiceComponent is one Declarative Services descriptor of a bundle: the services it
// registers and the ones it references. It is read from the XML (OSGI-INF/*.xml), never
// inferred from Java sources, so it works the same for an exploded workspace bundle and
// for a jar of the target platform.
type ServiceComponent struct {
	// Name is the component name attribute (or its class when absent).
	Name string `json:"name"`
	// Implementation is the Java class of the component.
	Implementation string `json:"implementation,omitempty"`
	// Services are the interfaces the component registers.
	Services []string `json:"services,omitempty"`
	// References are the interfaces the component uses.
	References []string `json:"references,omitempty"`
	// File is the descriptor inside the bundle.
	File string `json:"file"`
}

// ServiceComponents reads the DS descriptors named by Service-Component. Missing or
// malformed descriptors are skipped: a broken component is a runtime problem, not a
// reason to fail the whole analysis.
func ServiceComponents(bundle *Bundle) []ServiceComponent {
	if bundle == nil {
		return nil
	}
	var out []ServiceComponent
	for _, path := range bundle.ServiceComponents {
		raw, ok := readBundleEntry(bundle, path)
		if !ok {
			continue
		}
		component, ok := parseServiceComponent(raw)
		if !ok {
			continue
		}
		component.File = path
		out = append(out, component)
	}
	return out
}

// readBundleEntry reads one file of a bundle: from an exploded directory or from the jar.
func readBundleEntry(bundle *Bundle, entry string) ([]byte, bool) {
	location := bundle.Location
	if info, err := os.Stat(location); err == nil && info.IsDir() {
		data, err := os.ReadFile(filepath.Join(location, filepath.FromSlash(entry)))
		return data, err == nil
	}
	reader, err := zip.OpenReader(location)
	if err != nil {
		return nil, false
	}
	defer func() { _ = reader.Close() }()
	for _, file := range reader.File {
		if !strings.EqualFold(file.Name, entry) {
			continue
		}
		source, err := file.Open()
		if err != nil {
			return nil, false
		}
		defer func() { _ = source.Close() }()
		data, err := io.ReadAll(io.LimitReader(source, 1<<20))
		if err != nil {
			return nil, false
		}
		return data, true
	}
	return nil, false
}

// serviceComponentXML is the subset of the DS namespace adOmnia needs.
type serviceComponentXML struct {
	Name           string `xml:"name,attr"`
	Implementation struct {
		Class string `xml:"class,attr"`
	} `xml:"implementation"`
	Services []struct {
		Provide []struct {
			Interface string `xml:"interface,attr"`
		} `xml:"provide"`
	} `xml:"service"`
	References []struct {
		Interface string `xml:"interface,attr"`
		Name      string `xml:"name,attr"`
	} `xml:"reference"`
}

func parseServiceComponent(raw []byte) (ServiceComponent, bool) {
	var doc serviceComponentXML
	if err := xml.Unmarshal(raw, &doc); err != nil {
		return ServiceComponent{}, false
	}
	component := ServiceComponent{Name: doc.Name, Implementation: doc.Implementation.Class}
	if component.Name == "" {
		component.Name = component.Implementation
	}
	for _, service := range doc.Services {
		for _, provide := range service.Provide {
			if provide.Interface != "" && !containsString(component.Services, provide.Interface) {
				component.Services = append(component.Services, provide.Interface)
			}
		}
	}
	for _, reference := range doc.References {
		if reference.Interface != "" && !containsString(component.References, reference.Interface) {
			component.References = append(component.References, reference.Interface)
		}
	}
	return component, true
}

func containsString(values []string, value string) bool {
	return slices.Contains(values, value)
}
