package eclipsepde

import (
	"sort"
	"strconv"
	"strings"
)

// ExplorerSummary are the clickable cards of the OSGi Control Center. They count the
// workspace bundles only: the target platform is reported separately because a bundle
// of the target is not "resolved" by adOmnia, it is simply available.
type ExplorerSummary struct {
	Bundles int `json:"bundles"`
	// Resolved counts the workspace bundles whose requirements the target satisfies.
	Resolved int `json:"resolved"`
	// Lazy counts the resolved bundles that activate on first class load.
	Lazy   int `json:"lazy"`
	Issues int `json:"issues"`
	// Fragments counts the workspace bundles that are fragments.
	Fragments int `json:"fragments"`
	// Active counts the workspace bundles the running framework reports ACTIVE (0 until the
	// runtime is started: the static analysis never claims it).
	Active int `json:"active"`
	// Services is the size of the service registry of the running framework.
	Services int `json:"services"`
	// RuntimeIssues are the problems only the runtime can see (not resolved, never activated).
	RuntimeIssues int `json:"runtimeIssues"`
}

// BundleRow is one line of the OSGi Plugin Explorer: identity, state, activator and
// start level at a glance, for workspace and target bundles alike.
type BundleRow struct {
	SymbolicName         string `json:"symbolicName"`
	Version              string `json:"version"`
	Name                 string `json:"name,omitempty"`
	Vendor               string `json:"vendor,omitempty"`
	Location             string `json:"location"`
	Source               string `json:"source"`
	Activator            string `json:"activator,omitempty"`
	ActivationPolicy     string `json:"activationPolicy"`
	Lazy                 bool   `json:"lazy"`
	StartLevel           int    `json:"startLevel"`
	StartOnLaunch        bool   `json:"startOnLaunch"`
	StartLevelConfigured bool   `json:"startLevelConfigured"`
	// State is the honest static state: INSTALLED when a requirement is missing,
	// RESOLVED otherwise. ACTIVE only exists in a running framework (R2).
	State  string           `json:"state"`
	Status ResolutionStatus `json:"status"`
	// RuntimeState is the state the running framework reports (INSTALLED/RESOLVED/ACTIVE),
	// empty until the Runtime tab starts it.
	RuntimeState string `json:"runtimeState,omitempty"`
	// ActiveAtMs is when the profiler first observed it ACTIVE, relative to the launch.
	ActiveAtMs           int64               `json:"activeAtMs,omitempty"`
	Fragment             bool                `json:"fragment"`
	FragmentHost         string              `json:"fragmentHost,omitempty"`
	ExecutionEnvironment string              `json:"executionEnvironment,omitempty"`
	ExportedPackages     []string            `json:"exportedPackages,omitempty"`
	RequiredBundles      []string            `json:"requiredBundles,omitempty"`
	ImportedPackages     []string            `json:"importedPackages,omitempty"`
	Dependencies         int                 `json:"dependencies"`
	Exports              int                 `json:"exports"`
	Imports              int                 `json:"imports"`
	Issues               int                 `json:"issues"`
	Missing              []MissingDependency `json:"missing,omitempty"`
	Notes                []string            `json:"notes,omitempty"`

	// searchText is the lowercase full-text index of the row (name, packages,
	// activator, vendor, manifest headers). Never serialized.
	searchText string
	// absolute is where the bundle really is: the Location is relative for display.
	absolute string
	shadowed bool
}

// ExplorerReport is the whole OSGi Plugin Explorer: the enriched bundles of the
// workspace and of the target, the activators, the diagnostics and the summary cards.
type ExplorerReport struct {
	Root          string `json:"root"`
	HasTarget     bool   `json:"hasTarget"`
	TargetPath    string `json:"targetPath"`
	TargetBundles int    `json:"targetBundles"`
	OtherProjects int    `json:"otherProjects"`
	// JVM is the major version of the JVM chosen for the project (0 when none is chosen):
	// the BREE diagnostics are relative to it.
	JVM         int             `json:"jvm,omitzero"`
	Summary     ExplorerSummary `json:"summary"`
	Bundles     []BundleRow     `json:"bundles"`
	Activators  []ActivatorInfo `json:"activators"`
	Diagnostics []Diagnostic    `json:"diagnostics"`
	Problems    []Problem       `json:"problems"`
	// Runtime is the last snapshot of the running framework, nil until it is started.
	Runtime *RuntimeSnapshot `json:"runtime,omitempty"`
	// RuntimeDiagnostics are the problems only the running framework reports.
	RuntimeDiagnostics []Diagnostic `json:"runtimeDiagnostics,omitempty"`

	// The parsed model is kept for the follow-up calls (search, detail, impact, graph)
	// so the service does not read the workspace and the target again per request.
	workspace            *Workspace
	index                *BundleIndex
	merged               *BundleIndex
	plan                 StartLevelPlan
	executionEnvironment string
	resolverEE           string
}

