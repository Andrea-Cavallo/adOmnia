package eclipsepde

import (
	"fmt"
	"strings"
)

// Clause is one element of an OSGi header list such as Require-Bundle or
// Import-Package: a symbolic name/package plus attributes and directives.
//
//	Require-Bundle: com.acme.util;bundle-version="[2.0.0,3.0.0)";resolution:=optional
type Clause struct {
	Name string
	// Attributes are plain "key=value" parameters (e.g. bundle-version, version).
	Attributes map[string]string
	// Directives are "key:=value" parameters (e.g. resolution, visibility, uses).
	Directives map[string]string
}

// VersionRangeOf returns the parsed range of the given attribute ("bundle-version"
// for bundles, "version" for packages). A missing attribute yields ok=false; a
// malformed one yields an error so the caller can report it per-clause.
func (c Clause) VersionRangeOf(attr string) (VersionRange, bool, error) {
	raw, found := c.Attributes[attr]
	if !found || strings.TrimSpace(raw) == "" {
		return VersionRange{}, false, nil
	}
	r, err := ParseVersionRange(raw)
	if err != nil {
		return VersionRange{}, false, err
	}
	return r, true, nil
}

// IsOptional reports whether the clause carries resolution:=optional.
func (c Clause) IsOptional() bool {
	return strings.EqualFold(c.Directives["resolution"], "optional")
}

// IsReexport reports whether the clause carries visibility:=reexport.
func (c Clause) IsReexport() bool {
	return strings.EqualFold(c.Directives["visibility"], "reexport")
}

// ParseClauseList parses an OSGi comma-separated clause list. Commas and
// semicolons inside quoted values are preserved.
func ParseClauseList(header string) ([]Clause, error) {
	var out []Clause
	for _, part := range splitTopLevel(header, ',') {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		clause, err := parseClause(part)
		if err != nil {
			return nil, err
		}
		out = append(out, clause)
	}
	return out, nil
}

func parseClause(text string) (Clause, error) {
	params := splitTopLevel(text, ';')
	name := strings.TrimSpace(params[0])
	if name == "" {
		return Clause{}, fmt.Errorf("empty OSGi clause in %q", text)
	}
	clause := Clause{Name: name, Attributes: map[string]string{}, Directives: map[string]string{}}
	for _, param := range params[1:] {
		param = strings.TrimSpace(param)
		if param == "" {
			continue
		}
		key, value, isDirective := strings.Cut(param, ":=")
		if !isDirective {
			var ok bool
			key, value, ok = strings.Cut(param, "=")
			if !ok {
				return Clause{}, fmt.Errorf("malformed OSGi parameter %q in clause %q", param, text)
			}
		}
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		value = strings.Trim(value, `"`)
		if key == "" {
			return Clause{}, fmt.Errorf("malformed OSGi parameter %q in clause %q", param, text)
		}
		if isDirective {
			clause.Directives[key] = value
		} else {
			clause.Attributes[key] = value
		}
	}
	return clause, nil
}

// splitTopLevel splits text on sep, ignoring separators inside double quotes.
func splitTopLevel(text string, sep byte) []string {
	var parts []string
	var current strings.Builder
	inQuotes := false
	for i := 0; i < len(text); i++ {
		ch := text[i]
		switch {
		case ch == '"':
			inQuotes = !inQuotes
			current.WriteByte(ch)
		case ch == sep && !inQuotes:
			parts = append(parts, current.String())
			current.Reset()
		default:
			current.WriteByte(ch)
		}
	}
	parts = append(parts, current.String())
	return parts
}

