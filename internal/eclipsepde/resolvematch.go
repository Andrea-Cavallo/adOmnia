package eclipsepde

import (
	"strconv"
	"strings"
)

// Import-Package attributes that select the version, not the exporter: they are
// matched by the version range, not as plain attributes.
var versionAttributes = map[string]bool{"version": true, "specification-version": true}

// Attributes the framework sets on every export: an import may match on them.
const (
	attributeBundleName    = "bundle-symbolic-name"
	attributeBundleVersion = "bundle-version"
)

// exportMatchesImport applies the OSGi attribute matching of an import clause to
// one export, as Equinox does: bundle-symbolic-name and bundle-version select the
// exporting bundle, any other attribute must be equal on the export, and every
// attribute the export declares mandatory must be named by the import.
func exportMatchesImport(imported Clause, exported Clause, exporter *IndexedBundle) bool {
	for name, value := range imported.Attributes {
		if versionAttributes[name] {
			continue
		}
		switch name {
		case attributeBundleName:
			if exporter.Bundle.SymbolicName != value {
				return false
			}
		case attributeBundleVersion:
			if r, err := ParseVersionRange(value); err != nil || !r.Match(exporter.Bundle.Version) {
				return false
			}
		default:
			if exported.Attributes[name] != value {
				return false
			}
		}
	}
	for mandatory := range strings.SplitSeq(exported.Directives["mandatory"], ",") {
		if mandatory = strings.TrimSpace(mandatory); mandatory != "" {
			if _, named := imported.Attributes[mandatory]; !named {
				return false
			}
		}
	}
	return true
}

// executionEnvironmentLevel orders the Java execution environments: JavaSE-1.6
// is 6, JavaSE-11 is 11, JRE-1.1 is 1, OSGi/Minimum is 0 (any Java SE runs it).
// ok is false for an environment Java SE does not provide (CDC/Foundation…).
func executionEnvironmentLevel(name string) (level int, ok bool) {
	name = strings.TrimSpace(name)
	switch {
	case strings.HasPrefix(name, "OSGi/Minimum-"):
		return 0, true
	case name == "JRE-1.1":
		return 1, true
	case strings.HasPrefix(name, "J2SE-1."):
		return minorLevel(strings.TrimPrefix(name, "J2SE-1."))
	case strings.HasPrefix(name, "JavaSE/compact"):
		_, version, found := strings.Cut(name, "-")
		if !found {
			return 0, false
		}
		return minorLevel(strings.TrimPrefix(version, "1."))
	case strings.HasPrefix(name, "JavaSE-1."):
		return minorLevel(strings.TrimPrefix(name, "JavaSE-1."))
	case strings.HasPrefix(name, "JavaSE-"):
		return minorLevel(strings.TrimPrefix(name, "JavaSE-"))
	}
	return 0, false
}

func minorLevel(text string) (int, bool) {
	level, err := strconv.Atoi(text)
	return level, err == nil
}

// executionEnvironmentSatisfied reports whether a target running `target`
// satisfies Bundle-RequiredExecutionEnvironment `required` (a comma list: one
// match is enough). An unknown target environment is not checked.
func executionEnvironmentSatisfied(target, required string) bool {
	targetLevel, known := executionEnvironmentLevel(target)
	if !known || strings.TrimSpace(required) == "" {
		return true
	}
	for environment := range strings.SplitSeq(required, ",") {
		if level, ok := executionEnvironmentLevel(environment); ok && level <= targetLevel {
			return true
		}
	}
	return false
}
