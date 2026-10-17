package eclipsepde

import (
	"encoding/xml"
	"fmt"
	"os"
	"path/filepath"
)

// TargetDefinition is a parsed Eclipse `.target` file (spec section 7, source
// #2). Only the structure PDE needs is modeled: the target name and its
// location entries (directory, installable unit or feature).
type TargetDefinition struct {
	Name string
	// Locations in file order.
	Locations []TargetLocation
	// Sequence reports whether the definition declares PDE's sequenceNumber.
	Sequence bool
}

// TargetLocation is one location of a `.target` definition.
type TargetLocation struct {
	// Kind is "Directory", "InstallableUnit" (p2) or "Feature".
	Kind string
	// Path is the directory location (Kind "Directory").
	Path string
	// ID is the IU or feature id (other kinds).
	ID string
	// Version is the IU/feature version, when given.
	Version string
}

type targetXML struct {
	Name string `xml:"name,attr"`
	// SequenceNumber is the PDE change counter of the definition.
	SequenceNumber string `xml:"sequenceNumber,attr"`
	Locations      []struct {
		Kind  string `xml:"type,attr"`
		Path  string `xml:"path,attr"`
		Units []struct {
			ID      string `xml:"id,attr"`
			Version string `xml:"version,attr"`
		} `xml:"unit"`
		Features []struct {
			ID      string `xml:"id,attr"`
			Version string `xml:"version,attr"`
		} `xml:"feature"`
	} `xml:"locations>location"`
}

// ParseTargetDefinition parses `.target` content.
func ParseTargetDefinition(data []byte) (*TargetDefinition, error) {
	var doc targetXML
	if err := xml.Unmarshal(data, &doc); err != nil {
		return nil, fmt.Errorf("malformed .target: %w", err)
	}
	def := &TargetDefinition{Name: doc.Name, Sequence: doc.SequenceNumber != ""}
	for _, loc := range doc.Locations {
		switch loc.Kind {
		case "Directory":
			def.Locations = append(def.Locations, TargetLocation{Kind: "Directory", Path: loc.Path})
		case "InstallableUnit":
			for _, u := range loc.Units {
				def.Locations = append(def.Locations, TargetLocation{Kind: "InstallableUnit", ID: u.ID, Version: u.Version})
			}
		case "Feature":
			for _, f := range loc.Features {
				def.Locations = append(def.Locations, TargetLocation{Kind: "Feature", ID: f.ID, Version: f.Version})
			}
		default:
			def.Locations = append(def.Locations, TargetLocation{Kind: loc.Kind})
		}
	}
	return def, nil
}

// ReadTargetDefinition loads a `.target` file from disk (read-only).
func ReadTargetDefinition(path string) (*TargetDefinition, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	def, err := ParseTargetDefinition(data)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return def, nil
}

// DirectoryLocations returns the local directory locations of the definition:
// the paths that can be indexed like a custom target platform directory.
func (d *TargetDefinition) DirectoryLocations() []string {
	var out []string
	for _, l := range d.Locations {
		if l.Kind == "Directory" && l.Path != "" {
			out = append(out, filepath.FromSlash(l.Path))
		}
	}
	return out
}
