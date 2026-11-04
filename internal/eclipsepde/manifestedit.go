package eclipsepde

import (
	"fmt"
	"strings"
)

// Manifest editing for agents and quick fixes: set or remove one header of the main
// section while keeping every other line, its order and the line-ending style. Everything
// is validated by parsing the result before it is returned, so a malformed edit never
// reaches a jar manifest.

// SetManifestHeader replaces the value of one main-section header ("" removes it) and
// returns the new manifest bytes and whether anything changed.
func SetManifestHeader(data []byte, header, value string) ([]byte, bool, error) {
	header = strings.TrimSpace(header)
	if header == "" || strings.ContainsAny(header, ":\r\n") {
		return nil, false, fmt.Errorf("invalid manifest header name %q", header)
	}
	if strings.ContainsAny(value, "\r\n") {
		return nil, false, fmt.Errorf("manifest header %q: the value must be a single line", header)
	}
	text := string(data)
	crlf := strings.Contains(text, "\r\n")
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")

	mainEnd := len(lines)
	for index, line := range lines {
		if strings.TrimSpace(line) == "" {
			mainEnd = index
			break
		}
	}
	type block struct {
		name       string
		start, end int
	}
	var blocks []block
	for index := 0; index < mainEnd; {
		if strings.HasPrefix(lines[index], " ") {
			return nil, false, fmt.Errorf("malformed manifest: line %d is a continuation without a header", index+1)
		}
		name, _, ok := strings.Cut(lines[index], ":")
		if !ok {
			return nil, false, fmt.Errorf("malformed manifest: line %d is not a header", index+1)
		}
		end := index + 1
		for end < mainEnd && strings.HasPrefix(lines[end], " ") {
			end++
		}
		blocks = append(blocks, block{name: strings.TrimSpace(name), start: index, end: end})
		index = end
	}

	position := -1
	for index, item := range blocks {
		if strings.EqualFold(item.name, header) {
			if position >= 0 {
				return nil, false, fmt.Errorf("the manifest declares %q twice: fix the duplicate first", header)
			}
			position = index
		}
	}

	out := append([]string{}, lines...)
	switch {
	case value == "" && position >= 0:
		out = append(out[:blocks[position].start], out[blocks[position].end:]...)
	case value == "":
		return data, false, nil
	case position >= 0:
		folded := foldManifestHeader(header, value)
		out = append(append(append([]string{}, out[:blocks[position].start]...), folded...), out[blocks[position].end:]...)
	default:
		folded := foldManifestHeader(header, value)
		insertAt := 0
		if len(blocks) > 0 {
			insertAt = blocks[len(blocks)-1].end
		}
		out = append(append(append([]string{}, out[:insertAt]...), folded...), out[insertAt:]...)
	}

	// A manifest without Manifest-Version is not a manifest: an edit may add headers, never
	// remove the required one.
	hasVersion := false
	for _, item := range blocks {
		if strings.EqualFold(item.name, "Manifest-Version") {
			hasVersion = true
		}
	}
	if !hasVersion && value != "" {
		if !strings.EqualFold(header, "Manifest-Version") {
			out = append([]string{"Manifest-Version: 1.0"}, out...)
		}
	}

	result := strings.Join(out, "\n")
	if crlf {
		result = strings.ReplaceAll(result, "\n", "\r\n")
	}
	edited := []byte(result)
	manifest, err := ParseManifest(edited)
	if err != nil {
		return nil, false, fmt.Errorf("the edit would produce an invalid manifest: %w", err)
	}
	if value == "" && strings.EqualFold(header, "Manifest-Version") {
		return nil, false, fmt.Errorf("Manifest-Version cannot be removed")
	}
	if value == "" {
		for name := range manifest.Main {
			if strings.EqualFold(name, header) {
				return nil, false, fmt.Errorf("the header %q could not be removed", header)
			}
		}
	} else if manifest.Main[header] != value {
		// Header names are case-insensitive in the manifest format.
		found := false
		for name, current := range manifest.Main {
			if strings.EqualFold(name, header) && current == value {
				found = true
			}
		}
		if !found {
			return nil, false, fmt.Errorf("the header %q could not be written", header)
		}
	}
	return edited, string(edited) != text, nil
}

// AddManifestRequirement appends one clause to Require-Bundle or Import-Package, unless the
// name is already there. It returns the new manifest and whether the clause was added.
func AddManifestRequirement(data []byte, kind, name, versionRange string) ([]byte, bool, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, false, fmt.Errorf("the requirement needs a package or bundle name")
	}
	var header, versionAttribute string
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "import-package", "import", "package":
		header, versionAttribute = "Import-Package", "version"
	case "require-bundle", "require", "bundle":
		header, versionAttribute = "Require-Bundle", "bundle-version"
	default:
		return nil, false, fmt.Errorf("unknown requirement kind %q: use import-package or require-bundle", kind)
	}
	manifest, err := ParseManifest(data)
	if err != nil {
		return nil, false, err
	}
	current := manifest.Main[header]
	clauses, err := ParseClauseList(current)
	if err != nil {
		return nil, false, fmt.Errorf("%s: %w", header, err)
	}
	for _, clause := range clauses {
		if clause.Name != name {
			continue
		}
		// The requirement is already there. When it has no version and a range was asked for,
		// add the range to the existing clause instead of duplicating it: that is the usual
		// fix for a version conflict.
		if versionRange == "" || clause.Attributes[versionAttribute] != "" {
			return data, false, nil
		}
		parts := splitTopLevel(current, ',')
		for index, part := range parts {
			existing, parseErr := parseClause(strings.TrimSpace(part))
			if parseErr != nil || existing.Name != name {
				continue
			}
			parts[index] = strings.TrimSpace(part) + ";" + versionAttribute + `="` + versionRange + `"`
			edited, _, err := SetManifestHeader(data, header, strings.Join(parts, ","))
			if err != nil {
				return nil, false, err
			}
			return edited, true, nil
		}
		return data, false, nil
	}
	clause := name
	if versionRange = strings.TrimSpace(versionRange); versionRange != "" {
		clause += ";" + versionAttribute + `="` + versionRange + `"`
	}
	if strings.TrimSpace(current) == "" {
		current = clause
	} else {
		current += "," + clause
	}
	edited, _, err := SetManifestHeader(data, header, current)
	if err != nil {
		return nil, false, err
	}
	return edited, true, nil
}

// foldManifestHeader writes a header as physical lines of at most maxManifestLineBytes
// bytes; continuation lines start with one space, as the manifest format requires.
func foldManifestHeader(name, value string) []string {
	text := name + ": " + value
	lines := []string{}
	limit := maxManifestLineBytes
	for len(text) > limit {
		cut := limit
		for cut > 0 && !utf8RuneStart(text[cut]) {
			cut--
		}
		if cut == 0 {
			cut = limit
		}
		lines = append(lines, text[:cut])
		text = " " + text[cut:]
		limit = maxManifestLineBytes
	}
	lines = append(lines, text)
	return lines
}

// utf8RuneStart reports whether the byte at index can begin a UTF-8 rune.
func utf8RuneStart(value byte) bool { return value&0xC0 != 0x80 }

// maxManifestLineBytes leaves room for the CRLF inside the 72-byte manifest limit.
const maxManifestLineBytes = 70