// Bundle is the typed view of a bundle manifest: what the resolver and the
// workspace model need, nothing more.
type Bundle struct {
	SymbolicName string
	Version      Version
	Name         string
	Vendor       string
	// Singleton reads the singleton:=true directive of Bundle-SymbolicName.
	Singleton bool
	// ExecutionEnvironment is Bundle-RequiredExecutionEnvironment (e.g. JavaSE-1.6).
	ExecutionEnvironment string
	RequireBundle        []Clause
	ImportPackage        []Clause
	ExportPackage        []Clause
	DynamicImportPackage []Clause
	// FragmentHost is nil for regular bundles.
	FragmentHost *Clause
	// BundleClassPath lists the bundle-internal classpath entries (".", "lib/x.jar").
	BundleClassPath []string
	// Location is where the bundle was read from (jar path or exploded dir).
	Location string
	// Manifest is the raw parsed manifest, for anything not modeled above.
	Manifest *Manifest
}

// ParseBundle builds a Bundle from manifest bytes and the location they came from.
// Headers that are structurally invalid are reported as errors; missing optional
// headers fall back to sane defaults (version 0.0.0, classpath ".").
func ParseBundle(data []byte, location string) (*Bundle, error) {
	mf, err := ParseManifest(data)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", location, err)
	}
	return bundleFromManifest(mf, location)
}

func bundleFromManifest(mf *Manifest, location string) (*Bundle, error) {
	b := &Bundle{Location: location, Manifest: mf, BundleClassPath: []string{"."}}

	rawName := mf.Main["Bundle-SymbolicName"]
	if rawName == "" {
		return nil, fmt.Errorf("%s: missing Bundle-SymbolicName", location)
	}
	clauses, err := ParseClauseList(rawName)
	if err != nil {
		return nil, fmt.Errorf("%s: Bundle-SymbolicName: %w", location, err)
	}
	if len(clauses) != 1 {
		return nil, fmt.Errorf("%s: Bundle-SymbolicName must have exactly one clause, got %d", location, len(clauses))
	}
	b.SymbolicName = clauses[0].Name
	b.Singleton = strings.EqualFold(clauses[0].Directives["singleton"], "true")

	if raw := mf.Main["Bundle-Version"]; raw != "" {
		v, err := ParseVersion(raw)
		if err != nil {
			return nil, fmt.Errorf("%s: Bundle-Version: %w", location, err)
		}
		b.Version = v
	}
	b.Name = mf.Main["Bundle-Name"]
	b.Vendor = mf.Main["Bundle-Vendor"]
	b.ExecutionEnvironment = mf.Main["Bundle-RequiredExecutionEnvironment"]

	if raw := mf.Main["Bundle-ClassPath"]; raw != "" {
		var entries []string
		for e := range strings.SplitSeq(raw, ",") {
			if e = strings.TrimSpace(e); e != "" {
				entries = append(entries, e)
			}
		}
		if len(entries) > 0 {
			b.BundleClassPath = entries
		}
	}

	if b.RequireBundle, err = clausesOf(mf, "Require-Bundle", location); err != nil {
		return nil, err
	}
	if b.ImportPackage, err = clausesOf(mf, "Import-Package", location); err != nil {
		return nil, err
	}
	if b.ExportPackage, err = clausesOf(mf, "Export-Package", location); err != nil {
		return nil, err
	}
	if b.DynamicImportPackage, err = clausesOf(mf, "DynamicImport-Package", location); err != nil {
		return nil, err
	}

	if raw := mf.Main["Fragment-Host"]; raw != "" {
		hostClauses, err := ParseClauseList(raw)
		if err != nil {
			return nil, fmt.Errorf("%s: Fragment-Host: %w", location, err)
		}
		if len(hostClauses) != 1 {
			return nil, fmt.Errorf("%s: Fragment-Host must have exactly one clause, got %d", location, len(hostClauses))
		}
		b.FragmentHost = &hostClauses[0]
	}
	return b, nil
}

func clausesOf(mf *Manifest, header, location string) ([]Clause, error) {
	raw := mf.Main[header]
	if raw == "" {
		return nil, nil
	}
	clauses, err := ParseClauseList(raw)
	if err != nil {
		return nil, fmt.Errorf("%s: %s: %w", location, header, err)
	}
	return clauses, nil
}
