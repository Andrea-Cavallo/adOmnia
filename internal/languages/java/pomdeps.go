package java

import (
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
)

// Section dice dove il pom dichiara la coordinata: cambia come si aggiorna e cosa significa "managed".
const (
	SectionParent     = "parent"
	SectionDependency = "dependencies"
	SectionManagement = "dependencyManagement"
	SectionPlugin     = "plugins"
)

// PomDependency è una coordinata dichiarata in un pom.xml con la posizione esatta della versione, così
// l'editor può segnare la riga e sostituire solo `<version>` (o la property a cui punta).
type PomDependency struct {
	GroupID    string `json:"groupId"`
	ArtifactID string `json:"artifactId"`
	// Version è il testo scritto nel pom (anche `${spring.version}`); vuoto se la versione è gestita altrove.
	Version string `json:"version"`
	Section string `json:"section"`
	Scope   string `json:"scope,omitempty"`
	// Resolved è la versione dopo la sostituzione delle property del pom stesso; vuoto se non si risolve qui.
	Resolved string `json:"resolved"`
	// Property è il nome della property usata come versione (`spring.version`), se la versione è `${…}`.
	Property string `json:"property,omitempty"`
	// Posizione di `<version>` (o, senza versione, dell'`<artifactId>`), 1-based.
	Line     int `json:"line"`
	StartCol int `json:"startColumn"`
	EndCol   int `json:"endColumn"`
	// Posizione del testo della property che governa la versione: dove va scritto l'aggiornamento.
	PropertyLine     int `json:"propertyLine,omitzero"`
	PropertyStartCol int `json:"propertyStartColumn,omitzero"`
	PropertyEndCol   int `json:"propertyEndColumn,omitzero"`
}

// Key è la coordinata `group:artifact`, quella che OSV e Maven Central usano.
func (d PomDependency) Key() string { return d.GroupID + ":" + d.ArtifactID }

type pomText struct {
	start, end int // offset di byte del testo, esclusi i tag
	value      string
}

// ReadPomDependencies legge le coordinate di un pom.xml con le posizioni di riga e colonna. Non risolve
// parent né BOM: una versione che non si ricava dal file resta `Resolved == ""`.
func ReadPomDependencies(path string) ([]PomDependency, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return ParsePomDependencies(data)
}

type pomFrame struct {
	name                            string
	group, artifact, version, scope pomText
	hasVersion                      bool
	elementStart                    int
}

// ParsePomDependencies è ReadPomDependencies su un testo già in memoria (anche non salvato nell'editor).
func ParsePomDependencies(data []byte) ([]PomDependency, error) {
	decoder := xml.NewDecoder(bytes.NewReader(data))
	decoder.Strict = false
	var path []string
	var current *pomFrame
	var found []PomDependency
	properties := map[string]pomText{}
	var pending []pomFrameSection
	var textStart int
	for {
		offset := int(decoder.InputOffset())
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("pom.xml is not well-formed: %w", err)
		}
		switch element := token.(type) {
		case xml.StartElement:
			path = append(path, element.Name.Local)
			textStart = int(decoder.InputOffset())
			if isCoordinateElement(path) {
				current = &pomFrame{name: element.Name.Local, elementStart: offset}
			}
		case xml.EndElement:
			end := offset
			name := element.Name.Local
			raw := string(data[min(textStart, len(data)):min(end, len(data))])
			switch {
			case current != nil && len(path) > 0 && isCoordinateChild(path):
				text := pomText{start: textStart, end: end, value: strings.TrimSpace(raw)}
				trimTrailing(&text, raw)
				switch name {
				case "groupId":
					current.group = text
				case "artifactId":
					current.artifact = text
				case "version":
					current.version, current.hasVersion = text, true
				case "scope":
					current.scope = text
				}
			case len(path) == 3 && path[0] == "project" && path[1] == "properties":
				text := pomText{start: textStart, end: end, value: strings.TrimSpace(raw)}
				trimTrailing(&text, raw)
				properties[name] = text
			}
			if current != nil && current.name == name && isCoordinateElement(path) {
				pending = append(pending, pomFrameSection{frame: *current, section: sectionOf(path)})
				current = nil
			}
			path = path[:len(path)-1]
		}
	}
	for _, item := range pending {
		found = append(found, item.build(data, properties))
	}
	return found, nil
}

type pomFrameSection struct {
	frame   pomFrame
	section string
}

func (p pomFrameSection) build(data []byte, properties map[string]pomText) PomDependency {
	frame := p.frame
	d := PomDependency{GroupID: frame.group.value, ArtifactID: frame.artifact.value, Section: p.section, Scope: frame.scope.value, Version: frame.version.value}
	anchor := frame.version
	if !frame.hasVersion {
		anchor = frame.artifact
	}
	d.Line, d.StartCol, d.EndCol = locate(data, anchor)
	d.Resolved = d.Version
	if name, ok := propertyName(d.Version); ok {
		d.Property = name
		if value, found := properties[name]; found {
			d.Resolved = value.value
			d.PropertyLine, d.PropertyStartCol, d.PropertyEndCol = locate(data, value)
		} else {
			d.Resolved = ""
		}
	}
	return d
}

func isCoordinateElement(path []string) bool {
	n := len(path)
	switch {
	case n == 2 && path[0] == "project" && path[1] == "parent":
		return true
	case n == 3 && path[0] == "project" && path[1] == "dependencies" && path[2] == "dependency":
		return true
	case n == 4 && path[1] == "dependencyManagement" && path[2] == "dependencies" && path[3] == "dependency":
		return true
	case n >= 4 && path[n-1] == "plugin" && path[n-2] == "plugins":
		return true
	}
	return false
}

// isCoordinateChild è true per i figli diretti di un elemento coordinata (non per exclusions annidate).
func isCoordinateChild(path []string) bool {
	return len(path) >= 2 && isCoordinateElement(path[:len(path)-1])
}

func sectionOf(path []string) string {
	switch {
	case path[len(path)-1] == "parent":
		return SectionParent
	case path[len(path)-1] == "plugin":
		return SectionPlugin
	case len(path) == 4 && path[1] == "dependencyManagement":
		return SectionManagement
	}
	return SectionDependency
}

func propertyName(version string) (string, bool) {
	if strings.HasPrefix(version, "${") && strings.HasSuffix(version, "}") && !strings.Contains(version[2:len(version)-1], "${") {
		return version[2 : len(version)-1], true
	}
	return "", false
}

// trimTrailing restringe l'intervallo al testo senza spazi, così la sostituzione non tocca l'indentazione.
func trimTrailing(text *pomText, raw string) {
	lead := len(raw) - len(strings.TrimLeft(raw, " \t\r\n"))
	text.start += lead
	text.end = text.start + len(text.value)
}

// locate converte un intervallo di byte in riga e colonne 1-based (colonne in caratteri come Monaco).
func locate(data []byte, text pomText) (line, startCol, endCol int) {
	if text.start < 0 || text.start > len(data) || text.end > len(data) {
		return 0, 0, 0
	}
	before := data[:text.start]
	line = bytes.Count(before, []byte("\n")) + 1
	lineStart := bytes.LastIndexByte(before, '\n') + 1
	startCol = len([]rune(string(data[lineStart:text.start]))) + 1
	endCol = startCol + len([]rune(string(data[text.start:text.end])))
	return line, startCol, endCol
}
