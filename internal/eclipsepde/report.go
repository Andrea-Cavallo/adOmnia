package eclipsepde

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// targetProfileName is the profile written by SetTarget: the UI manages one
// target per project, the settings format keeps room for more.
const targetProfileName = "Target platform"

// WorkspaceReport is what the OSGi panel shows: the bundles of the opened folder,
// the active target platform and why each bundle does or does not resolve.
type WorkspaceReport struct {
	Root          string `json:"root"`
	HasTarget     bool   `json:"hasTarget"`
	TargetPath    string `json:"targetPath"`
	TargetBundles int    `json:"targetBundles"`
	Unresolved    int    `json:"unresolved"`
	// OtherProjects counts Eclipse projects that are not OSGi bundles (e.g. bnd).
	OtherProjects int            `json:"otherProjects"`
	Bundles       []BundleStatus `json:"bundles"`
	Problems      []Problem      `json:"problems"`
}

// BundleStatus is one workspace bundle. Status is empty until a target is set.
type BundleStatus struct {
	SymbolicName         string              `json:"symbolicName"`
	Version              string              `json:"version"`
	Location             string              `json:"location"`
	ExecutionEnvironment string              `json:"executionEnvironment"`
	Status               ResolutionStatus    `json:"status"`
	Missing              []MissingDependency `json:"missing"`
	Notes                []string            `json:"notes"`
}

// MissingDependency explains one requirement that the target cannot satisfy.
type MissingDependency struct {
	Kind      string   `json:"kind"`
	Name      string   `json:"name"`
	Range     string   `json:"range"`
	Optional  bool     `json:"optional"`
	Available []string `json:"available"`
	Actions   []string `json:"actions"`
}

// BuildReport imports the folder and resolves its bundles against the target
// stored in `.adomnia/eclipse-target.json`. It only reads files.
func BuildReport(root string) (*WorkspaceReport, error) {
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

	report := &WorkspaceReport{
		Root:          ws.Root,
		OtherProjects: len(ws.Projects) - len(ws.Bundles()),
		Bundles:       []BundleStatus{},
		Problems:      relativeProblems(ws.AllProblems(), ws.Root),
	}
	resolutions := map[string]*BundleResolution{}
	if profile, ok := platform.ActiveProfile(); ok {
		report.HasTarget, report.TargetPath = true, profile.Path
		result, err := platform.Validate(ws)
		if err != nil {
			return nil, err
		}
		report.TargetBundles, report.Unresolved = result.BundlesIndexed, result.Unresolved
		for _, problem := range relativeProblems(result.Problems, ws.Root) {
			// Problems with a project repeat what Bundles already explains per bundle.
			if problem.Project == "" {
				report.Problems = append(report.Problems, problem)
			}
		}
		for _, resolution := range result.Bundles {
			resolutions[labelOf(resolution.Bundle)] = resolution
		}
	}
	for _, project := range ws.Bundles() {
		report.Bundles = append(report.Bundles, bundleStatus(project, ws.Root, resolutions))
	}
	return report, nil
}

// SetTarget makes path (a folder of bundles, an Eclipse install or a `.target`
// file) the active target of the project and returns the updated report.
func SetTarget(root, path string) (*WorkspaceReport, error) {
	kind, err := targetKindOf(path)
	if err != nil {
		return nil, err
	}
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	settings, err := LoadTargetSettings(absRoot)
	if err != nil {
		return nil, err
	}
	profile := TargetProfile{Name: targetProfileName, Kind: kind, Path: storedPath(absRoot, path)}
	profiles := []TargetProfile{profile}
	for _, existing := range settings.Profiles {
		if existing.Name == targetProfileName {
			profiles[0].ExecutionEnvironment = existing.ExecutionEnvironment
			continue
		}
		profiles = append(profiles, existing)
	}
	settings.Profiles, settings.Active = profiles, targetProfileName
	if err := SaveTargetSettings(absRoot, settings); err != nil {
		return nil, err
	}
	return BuildReport(absRoot)
}

func targetKindOf(path string) (TargetSourceKind, error) {
	info, err := os.Stat(path)
	if err != nil {
		return "", fmt.Errorf("target platform not found: %s", path)
	}
	if info.IsDir() {
		return TargetLocalDirectory, nil
	}
	if !strings.EqualFold(filepath.Ext(path), ".target") {
		return "", fmt.Errorf("the target platform must be a folder of bundles or a .target file: %s", path)
	}
	if _, err := ReadTargetDefinition(path); err != nil {
		return "", err
	}
	return TargetEclipseDefinition, nil
}

// storedPath keeps paths inside the project relative, so the settings can be shared through Git.
func storedPath(root, path string) string {
	abs, err := filepath.Abs(path)
	if err != nil {
		return path
	}
	if rel, ok := relativeWithin(root, abs); ok {
		return rel
	}
	return abs
}

func relativeWithin(root, path string) (string, bool) {
	rel, err := filepath.Rel(root, path)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", false
	}
	return filepath.ToSlash(rel), true
}

func absoluteProfiles(settings TargetSettings, root string) TargetSettings {
	profiles := make([]TargetProfile, 0, len(settings.Profiles))
	for _, profile := range settings.Profiles {
		if !filepath.IsAbs(profile.Path) {
			profile.Path = filepath.Join(root, filepath.FromSlash(profile.Path))
		}
		profiles = append(profiles, profile)
	}
	settings.Profiles = profiles
	return settings
}

func relativeProblems(problems []Problem, root string) []Problem {
	out := make([]Problem, 0, len(problems))
	for _, problem := range problems {
		if filepath.IsAbs(problem.File) {
			if rel, ok := relativeWithin(root, problem.File); ok {
				problem.File = rel
			}
		}
		out = append(out, problem)
	}
	return out
}

func bundleStatus(project *EclipseProject, root string, resolutions map[string]*BundleResolution) BundleStatus {
	status := BundleStatus{
		SymbolicName:         project.Bundle.SymbolicName,
		Version:              project.Bundle.Version.String(),
		Location:             project.Dir,
		ExecutionEnvironment: project.Bundle.ExecutionEnvironment,
		Missing:              []MissingDependency{},
		Notes:                []string{},
	}
	if rel, ok := relativeWithin(root, project.Dir); ok {
		status.Location = rel
	}
	resolution, ok := resolutions[labelOf(&IndexedBundle{Bundle: project.Bundle})]
	if !ok {
		return status
	}
	status.Status = resolution.Status
	status.Notes = append(status.Notes, resolution.Notes...)
	for _, missing := range resolution.Missing {
		status.Missing = append(status.Missing, missingDependency(missing))
	}
	return status
}

func missingDependency(missing MissingRequirement) MissingDependency {
	dependency := MissingDependency{
		Kind:      missing.Requirement.Kind,
		Name:      missing.Requirement.Name,
		Optional:  missing.Requirement.Optional,
		Available: append([]string{}, missing.Available...),
		Actions:   append([]string{}, missing.Actions...),
	}
	if missing.Requirement.RangeOK {
		dependency.Range = missing.Requirement.Range.String()
	}
	return dependency
}