// BuildExplorer reads the workspace and the target platform and builds the Plugin
// Explorer plus the diagnostics of every workspace bundle. Reading only: nothing is
// written or started.
func BuildExplorer(root string, jvmMajor int) (*ExplorerReport, error) {
	ws, err := ImportWorkspace(root)
	if err != nil {
		return nil, err
	}
	settings, err := LoadTargetSettings(ws.Root)
	if err != nil {
		return nil, err
	}
	platform := NewTargetPlatform()
	platform.LoadFromSettings(absoluteProfiles(settings, ws.Root))
	report := &ExplorerReport{
		Root:          ws.Root,
		JVM:           jvmMajor,
		OtherProjects: len(ws.Projects) - len(ws.Bundles()),
		Bundles:       []BundleRow{},
		Activators:    Activators(ws),
		Problems:      relativeProblems(ws.AllProblems(), ws.Root),
		workspace:     ws,
		index:         NewBundleIndex(),
		plan:          ReadStartLevelPlan(ws.Root),
	}
	if profile, ok := platform.ActiveProfile(); ok {
		report.HasTarget, report.TargetPath = true, profile.Path
		index, err := platform.Index()
		if err != nil {
			return nil, err
		}
		report.index = index
		report.TargetBundles = len(index.All())
		report.Problems = append(report.Problems, relativeProblems(index.Problems, ws.Root)...)
		report.executionEnvironment = profile.ExecutionEnvironment
	}
	report.merged = withWorkspace(report.index, ws)

	resolver := NewResolver(report.merged)
	if jvmMajor > 0 {
		resolver.ExecutionEnvironment = javaExecutionEnvironment(jvmMajor)
	} else {
		resolver.ExecutionEnvironment = report.executionEnvironment
	}
	report.resolverEE = resolver.ExecutionEnvironment

	activatorByBundle := map[string]ActivatorInfo{}
	for _, activator := range report.Activators {
		activatorByBundle[activator.Bundle] = activator
	}

	diagnostics := Diagnose(DiagnosisInput{Workspace: ws, Index: report.merged, JVM: jvmMajor, Plan: report.plan, HasTarget: report.HasTarget})
	report.Diagnostics = diagnostics
	issues := map[string]int{}
	for _, diagnostic := range diagnostics {
		// Info diagnostics explain a healthy state: they are not "issues".
		if diagnostic.Severity != "info" {
			issues[diagnostic.Bundle]++
		}
	}

	workspaceNames := map[string]bool{}
	for _, proj := range ws.Bundles() {
		bundle := proj.Bundle
		if bundle == nil {
			continue
		}
		workspaceNames[bundle.SymbolicName] = true
		row := rowForBundle(bundle, SourceWorkspace, ws.Root, report.plan)
		row.Issues = issues[bundle.SymbolicName]
		if resolution, ok := report.resolutionOf(resolver, bundle); ok {
			row.Status = resolution.Status
			row.Notes = append([]string{}, resolution.Notes...)
			for _, missing := range resolution.Missing {
				row.Missing = append(row.Missing, missingDependency(missing))
			}
			if resolution.Status == StatusUnresolved {
				row.State = "INSTALLED"
			} else {
				row.State = "RESOLVED"
			}
		}
		row.Missing = dedupeMissing(row.Missing)
		if activator, ok := activatorByBundle[bundle.SymbolicName]; ok {
			row.Activator = activator.Class
		}
		report.Bundles = append(report.Bundles, row)
	}

	// Target bundles: the explorer is centralized, so the library the workspace compiles
	// against is searchable too. Their state is "in target": the resolver state of a
	// target bundle belongs to the framework, not to this workspace.
	for _, entry := range report.index.All() {
		bundle := entry.Bundle
		row := rowForBundle(bundle, SourceTarget, ws.Root, report.plan)
		row.shadowed = workspaceNames[bundle.SymbolicName]
		row.State = "TARGET"
		row.Issues = issues[bundle.SymbolicName]
		report.Bundles = append(report.Bundles, row)
	}

	sort.SliceStable(report.Bundles, func(i, j int) bool {
		if report.Bundles[i].Source != report.Bundles[j].Source {
			return report.Bundles[i].Source == string(SourceWorkspace)
		}
		if report.Bundles[i].SymbolicName != report.Bundles[j].SymbolicName {
			return report.Bundles[i].SymbolicName < report.Bundles[j].SymbolicName
		}
		return report.Bundles[i].Version < report.Bundles[j].Version
	})
	report.Summary = summarise(report.Bundles)
	return report, nil
}

