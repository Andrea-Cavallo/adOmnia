// Package eclipsepde is the Eclipse PDE / OSGi compatibility layer behind Code Studio's
// legacy Java support (Eclipse Kepler + Java 6 + MANIFEST.MF projects).
//
// It models what PDE needs to import a workspace, index a Custom Target Platform and
// diagnose dependency resolution: OSGi versions and ranges, bundle manifests, Eclipse
// project metadata, bundle indexes and a resolution diagnostic with "Explain Dependency".
//
// Scope note (spec section 8): this is NOT a byte-for-byte reimplementation of the
// Equinox resolver. Where PDE fidelity matters the caller is expected to delegate to the
// isolated legacy PDE/Equinox bridge; what lives here is the read-only model, the index
// and the diagnostic resolver used for fast local feedback. Nothing in this package
// writes to the imported workspace: reading is the only side effect on user files.
package eclipsepde

import (
	"fmt"
	"strconv"
	"strings"
)

// Version is an OSGi version: major.minor.micro[.qualifier].
type Version struct {
	Major     int
	Minor     int
	Micro     int
	Qualifier string
}

// ParseVersion parses "1.2.3.qualifier". Missing parts default to zero.
func ParseVersion(s string) (Version, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return Version{}, fmt.Errorf("empty OSGi version")
	}
	parts := strings.SplitN(s, ".", 4)
	v := Version{}
	nums := parts
	if len(parts) == 4 {
		v.Qualifier = parts[3]
		nums = parts[:3]
	}
	for i, p := range nums {
		n, err := strconv.Atoi(p)
		if err != nil {
			return Version{}, fmt.Errorf("invalid OSGi version %q: part %q is not a number", s, p)
		}
		switch i {
		case 0:
			v.Major = n
		case 1:
			v.Minor = n
		case 2:
			v.Micro = n
		}
	}
	return v, nil
}

// String renders the version as major.minor.micro[.qualifier].
func (v Version) String() string {
	s := fmt.Sprintf("%d.%d.%d", v.Major, v.Minor, v.Micro)
	if v.Qualifier != "" {
		s += "." + v.Qualifier
	}
	return s
}

// Compare orders two versions per OSGi Core: numerically, then qualifier
// lexicographically (empty qualifier sorts first).
func (v Version) Compare(o Version) int {
	if c := cmpInt(v.Major, o.Major); c != 0 {
		return c
	}
	if c := cmpInt(v.Minor, o.Minor); c != 0 {
		return c
	}
	if c := cmpInt(v.Micro, o.Micro); c != 0 {
		return c
	}
	return strings.Compare(v.Qualifier, o.Qualifier)
}

func cmpInt(a, b int) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	}
	return 0
}

// VersionRange is an OSGi version range such as [2.0.0,3.0.0), [1.2,) or a plain
// minimum version like 1.2.3 (treated as [1.2.3,∞)).
type VersionRange struct {
	Floor          Version
	Ceiling        Version
	IncludeFloor   bool
	IncludeCeiling bool
	HasCeiling     bool
}

// ParseVersionRange accepts the OSGi interval syntax and the bare-version shorthand.
func ParseVersionRange(s string) (VersionRange, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return VersionRange{}, fmt.Errorf("empty OSGi version range")
	}
	open := s[0]
	if open != '[' && open != '(' {
		// Plain version: floor inclusive, no ceiling.
		v, err := ParseVersion(s)
		if err != nil {
			return VersionRange{}, err
		}
		return VersionRange{Floor: v, IncludeFloor: true}, nil
	}
	if len(s) < 2 || (s[len(s)-1] != ']' && s[len(s)-1] != ')') {
		return VersionRange{}, fmt.Errorf("invalid OSGi version range %q: missing closing bracket", s)
	}
	close := s[len(s)-1]
	inner := s[1 : len(s)-1]
	comma := strings.Index(inner, ",")
	if comma < 0 {
		return VersionRange{}, fmt.Errorf("invalid OSGi version range %q: missing ','", s)
	}
	floorStr := strings.TrimSpace(inner[:comma])
	ceilStr := strings.TrimSpace(inner[comma+1:])
	r := VersionRange{
		IncludeFloor:   open == '[',
		IncludeCeiling: close == ']',
	}
	if floorStr != "" {
		v, err := ParseVersion(floorStr)
		if err != nil {
			return VersionRange{}, fmt.Errorf("invalid OSGi version range %q: %w", s, err)
		}
		r.Floor = v
	}
	if ceilStr != "" {
		v, err := ParseVersion(ceilStr)
		if err != nil {
			return VersionRange{}, fmt.Errorf("invalid OSGi version range %q: %w", s, err)
		}
		r.Ceiling = v
		r.HasCeiling = true
	}
	return r, nil
}

// Match reports whether v is inside the range.
func (r VersionRange) Match(v Version) bool {
	switch c := v.Compare(r.Floor); {
	case c < 0:
		return false
	case c == 0 && !r.IncludeFloor && r.Floor != (Version{}):
		// Explicit exclusive floor: the floor version itself is out. An unset
		// floor (open start, "(,x]") keeps matching 0.0.0 so ordinary bundles
		// are not excluded by a range that only states a ceiling.
		return false
	}
	if r.HasCeiling {
		if c := v.Compare(r.Ceiling); c > 0 || (c == 0 && !r.IncludeCeiling) {
			return false
		}
	}
	return true
}

// String renders the range in OSGi syntax. A range with a zero floor and no
// explicit brackets renders its floor as empty, as in "(,2.0.0]".
func (r VersionRange) String() string {
	if !r.HasCeiling && r.IncludeFloor {
		return r.Floor.String()
	}
	open, close := "(", ")"
	if r.IncludeFloor {
		open = "["
	}
	if r.IncludeCeiling {
		close = "]"
	}
	floor := r.Floor.String()
	if r.Floor == (Version{}) && !r.IncludeFloor {
		floor = ""
	}
	ceil := ""
	if r.HasCeiling {
		ceil = r.Ceiling.String()
	}
	return open + floor + "," + ceil + close
}
