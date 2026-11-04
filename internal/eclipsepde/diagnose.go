package eclipsepde

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"
)

// Diagnostic is one answer to "why won't my plugin start?". Cause, Evidence and
// Actions are separate because the panel must show the user a reason, the manifest
// header that proves it, and what to do next — not just a red row.
type Diagnostic struct {
	// ID is stable across reloads (bundle + kind + requirement), so the UI can keep
	// the expanded row.
	ID       string `json:"id"`
	Bundle   string `json:"bundle"`
	Version  string `json:"version"`
	Severity string `json:"severity"` // error | warning | info
	// Kind is the machine-readable rule: missing-requirement, version-conflict, bree,
	// singleton-duplicate, orphan-fragment, platform-filter, duplicate-bundle,
	// transitive-requirement, resolved-lazy, not-started.
	Kind           string   `json:"kind"`
	Title          string   `json:"title"`
	Cause          string   `json:"cause"`
	Evidence       []string `json:"evidence"`
	Actions        []string `json:"actions"`
	Requirement    string   `json:"requirement,omitempty"`
	Available      []string `json:"available,omitempty"`
	File           string   `json:"file,omitempty"`
	Line           int      `json:"line,omitzero"`
	RelatedBundles []string `json:"relatedBundles,omitempty"`
}

// DiagnosisInput is everything the static diagnostics need. JVM is the major version
// of the JVM chosen for the project (0 when none is chosen): a bundle may require a
// newer Java than the one that will run it.
type DiagnosisInput struct {
	Workspace *Workspace
	Index     *BundleIndex
	JVM       int
	Plan      StartLevelPlan
	HasTarget bool
}