// resolutionOf resolves one workspace bundle against the merged index.
func (r *ExplorerReport) resolutionOf(resolver *Resolver, bundle *Bundle) (*BundleResolution, bool) {
	if !r.HasTarget {
		return nil, false
	}
	entry := &IndexedBundle{Bundle: bundle, Source: SourceWorkspace, Exploded: true}
	resolution := resolver.Resolve(entry)
	return resolution.Root, true
}

// rowForBundle is the common part of a workspace and a target row.
func rowForBundle(bundle *Bundle, source BundleSource, root string, plan StartLevelPlan) BundleRow {
	row := BundleRow{
		SymbolicName:     bundle.SymbolicName,
		Version:          bundle.Version.String(),
		Name:             bundle.Name,
		Vendor:           bundle.Vendor,
		Location:         relativeOrAbsolute(root, bundle.Location),
		Source:           string(source),
		Activator:        bundle.Activator,
		ActivationPolicy: bundle.ActivationPolicy,
		Lazy:             bundle.LazyActivation,
		// The state is decided by the resolution below (or by the target pass): a bundle
		// is never shown as RESOLVED before the target has been checked.
		State:                "",
		Fragment:             bundle.FragmentHost != nil,
		ExecutionEnvironment: bundle.ExecutionEnvironment,
		Dependencies:         len(bundle.RequireBundle) + len(bundle.ImportPackage),
		Exports:              len(bundle.ExportPackage),
		Imports:              len(bundle.ImportPackage),
		Missing:              []MissingDependency{},
		Notes:                []string{},
		absolute:             bundle.Location,
	}
	if row.ActivationPolicy == "" {
		row.ActivationPolicy = "eager"
	}
	if bundle.FragmentHost != nil {
		row.FragmentHost = bundle.FragmentHost.Name
	}
	for _, clause := range bundle.ExportPackage {
		row.ExportedPackages = append(row.ExportedPackages, clause.Name)
	}
	for _, clause := range bundle.RequireBundle {
		row.RequiredBundles = append(row.RequiredBundles, clause.Name)
	}
	for _, clause := range bundle.ImportPackage {
		row.ImportedPackages = append(row.ImportedPackages, clause.Name)
	}
	level, start, found := plan.LevelFor(bundle.Location)
	row.StartLevel, row.StartOnLaunch, row.StartLevelConfigured = level, start, found
	row.searchText = searchTextOf(bundle)
	return row
}

// searchTextOf builds the lowercase haystack of one bundle: identity, activator, every
// package and every manifest header. A search for "javax.servlet" or for the vendor
// finds the bundle even when its name does not contain the word.
func searchTextOf(bundle *Bundle) string {
	var builder strings.Builder
	builder.WriteString(bundle.SymbolicName)
	builder.WriteString(" ")
	builder.WriteString(bundle.Version.String())
	builder.WriteString(" ")
	builder.WriteString(bundle.Name)
	builder.WriteString(" ")
	builder.WriteString(bundle.Vendor)
	builder.WriteString(" ")
	builder.WriteString(bundle.Activator)
	for _, clause := range bundle.ExportPackage {
		builder.WriteString(" ")
		builder.WriteString(clause.Name)
	}
	for _, clause := range bundle.ImportPackage {
		builder.WriteString(" ")
		builder.WriteString(clause.Name)
	}
	for _, clause := range bundle.RequireBundle {
		builder.WriteString(" ")
		builder.WriteString(clause.Name)
	}
	if bundle.Manifest != nil {
		for name, value := range bundle.Manifest.Main {
			builder.WriteString(" ")
			builder.WriteString(name)
			builder.WriteString(": ")
			builder.WriteString(value)
			if builder.Len() > maxSearchTextBytes {
				break
			}
		}
	}
	return strings.ToLower(builder.String())
}

// maxSearchTextBytes bounds the haystack of one bundle: the manifest of a big plug-in
// can be long, and the index of a thousand target bundles must stay small.
const maxSearchTextBytes = 4096

