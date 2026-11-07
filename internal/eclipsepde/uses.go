package eclipsepde

import (
	"sort"
	"strings"
)

// usesConflicts finds the `uses` constraint violations of a resolved bundle, the class-space check
// Equinox makes and the static resolver otherwise skips. When the bundle gets package p from E, and
// E's export of p says uses:="q", the bundle must see q from the same provider E sees it from;
// otherwise the same type reaches it from two class loaders (LinkageError, ClassCastException), and
// Equinox refuses that wiring. It checks one constraint level, the one that reports nearly every
// real conflict; Equinox may still find another wiring this static pick did not try.
func usesConflicts(resolution *Resolution, manifestFile string) []Diagnostic {
	if resolution == nil || resolution.Root == nil {
		return nil
	}
	root := resolution.Root
	bundle := root.Bundle.Bundle
	var out []Diagnostic
	seen := map[string]bool{}
	check := func(pkg string, exporter *BundleResolution, via string) {
		clause, ok := exportClause(exporter.Bundle.Bundle, pkg)
		if !ok {
			return
		}
		for used := range strings.SplitSeq(clause.Directives["uses"], ",") {
			used = strings.TrimSpace(used)
			if used == "" || used == pkg {
				continue
			}
			theirs, okTheirs := packageView(exporter, used, resolution.Transitive)
			mine, okMine := packageView(root, used, resolution.Transitive)
			if !okTheirs || !okMine || theirs == mine || seen[pkg+"|"+used] {
				continue
			}
			seen[pkg+"|"+used] = true
			out = append(out, Diagnostic{
				ID: bundle.SymbolicName + "|uses-conflict|" + pkg + "|" + used, Bundle: bundle.SymbolicName, Version: bundle.Version.String(),
				Severity: "warning", Kind: "uses-conflict",
				Title:          "uses conflict on " + used,
				Cause:          "the bundle gets " + pkg + " from " + labelOf(exporter.Bundle) + " " + via + ", whose export uses " + used + " from " + theirs + ", but the bundle itself sees " + used + " from " + mine + ": Equinox refuses this wiring (a uses constraint violation) or the same class arrives from two class loaders.",
				Evidence:       []string{"Export-Package: " + pkg + ";uses:=\"" + clause.Directives["uses"] + "\" in " + labelOf(exporter.Bundle), used + " seen from " + mine},
				Actions:        []string{"import " + used + " with a version range that only " + theirs + " satisfies", "remove the other provider of " + used + " from the target"},
				Requirement:    used,
				File:           manifestFile,
				RelatedBundles: []string{exporter.Bundle.Bundle.SymbolicName},
			})
		}
	}
	for _, wire := range root.Wires {
		provider := resolution.Transitive[wire.Provider+" "+wire.ProviderVersion]
		if provider == nil || provider == root {
			continue
		}
		switch wire.Kind {
		case "Import-Package":
			check(wire.Name, provider, "(Import-Package)")
		case "Require-Bundle":
			for _, export := range provider.Bundle.Bundle.ExportPackage {
				check(export.Name, provider, "(Require-Bundle "+wire.Name+")")
			}
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func exportClause(bundle *Bundle, pkg string) (Clause, bool) {
	for _, export := range bundle.ExportPackage {
		if export.Name == pkg {
			return export, true
		}
	}
	return Clause{}, false
}

// packageView is the provider a resolved bundle sees a package from: its Import-Package wire, then
// its own export, then the exports of the bundles it requires.
func packageView(resolution *BundleResolution, pkg string, transitive map[string]*BundleResolution) (string, bool) {
	for _, wire := range resolution.Wires {
		if wire.Kind == "Import-Package" && wire.Name == pkg {
			return wire.Provider + " " + wire.ProviderVersion, true
		}
	}
	if _, ok := exportClause(resolution.Bundle.Bundle, pkg); ok {
		return labelOf(resolution.Bundle), true
	}
	for _, wire := range resolution.Wires {
		if wire.Kind != "Require-Bundle" {
			continue
		}
		if required := transitive[wire.Provider+" "+wire.ProviderVersion]; required != nil {
			if _, ok := exportClause(required.Bundle.Bundle, pkg); ok {
				return labelOf(required.Bundle), true
			}
		}
	}
	return "", false
}
