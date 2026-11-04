package eclipsepde

import (
	"encoding/xml"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// TychoRepository is one p2 repository declared by a Tycho build.
type TychoRepository struct {
	ID     string `json:"id,omitempty"`
	URL    string `json:"url"`
	Layout string `json:"layout,omitempty"`
}

// TychoTarget is what a pom.xml says about the target platform: Tycho resolves the repositories of
// the build against the requirements of the bundles, so the pom is the target definition.
type TychoTarget struct {
	Repositories []TychoRepository `json:"repositories"`
	Modules      []string          `json:"modules,omitempty"`
	// Unresolved are the `${property}` references the pom itself does not define.
	Unresolved []string `json:"unresolved,omitempty"`
}

// tychoPom models only what the target needs, so a pom that uses any other Maven feature still reads.
type tychoPom struct {
	Properties struct {
		Entries []struct {
			XMLName xml.Name
			Value   string `xml:",chardata"`
		} `xml:",any"`
	} `xml:"properties"`
	Modules struct {
		Module []string `xml:"module"`
	} `xml:"modules"`
	Repositories struct {
		Repository []struct {
			ID     string `xml:"id"`
			Layout string `xml:"layout"`
			URL    string `xml:"url"`
		} `xml:"repository"`
	} `xml:"repositories"`
}

// tychoTargetURLs keeps the repositories p2 can read: http(s) locations with the p2 layout, in the
// order the pom declares them.
func ReadTychoTarget(root string) (*TychoTarget, error) {
	data, err := os.ReadFile(filepath.Join(root, "pom.xml"))
	if err != nil {
		return nil, errors.New("this project has no pom.xml to read a Tycho target from")
	}
	var pom tychoPom
	if err := xml.Unmarshal(data, &pom); err != nil {
		return nil, fmt.Errorf("pom.xml: %w", err)
	}
	properties := map[string]string{}
	for _, entry := range pom.Properties.Entries {
		properties[entry.XMLName.Local] = strings.TrimSpace(entry.Value)
	}
	target := &TychoTarget{}
	for _, repository := range pom.Repositories.Repository {
		url := substituteProperties(strings.TrimSpace(repository.URL), properties)
		if url == "" {
			continue
		}
		layout := strings.TrimSpace(repository.Layout)
		// Tycho marks a p2 repository as such: a Maven repository holds no installable units, and a
		// pom that names only those has no target platform.
		if layout != "p2" {
			continue
		}
		if !isRemoteLocation(url) {
			target.Unresolved = append(target.Unresolved, strings.TrimSpace(repository.URL))
			continue
		}
		target.Repositories = append(target.Repositories, TychoRepository{ID: strings.TrimSpace(repository.ID), URL: url, Layout: "p2"})
	}
	for _, module := range pom.Modules.Module {
		if module = strings.TrimSpace(module); module != "" {
			target.Modules = append(target.Modules, module)
		}
	}
	if len(target.Repositories) == 0 && len(target.Unresolved) == 0 {
		return nil, errors.New("this pom.xml declares no p2 repository: nothing to build a target from")
	}
	return target, nil
}

// substituteProperties replaces `${name}` with the value the pom defines for it. An unknown name
// stays as it is, so it can be reported instead of silently turning into an empty URL.
func substituteProperties(url string, properties map[string]string) string {
	if !strings.Contains(url, "${") {
		return url
	}
	var out strings.Builder
	rest := url
	for {
		start := strings.Index(rest, "${")
		if start < 0 {
			out.WriteString(rest)
			return out.String()
		}
		end := strings.Index(rest[start:], "}")
		if end < 0 {
			out.WriteString(rest)
			return out.String()
		}
		out.WriteString(rest[:start])
		name := rest[start+2 : start+end]
		if value, ok := properties[name]; ok {
			out.WriteString(value)
		} else {
			out.WriteString(rest[start : start+end+1])
		}
		rest = rest[start+end+1:]
	}
}

func isRemoteLocation(url string) bool {
	lower := strings.ToLower(url)
	return strings.HasPrefix(lower, "https://") || strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "file:")
}

// RequiredUnits lists the bundles the workspace requires and does not provide itself. In p2 a
// Require-Bundle name is the installable unit id, so these are the units a target must seed: the
// planner then follows what each of them requires.
func RequiredUnits(root string) []string {
	ws, err := ImportWorkspace(root)
	if err != nil {
		return nil
	}
	provided := map[string]bool{}
	for _, project := range ws.Bundles() {
		provided[project.Name] = true
		if project.Bundle != nil {
			provided[project.Bundle.SymbolicName] = true
		}
	}
	seen := map[string]bool{}
	var units []string
	for _, project := range ws.Bundles() {
		if project.Bundle == nil {
			continue
		}
		for _, clause := range project.Bundle.RequireBundle {
			name := strings.TrimSpace(clause.Name)
			if name == "" || name == "system.bundle" || provided[name] || seen[name] || clause.IsOptional() {
				continue
			}
			seen[name] = true
			units = append(units, name)
		}
	}
	sort.Strings(units)
	return units
}

// targetFileName is where the generated definition lives: next to the target settings, so it is
// local, backup-friendly and never part of the project the user edits.
const targetFileName = "tycho.target"

// WriteTychoTarget writes a `.target` definition with the repositories of the pom and the units the
// workspace needs, and returns its path. It never overwrites a different file by accident: the file
// is adOmnia's own (`tycho.target`), so rewriting it is what the user asked for.
func WriteTychoTarget(root string, target *TychoTarget, units []string) (string, error) {
	if target == nil || len(target.Repositories) == 0 {
		return "", errors.New("the pom declares no p2 repository")
	}
	directory := filepath.Join(root, ".adomnia")
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return "", err
	}
	document := targetDocument{
		Version: "3.8",
		Name:    "adOmnia Tycho target",
	}
	location := targetLocation{
		IncludeMode:         "planner",
		IncludeAllPlatforms: "false",
		IncludeSource:       "false",
		Type:                "InstallableUnit",
	}
	for _, repository := range target.Repositories {
		location.Repositories = append(location.Repositories, targetRepository{Location: repository.URL})
	}
	for _, unit := range units {
		location.Units = append(location.Units, targetUnit{ID: unit, Version: "0.0.0"})
	}
	document.Locations = []targetLocation{location}

	body, err := xml.MarshalIndent(document, "", "  ")
	if err != nil {
		return "", err
	}
	path := filepath.Join(directory, targetFileName)
	content := append([]byte(xml.Header), body...)
	content = append(content, '\n')
	if err := os.WriteFile(path, content, 0o644); err != nil {
		return "", err
	}
	return path, nil
}

// targetDocument is the `.target` XML, written in the shape PDE and our own parser read.
type targetDocument struct {
	XMLName   xml.Name         `xml:"target"`
	Version   string           `xml:"version,attr"`
	Name      string           `xml:"name,attr"`
	Locations []targetLocation `xml:"locations>location"`
}

type targetLocation struct {
	IncludeMode         string             `xml:"includeMode,attr"`
	IncludeAllPlatforms string             `xml:"includeAllPlatforms,attr"`
	IncludeSource       string             `xml:"includeSource,attr"`
	Type                string             `xml:"type,attr"`
	Repositories        []targetRepository `xml:"repository"`
	Units               []targetUnit       `xml:"unit"`
}

type targetRepository struct {
	Location string `xml:"location,attr"`
}

type targetUnit struct {
	ID      string `xml:"id,attr"`
	Version string `xml:"version,attr"`
}