func summarise(rows []BundleRow) ExplorerSummary {
	summary := ExplorerSummary{}
	for _, row := range rows {
		if row.Source != string(SourceWorkspace) {
			continue
		}
		summary.Bundles++
		if row.Fragment {
			summary.Fragments++
		}
		if row.Issues > 0 {
			summary.Issues++
		}
		if row.State != "RESOLVED" {
			continue
		}
		summary.Resolved++
		if row.Lazy {
			summary.Lazy++
		}
	}
	return summary
}

// dedupeMissing keeps one row per requirement.
func dedupeMissing(missing []MissingDependency) []MissingDependency {
	seen := map[string]bool{}
	out := make([]MissingDependency, 0, len(missing))
	for _, item := range missing {
		key := item.Kind + "|" + item.Name + "|" + item.Range
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, item)
	}
	return out
}

// javaExecutionEnvironment renders a JVM major version as an OSGi execution environment.
func javaExecutionEnvironment(major int) string {
	if major <= 1 {
		return ""
	}
	if major <= 8 {
		return "JavaSE-1." + strconv.Itoa(major)
	}
	return "JavaSE-" + strconv.Itoa(major)
}

// SearchHit is one result of the instant search, with the field that matched so the
// UI can explain the hit.
type SearchHit struct {
	SymbolicName string `json:"symbolicName"`
	Version      string `json:"version"`
	Source       string `json:"source"`
	State        string `json:"state"`
	Field        string `json:"field"`
	Match        string `json:"match"`
	Rank         int    `json:"rank"`
}

// Search runs the instant search over the explorer index (name, activator, packages,
// vendor, manifest headers). Results are ranked: exact name, name prefix, name, then
// activator/package/manifest, workspace before target.
func (r *ExplorerReport) Search(query string, limit int) []SearchHit {
	query = strings.ToLower(strings.TrimSpace(query))
	if query == "" || limit <= 0 {
		return []SearchHit{}
	}
	hits := make([]SearchHit, 0, 32)
	for _, row := range r.Bundles {
		rank, field, match := -1, "", ""
		name := strings.ToLower(row.SymbolicName)
		switch {
		case name == query:
			rank, field, match = 0, "name", row.SymbolicName
		case strings.HasPrefix(name, query):
			rank, field, match = 1, "name", row.SymbolicName
		case strings.Contains(name, query):
			rank, field, match = 2, "name", row.SymbolicName
		case strings.Contains(strings.ToLower(row.Activator), query) && row.Activator != "":
			rank, field, match = 3, "activator", row.Activator
		case containsAny(row.ExportedPackages, query):
			rank, field, match = 4, "exported package", matchIn(row.ExportedPackages, query)
		case containsAny(row.RequiredBundles, query):
			rank, field, match = 5, "required bundle", matchIn(row.RequiredBundles, query)
		case containsAny(row.ImportedPackages, query):
			rank, field, match = 6, "imported package", matchIn(row.ImportedPackages, query)
		case strings.Contains(strings.ToLower(row.Vendor), query):
			rank, field, match = 7, "vendor", row.Vendor
		case strings.Contains(row.searchText, query):
			rank, field, match = 8, "manifest", snippetOf(row.searchText, query)
		}
		if rank < 0 {
			continue
		}
		if row.Source == string(SourceTarget) {
			rank += 10
		}
		hits = append(hits, SearchHit{SymbolicName: row.SymbolicName, Version: row.Version, Source: row.Source, State: row.State, Field: field, Match: match, Rank: rank})
	}
	sort.SliceStable(hits, func(i, j int) bool {
		if hits[i].Rank != hits[j].Rank {
			return hits[i].Rank < hits[j].Rank
		}
		if hits[i].SymbolicName != hits[j].SymbolicName {
			return hits[i].SymbolicName < hits[j].SymbolicName
		}
		return hits[i].Version < hits[j].Version
	})
	if len(hits) > limit {
		hits = hits[:limit]
	}
	return hits
}

func containsAny(values []string, query string) bool {
	for _, value := range values {
		if strings.Contains(strings.ToLower(value), query) {
			return true
		}
	}
	return false
}

func matchIn(values []string, query string) string {
	for _, value := range values {
		if strings.Contains(strings.ToLower(value), query) {
			return value
		}
	}
	return ""
}

// snippetOf shows the haystack around the match, so "manifest" hits are readable.
func snippetOf(haystack, query string) string {
	index := strings.Index(haystack, query)
	if index < 0 {
		return query
	}
	start := max(0, index-30)
	end := min(len(haystack), index+len(query)+30)
	snippet := strings.TrimSpace(haystack[start:end])
	return snippet
}
