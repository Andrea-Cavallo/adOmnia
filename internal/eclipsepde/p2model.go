package eclipsepde

import (
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"strings"
)

// p2IU is an installable unit of a p2 metadata repository, reduced to what the
// target resolution needs.
type p2IU struct {
	ID        string
	Version   Version
	Provides  []p2Capability
	Requires  []p2Requirement
	Filter    *ldapFilter
	Artifacts []p2ArtifactKey
}

type p2Capability struct {
	Namespace string
	Name      string
	Version   Version
}

type p2Requirement struct {
	Namespace string
	Name      string
	Range     VersionRange
	Optional  bool
	Greedy    bool
	Filter    *ldapFilter
}

// strict reports a `[v,v]` range: what a feature uses for the bundles it includes.
func (r p2Requirement) strict() bool {
	return r.Range.HasCeiling && r.Range.IncludeFloor && r.Range.IncludeCeiling && r.Range.Floor.Compare(r.Range.Ceiling) == 0
}

type p2ArtifactKey struct {
	Classifier string
	ID         string
	Version    string
}

type xmlUnit struct {
	ID       string `xml:"id,attr"`
	Version  string `xml:"version,attr"`
	Filter   string `xml:"filter"`
	Provides []struct {
		Namespace string `xml:"namespace,attr"`
		Name      string `xml:"name,attr"`
		Version   string `xml:"version,attr"`
	} `xml:"provides>provided"`
	Requires []struct {
		Namespace string `xml:"namespace,attr"`
		Name      string `xml:"name,attr"`
		Range     string `xml:"range,attr"`
		Optional  bool   `xml:"optional,attr"`
		Greedy    string `xml:"greedy,attr"`
		Match     string `xml:"match,attr"`
		Filter    string `xml:"filter"`
	} `xml:"requires>required"`
	Artifacts []struct {
		Classifier string `xml:"classifier,attr"`
		ID         string `xml:"id,attr"`
		Version    string `xml:"version,attr"`
	} `xml:"artifacts>artifact"`
}

// parseP2Units streams the units of a content.xml. Units with a version that is
// not an OSGi version (p2 "raw:" versions) are skipped and counted.
func parseP2Units(data []byte) (units []*p2IU, skipped int, err error) {
	decoder := xml.NewDecoder(bytes.NewReader(data))
	for {
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			return units, skipped, nil
		}
		if err != nil {
			return nil, 0, fmt.Errorf("malformed p2 metadata: %w", err)
		}
		start, ok := token.(xml.StartElement)
		if !ok || start.Name.Local != "unit" {
			continue
		}
		var raw xmlUnit
		if err := decoder.DecodeElement(&raw, &start); err != nil {
			return nil, 0, fmt.Errorf("malformed p2 unit: %w", err)
		}
		unit, ok := unitOf(raw)
		if !ok {
			skipped++
			continue
		}
		units = append(units, unit)
	}
}

func unitOf(raw xmlUnit) (*p2IU, bool) {
	version, err := ParseVersion(raw.Version)
	if err != nil {
		return nil, false
	}
	filter, err := parseLDAPFilter(raw.Filter)
	if err != nil {
		return nil, false
	}
	unit := &p2IU{ID: raw.ID, Version: version, Filter: filter}
	for _, provided := range raw.Provides {
		capability := p2Capability{Namespace: provided.Namespace, Name: provided.Name}
		if v, err := ParseVersion(provided.Version); err == nil {
			capability.Version = v
		}
		unit.Provides = append(unit.Provides, capability)
	}
	for _, required := range raw.Requires {
		// Expression requirements (match=…) describe configuration, not dependencies.
		if required.Match != "" || required.Name == "" {
			continue
		}
		requirement := p2Requirement{Namespace: required.Namespace, Name: required.Name, Optional: required.Optional, Greedy: required.Greedy != "false"}
		if required.Range != "" {
			r, err := ParseVersionRange(required.Range)
			if err != nil {
				continue
			}
			requirement.Range = r
		} else {
			requirement.Range = VersionRange{IncludeFloor: true}
		}
		if requirement.Filter, err = parseLDAPFilter(required.Filter); err != nil {
			continue
		}
		unit.Requires = append(unit.Requires, requirement)
	}
	for _, artifact := range raw.Artifacts {
		unit.Artifacts = append(unit.Artifacts, p2ArtifactKey{Classifier: artifact.Classifier, ID: artifact.ID, Version: artifact.Version})
	}
	return unit, true
}

// p2ArtifactRepository is one simple artifact repository: its mapping rules and
// the artifacts it holds (with their properties, checksums included).
type p2ArtifactRepository struct {
	URL       string
	rules     []p2MappingRule
	artifacts map[p2ArtifactKey]map[string]string
}

type p2MappingRule struct {
	filter *ldapFilter
	output string
}

type xmlArtifacts struct {
	Rules []struct {
		Filter string `xml:"filter,attr"`
		Output string `xml:"output,attr"`
	} `xml:"mappings>rule"`
	Artifacts []struct {
		Classifier string `xml:"classifier,attr"`
		ID         string `xml:"id,attr"`
		Version    string `xml:"version,attr"`
		Properties []struct {
			Name  string `xml:"name,attr"`
			Value string `xml:"value,attr"`
		} `xml:"properties>property"`
		// Processing steps mark a transformed (pack200) descriptor of the same key.
		Steps []struct {
			ID string `xml:"id,attr"`
		} `xml:"processing>step"`
	} `xml:"artifacts>artifact"`
}

func parseP2Artifacts(repository string, data []byte) (*p2ArtifactRepository, error) {
	var doc xmlArtifacts
	if err := xml.Unmarshal(data, &doc); err != nil {
		return nil, fmt.Errorf("%s: malformed artifact repository: %w", repository, err)
	}
	result := &p2ArtifactRepository{URL: repository, artifacts: map[p2ArtifactKey]map[string]string{}}
	for _, rule := range doc.Rules {
		filter, err := parseLDAPFilter(rule.Filter)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", repository, err)
		}
		result.rules = append(result.rules, p2MappingRule{filter: filter, output: rule.Output})
	}
	for _, artifact := range doc.Artifacts {
		properties := map[string]string{}
		for _, property := range artifact.Properties {
			properties[property.Name] = property.Value
		}
		// The canonical jar is the descriptor without processing steps.
		if len(artifact.Steps) > 0 || properties["format"] == "packed" {
			continue
		}
		result.artifacts[p2ArtifactKey{Classifier: artifact.Classifier, ID: artifact.ID, Version: artifact.Version}] = properties
	}
	return result, nil
}

// locationOf applies the first matching mapping rule, as p2's SimpleArtifactRepository does.
func (r *p2ArtifactRepository) locationOf(key p2ArtifactKey) (string, bool) {
	properties := map[string]string{"classifier": key.Classifier, "id": key.ID, "version": key.Version}
	for _, rule := range r.rules {
		if !rule.filter.matches(properties) {
			continue
		}
		replacer := strings.NewReplacer("${repoUrl}", r.URL, "${id}", key.ID, "${version}", key.Version, "${classifier}", key.Classifier)
		return replacer.Replace(rule.output), true
	}
	return "", false
}