// Diagnose runs every static rule of the Bundle Diagnostics feature. It reads the
// bundled manifest, the target index and the declared start order; it never starts the
// framework, so it works on a Java 6 workspace without migrating anything.
func Diagnose(input DiagnosisInput) []Diagnostic {
	if input.Workspace == nil {
		return nil
	}
	var out []Diagnostic
	index := input.Index
	if index == nil {
		index = NewBundleIndex()
	}
	root := input.Workspace.Root
	resolver := NewResolver(index)
	if input.JVM > 0 {
		resolver.ExecutionEnvironment = fmt.Sprintf("JavaSE-1.%d", input.JVM)
	}
	platform := p2Environment(false)

	for _, proj := range input.Workspace.Bundles() {
		bundle := proj.Bundle
		if bundle == nil {
			continue
		}
		entry := &IndexedBundle{Bundle: bundle, Source: SourceWorkspace, Exploded: true}
		base := diagnosticBase(proj, input.Workspace.Root)
		var resolution *Resolution
		if input.HasTarget {
			resolution = resolver.Resolve(entry)
		}

		// A platform filter excludes the bundle on this machine: it never resolves
		// even when every requirement is present.
		if filter := strings.TrimSpace(bundle.Manifest.Main["Eclipse-PlatformFilter"]); filter != "" && !bundle.MatchesPlatform(platform) {
			out = append(out, Diagnostic{
				ID: base + "|platform-filter", Bundle: bundle.SymbolicName, Version: bundle.Version.String(),
				Severity: "warning", Kind: "platform-filter",
				Title: "Not installed on this platform",
				Cause: fmt.Sprintf("Eclipse-PlatformFilter %s does not match this machine, so the bundle is left out of the target instead of resolving.", filter),
				Evidence: []string{"Eclipse-PlatformFilter: " + filter, platformString(platform)},
				Actions:  []string{"install the variant of this bundle for this OS/architecture", "remove Eclipse-PlatformFilter if the bundle is platform independent"},
				File:     manifestPath(root, proj), RelatedBundles: nil,
			})
		}

		// The execution environment is part of "why": the framework can resolve a
		// bundle and still refuse to start it on an older JVM.
		if input.JVM > 0 {
			if required := strings.TrimSpace(bundle.ExecutionEnvironment); required != "" {
				if level, ok := executionEnvironmentLevel(firstEnvironment(required)); ok && level > input.JVM {
					out = append(out, Diagnostic{
						ID: base + "|bree", Bundle: bundle.SymbolicName, Version: bundle.Version.String(),
						Severity: "error", Kind: "bree",
						Title: fmt.Sprintf("Requires Java %d, the project runs Java %d", level, input.JVM),
						Cause: "Bundle-RequiredExecutionEnvironment is newer than the JVM selected for this project: Equinox cannot resolve the system bundle for it and the bundle stays INSTALLED.",
						Evidence: []string{"Bundle-RequiredExecutionEnvironment: " + required, fmt.Sprintf("project JVM: Java %d", input.JVM)},
						Actions:  []string{"select a newer JVM in Java › Select JDK", "lower the execution environment of the bundle if the code allows it"},
						File:     manifestPath(root, proj),
					})
				}
			}
		}

		if bundle.FragmentHost != nil {
			host := bundle.FragmentHost.Name
			if matches := index.ByName(host); len(matches) == 0 {
				out = append(out, Diagnostic{
					ID: base + "|orphan-fragment", Bundle: bundle.SymbolicName, Version: bundle.Version.String(),
					Severity: "error", Kind: "orphan-fragment",
					Title: "Fragment without its host",
					Cause: fmt.Sprintf("This is a fragment of %s, which is not in the target platform or in the workspace: a fragment cannot resolve alone.", host),
					Evidence: []string{"Fragment-Host: " + host},
					Actions:  []string{"add " + host + " to the target platform", "import the host plug-in into the workspace"},
					File:     manifestPath(root, proj), RelatedBundles: []string{host},
				})
			}
		}

		if resolution != nil {
			for _, missing := range resolution.Root.Missing {
				out = append(out, diagnosticForMissing(base, root, proj, bundle, missing))
			}
			// Failures two or more hops away: this bundle resolves itself but will
			// not start because something it requires is broken.
			for _, missing := range resolution.Explain() {
				if len(missing.Chain) <= 2 {
					continue
				}
				related := missing.Chain[len(missing.Chain)-2]
				out = append(out, Diagnostic{
					ID: base + "|transitive|" + missing.Requirement.Kind + "|" + missing.Requirement.Name + "|" + related,
					Bundle: bundle.SymbolicName, Version: bundle.Version.String(),
					Severity: "warning", Kind: "transitive-requirement",
					Title:       "A bundle it requires cannot resolve",
					Cause:       missing.Requirement.Kind + " " + missing.Requirement.Name + " is missing inside " + related + ", so the whole chain stays INSTALLED at runtime.",
					Evidence:    []string{"chain: " + strings.Join(missing.Chain, " → "), "missing requirement: " + missing.Requirement.String()},
					Actions:     missing.Actions,
					Requirement: missing.Requirement.String(),
					Available:   missing.Available,
					File:        manifestPath(root, proj), RelatedBundles: []string{related},
				})
			}

			// RESOLVED is not broken. Say why it is not ACTIVE instead of warning.
			if resolution.Root.Status != StatusUnresolved {
				switch {
				case bundle.LazyActivation:
					out = append(out, Diagnostic{
						ID: base + "|resolved-lazy", Bundle: bundle.SymbolicName, Version: bundle.Version.String(),
						Severity: "info", Kind: "resolved-lazy",
						Title:   "Ready, not active yet (lazy)",
						Cause:   "The bundle is RESOLVED and activates on the first class load: this is normal for Bundle-ActivationPolicy: lazy, not a failure.",
						Evidence: []string{"Bundle-ActivationPolicy: " + activationEvidence(bundle), "state: RESOLVED",
							"the framework activates it when one of its classes is loaded"},
						Actions: []string{"nothing to fix", "use Start in the framework console to activate it eagerly for a test"},
					})
				case input.Plan.Configured:
					level, start, found := input.Plan.LevelFor(bundle.Location)
					if !found || !start {
						out = append(out, Diagnostic{
							ID: base + "|not-started", Bundle: bundle.SymbolicName, Version: bundle.Version.String(),
							Severity: "warning", Kind: "not-started",
							Title:   "Resolved but not started by the launch configuration",
							Cause:   fmt.Sprintf("The bundle resolves but osgi.bundles does not start it: it stays RESOLVED at start level %d.", level),
							Evidence: []string{"osgi.bundles: no start instruction for this bundle",
								fmt.Sprintf("declared start level: %d", level), "activation policy: eager"},
							Actions: []string{"start it from the launch configuration", "add @start to its osgi.bundles entry"},
							File:    relativeOrAbsolute(input.Workspace.Root, startLevelConfigPath(input.Workspace.Root)),
						})
					}
				}
			}
		}
	}

	// Framework-wide conflicts: the workspace bundles are the same version twice, or a
	// singleton exists at several versions (Equinox keeps only the newest).
	exact, _ := index.Duplicates()
	for name, locations := range exact {
		out = append(out, Diagnostic{
			ID: "duplicate-bundle|" + name, Bundle: strings.Split(name, "_")[0], Severity: "warning", Kind: "duplicate-bundle",
			Title: "The same bundle is present more than once",
			Cause: "Two copies of the same symbolic name and version are in the target or the workspace: PDE picks one, and the class loader keeps only that one.",
			Evidence: append([]string{"symbolic name and version: " + name}, locations...),
			Actions:  []string{"remove the duplicate from the target platform", "reindex the target after removing it"},
		})
	}
	singletons := map[string]bool{}
	for _, entry := range index.All() {
		if entry.Bundle.Singleton {
			singletons[entry.Bundle.SymbolicName] = true
		}
	}
	names := make([]string, 0, len(singletons))
	for name := range singletons {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		versions := index.ByName(name)
		if len(versions) < 2 {
			continue
		}
		seen := map[string]bool{}
		var labels []string
		for _, version := range versions {
			label := version.Bundle.Version.String()
			if !seen[label] {
				seen[label] = true
				labels = append(labels, label)
			}
		}
		sort.Strings(labels)
		out = append(out, Diagnostic{
			ID: "singleton-duplicate|" + name, Bundle: name, Severity: "warning", Kind: "singleton-duplicate",
			Title:       "Singleton present at several versions",
			Cause:       "Equinox keeps only the newest version of a singleton; bundles wired to an older one fail at runtime even if they compile.",
			Evidence:    append([]string{"singleton:=true", "versions in the index:"}, labels...),
			Actions:     []string{"keep one version in the target platform", "align the Require-Bundle ranges of the workspace bundles"},
			Available:   labels,
			RelatedBundles: []string{name},
		})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Severity != out[j].Severity {
			return severityRank(out[i].Severity) < severityRank(out[j].Severity)
		}
		if out[i].Bundle != out[j].Bundle {
			return out[i].Bundle < out[j].Bundle
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// diagnosticForMissing classifies one unsatisfied requirement: a provider that exists
// but outside the version range is a very different fix from a bundle that is not
// there at all.
func diagnosticForMissing(base, root string, proj *EclipseProject, bundle *Bundle, missing MissingRequirement) Diagnostic {
	req := missing.Requirement
	diagnostic := Diagnostic{
		ID:          base + "|" + req.Kind + "|" + req.Name,
		Bundle:      bundle.SymbolicName,
		Version:     bundle.Version.String(),
		Severity:    "error",
		Requirement: req.String(),
		Available:   append([]string{}, missing.Available...),
		Actions:     append([]string{}, missing.Actions...),
		Evidence:    []string{req.Kind + ": " + req.Name},
		File:        manifestPath(root, proj),
	}
	if req.RangeOK {
		diagnostic.Evidence = append(diagnostic.Evidence, "requested range: "+req.Range.String())
	}
	if req.Optional {
		diagnostic.Severity = "info"
		diagnostic.Kind = "optional-requirement"
		diagnostic.Title = "Optional requirement not satisfied"
		diagnostic.Cause = "resolution:=optional, so the bundle still resolves: features that need it are the only ones missing."
		diagnostic.Evidence = append(diagnostic.Evidence, "resolution:=optional")
		return diagnostic
	}
	switch {
	case req.Kind == "Bundle-RequiredExecutionEnvironment":
		diagnostic.Kind = "bree"
		diagnostic.Title = "Execution environment not provided"
		diagnostic.Cause = "The framework must run on an execution environment that the bundle requires; this target does not provide it."
	case len(missing.Available) > 0:
		diagnostic.Kind = "version-conflict"
		diagnostic.Title = "Version conflict: the provider is there, the range is not satisfied"
		diagnostic.Cause = fmt.Sprintf("%s provides %s, but none of those versions is inside %s. PDE compiles against one of them only if the range allows it; at runtime the bundle stays INSTALLED.",
			req.Name, strings.Join(missing.Available, ", "), req.Range.String())
		diagnostic.Actions = append([]string{"widen the version range of " + req.Name + " if the API is compatible"}, diagnostic.Actions...)
	default:
		diagnostic.Kind = "missing-requirement"
		diagnostic.Title = "Requirement missing from the target platform"
		diagnostic.Cause = fmt.Sprintf("Nothing in the target platform or the workspace provides %s: the bundle stays INSTALLED until it is added.", req.Name)
	}
	if len(missing.Chain) > 1 {
		diagnostic.Evidence = append(diagnostic.Evidence, "chain: "+strings.Join(missing.Chain, " → "))
	}
	if len(diagnostic.Actions) == 0 {
		diagnostic.Actions = []string{"inspect the target platform for a compatible bundle"}
	}
	return diagnostic
}

// diagnosticBase is the stable prefix of a bundle's diagnostic IDs.
func diagnosticBase(proj *EclipseProject, root string) string {
	name := ""
	if proj.Bundle != nil {
		name = proj.Bundle.SymbolicName
	}
	if name == "" {
		name = proj.Name
	}
	return name + "@" + relativeOrAbsolute(root, proj.Dir)
}

// manifestPath is the manifest of a project, relative to the workspace when possible.
func manifestPath(root string, proj *EclipseProject) string {
	return relativeOrAbsolute(root, filepath.Join(proj.Dir, "META-INF", "MANIFEST.MF"))
}

// startLevelConfigPath is the generated config.ini of the project.
func startLevelConfigPath(root string) string {
	return filepath.Join(root, filepath.FromSlash(startLevelConfigFile))
}

// severityRank orders error < warning < info for stable grouping.
func severityRank(severity string) int {
	switch severity {
	case "error":
		return 0
	case "warning":
		return 1
	default:
		return 2
	}
}

// activationEvidence renders the header the lazy policy came from.
func activationEvidence(bundle *Bundle) string {
	if raw := bundle.Manifest.Main["Bundle-ActivationPolicy"]; raw != "" {
		return raw
	}
	if raw := bundle.Manifest.Main["Eclipse-LazyStart"]; raw != "" {
		return "Eclipse-LazyStart " + raw
	}
	return "lazy"
}

// platformString is the environment the platform filter was checked against.
func platformString(platform map[string]string) string {
	return fmt.Sprintf("platform: osgi.os=%s, osgi.ws=%s, osgi.arch=%s", platform["osgi.os"], platform["osgi.ws"], platform["osgi.arch"])
}
