package eclipsepde

import (
	"fmt"
	"sort"
)

// BundleDetail is the right-hand panel of the OSGi Control Center: why this bundle is in
// the state it is, what uses it and what to check before changing it. It is one call so
// the panel never shows data from two different reads.
type BundleDetail struct {
	Row               BundleRow           `json:"row"`
	ManifestFile      string              `json:"manifestFile,omitempty"`
	Wires             []Wire              `json:"wires"`
	Missing           []MissingDependency `json:"missing"`
	Notes             []string            `json:"notes"`
	Diagnostics       []Diagnostic        `json:"diagnostics"`
	Activator         *ActivatorInfo      `json:"activator,omitempty"`
	ServiceComponents []ServiceComponent  `json:"serviceComponents"`
	Impact            *Impact             `json:"impact,omitempty"`
	Graph             *FocusGraph         `json:"graph,omitempty"`
	// Manifest is the main section of the manifest, for the "raw" view.
	Manifest map[string]string `json:"manifest"`
}

// Detail builds the detail panel of one bundle, with the dependency impact and the
// focused graph around it.
func (r *ExplorerReport) Detail(name string, depth int) (*BundleDetail, error) {
	entry, ok := r.findBundle(name)
	if !ok {
		return nil, fmt.Errorf("bundle %q is not in the workspace or in the active target platform", name)
	}
	row, ok := r.rowOf(entry)
	if !ok {
		return nil, fmt.Errorf("bundle %q has no explorer row", name)
	}
	detail := &BundleDetail{
		Row:               row,
		Wires:             []Wire{},
		Missing:           append([]MissingDependency{}, row.Missing...),
		Notes:             append([]string{}, row.Notes...),
		Diagnostics:       []Diagnostic{},
		ServiceComponents: []ServiceComponent{},
		Manifest:          map[string]string{},
	}
	for _, diagnostic := range r.Diagnostics {
		if diagnostic.Bundle == entry.Bundle.SymbolicName {
			detail.Diagnostics = append(detail.Diagnostics, diagnostic)
		}
	}
	for _, activator := range r.Activators {
		if activator.Bundle == entry.Bundle.SymbolicName {
			copy := activator
			detail.Activator = &copy
			break
		}
	}
	if entry.Source == SourceWorkspace {
		if proj := r.projectOf(entry.Bundle.SymbolicName); proj != nil {
			detail.ManifestFile = manifestPath(r.Root, proj)
			detail.Activator = activatorFor(proj, r.Root)
		}
	}
	if entry.Bundle.Manifest != nil {
		for header, value := range entry.Bundle.Manifest.Main {
			detail.Manifest[header] = value
		}
	}
	detail.ServiceComponents = ServiceComponents(entry.Bundle)

	if r.HasTarget {
		resolver := NewResolver(r.merged)
		resolver.ExecutionEnvironment = r.resolverEE
		resolution := resolver.Resolve(entry)
		detail.Wires = append([]Wire{}, resolution.Root.Wires...)
		for _, missing := range resolution.Root.Missing {
			detail.Missing = append(detail.Missing, missingDependency(missing))
		}
		detail.Missing = dedupeMissing(detail.Missing)
		detail.Notes = append(detail.Notes, resolution.Root.Notes...)
		sort.Strings(detail.Notes)
	}
	impact, err := r.AnalyzeImpact(entry.Bundle.SymbolicName)
	if err == nil {
		detail.Impact = impact
	}
	graph, err := r.FocusGraph(entry.Bundle.SymbolicName, depth)
	if err == nil {
		detail.Graph = graph
	}
	return detail, nil
}

// rowOf finds the explorer row of an index entry, preferring the workspace row.
func (r *ExplorerReport) rowOf(entry *IndexedBundle) (BundleRow, bool) {
	for _, row := range r.Bundles {
		if row.SymbolicName == entry.Bundle.SymbolicName && row.Source == string(entry.Source) && row.Version == entry.Bundle.Version.String() {
			return row, true
		}
	}
	for _, row := range r.Bundles {
		if row.SymbolicName == entry.Bundle.SymbolicName {
			return row, true
		}
	}
	return BundleRow{}, false
}

// projectOf returns the workspace project of a symbolic name.
func (r *ExplorerReport) projectOf(name string) *EclipseProject {
	for _, proj := range r.workspace.Projects {
		if proj.Bundle != nil && proj.Bundle.SymbolicName == name {
			return proj
		}
	}
	return nil
}

// activatorFor builds the activator info of one project, reusing the workspace pass when
// possible.
func activatorFor(proj *EclipseProject, root string) *ActivatorInfo {
	if proj.Bundle == nil || proj.Bundle.Activator == "" {
		return nil
	}
	info := ActivatorInfo{
		Bundle: proj.Bundle.SymbolicName, Version: proj.Bundle.Version.String(),
		Class: proj.Bundle.Activator, Policy: proj.Bundle.ActivationPolicy, Lazy: proj.Bundle.LazyActivation,
		Location: relativeOrAbsolute(root, proj.Dir),
	}
	if info.Policy == "" {
		info.Policy = "eager"
	}
	if source := activatorSource(proj, proj.Bundle.Activator); source != "" {
		info.File = relativeOrAbsolute(root, source)
		info.FileExists = true
		info.StartLine, info.StopLine = activatorLines(source)
	}
	return &info
}
