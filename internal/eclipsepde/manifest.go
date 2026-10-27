package eclipsepde

import (
	"fmt"
	"strings"
)

// Manifest is a parsed OSGi/JAR MANIFEST.MF: the main section plus any per-entry
// sections. Line continuations are unfolded and header names are canonicalized
// to their original spelling.
type Manifest struct {
	// Main holds the headers of the main section (the bundle metadata).
	Main map[string]string
	// Sections holds per-jar-entry sections keyed by their Name header.
	Sections map[string]map[string]string
	// Order preserves the main-section header order for stable round-trips.
	Order []string

	// pending buffers per-entry sections until their Name header is known.
	pending []map[string]string
}

// ParseManifest parses MANIFEST.MF content: 72-byte wrapped lines (a line that
// starts with a space continues the previous one), one "Name: value" header per
// logical line, sections split by blank lines.
func ParseManifest(data []byte) (*Manifest, error) {
	lines := unfoldManifestLines(string(data))
	m := &Manifest{Main: map[string]string{}, Sections: map[string]map[string]string{}}

	section := m.Main
	isMain := true
	for _, line := range lines {
		if line == "" {
			section = nil // next header line starts a new section
			isMain = false
			continue
		}
		name, value, ok := strings.Cut(line, ":")
		if !ok {
			return nil, fmt.Errorf("malformed manifest line %q: expected 'Name: value'", line)
		}
		name = strings.TrimSpace(name)
		value = strings.TrimPrefix(strings.TrimSpace(value), " ")
		if section == nil {
			section = map[string]string{}
			// The entry name is resolved once the section is complete; buffer it
			// under a placeholder key until the section ends.
			m.pending = append(m.pending, section)
		}
		if _, exists := section[name]; exists {
			return nil, fmt.Errorf("duplicate manifest header %q", name)
		}
		section[name] = value
		if isMain {
			m.Order = append(m.Order, name)
		}
	}
	for _, sec := range m.pending {
		key := sec["Name"]
		if key == "" {
			return nil, fmt.Errorf("manifest entry section without Name header")
		}
		m.Sections[key] = sec
	}
	m.pending = nil
	return m, nil
}

// unfoldManifestLines splits the manifest text into logical lines, joining the
// continuation lines that begin with a single space.
func unfoldManifestLines(text string) []string {
	var out []string
	for raw := range strings.SplitSeq(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		if strings.HasPrefix(raw, " ") && len(out) > 0 {
			out[len(out)-1] += raw[1:]
			continue
		}
		out = append(out, raw)
	}
	// Drop trailing empty lines but keep interior blanks (section separators).
	for len(out) > 0 && out[len(out)-1] == "" {
		out = out[:len(out)-1]
	}
	return out
}
