// Package acceptance stores executable acceptance scenarios in the project, one JSON
// file per scenario under .adomnia/acceptance (see docs/architecture/adr-0001-acceptance-scenarios.md).
package acceptance

import (
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/fileio"
)

const (
	// Format and Version identify the file; loaders migrate older versions.
	Format  = "adomnia-acceptance"
	Version = 1
	// Dir is the scenario folder, relative to the project root.
	Dir = ".adomnia/acceptance"

	maxScenarios   = 500
	maxFileBytes   = 256 * 1024
	maxCriteria    = 50
	maxTextLength  = 8 * 1024
	maxLinksPerSet = 50
)

// Status is where a scenario stands as a requirement.
type Status string

const (
	StatusDraft   Status = "draft"
	StatusActive  Status = "active"
	StatusRetired Status = "retired"
)

// Check is the executable verification of a criterion. Its fields are those of an
// Agent Task verification, so a scenario run from a task produces the same evidence.
type Check struct {
	Kind           string            `json:"kind"`
	Label          string            `json:"label,omitempty"`
	Language       string            `json:"language,omitempty"`
	Packages       []string          `json:"packages,omitempty"`
	Run            string            `json:"run,omitempty"`
	Method         string            `json:"method,omitempty"`
	URL            string            `json:"url,omitempty"`
	Headers        map[string]string `json:"headers,omitempty"`
	Body           string            `json:"body,omitempty"`
	ExpectedStatus int               `json:"expectedStatus,omitempty"`
	TimeoutSeconds int               `json:"timeoutSeconds,omitempty"`
}

// Criterion is one acceptance criterion; Check is optional (a criterion can be prose only).
type Criterion struct {
	ID    string `json:"id"`
	Text  string `json:"text"`
	Check *Check `json:"check,omitempty"`
}

// Scenario is a requirement written once and used as agent context, as an adOmnia
// verification and as versioned documentation.
type Scenario struct {
	Format      string `json:"format"`
	Version     int    `json:"version"`
	ID          string `json:"id"`
	Title       string `json:"title"`
	Status      Status `json:"status"`
	Description string `json:"description,omitempty"`
	// Routes are explicit links to HTTP routes, written "METHOD /path".
	Routes []string `json:"routes,omitempty"`
	// Files are explicit links to project files, relative with forward slashes.
	Files    []string    `json:"files,omitempty"`
	Criteria []Criterion `json:"criteria"`
	// File is the scenario's path relative to the project (set by Load, not saved).
	File string `json:"file,omitempty"`
}

// LoadResult lists the scenarios of a project and the files that could not be read:
// one broken file never hides the others.
type LoadResult struct {
	Scenarios []Scenario `json:"scenarios"`
	Problems  []string   `json:"problems"`
}

var idPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)

// Load reads every scenario of the project, sorted by ID.
func Load(root string) (LoadResult, error) {
	result := LoadResult{Scenarios: []Scenario{}, Problems: []string{}}
	dir, err := scenarioDir(root)
	if err != nil {
		return result, err
	}
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return result, nil
	}
	if err != nil {
		return result, fmt.Errorf("read the acceptance scenarios: %w", err)
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.EqualFold(filepath.Ext(entry.Name()), ".json") {
			continue
		}
		if len(result.Scenarios) >= maxScenarios {
			result.Problems = append(result.Problems, fmt.Sprintf("more than %d scenarios: the others were not read", maxScenarios))
			break
		}
		relative := Dir + "/" + entry.Name()
		scenario, err := readScenario(filepath.Join(dir, entry.Name()))
		if err != nil {
			result.Problems = append(result.Problems, fmt.Sprintf("%s: %v", relative, err))
			continue
		}
		scenario.File = relative
		result.Scenarios = append(result.Scenarios, scenario)
	}
	slices.SortFunc(result.Scenarios, func(left, right Scenario) int { return strings.Compare(left.ID, right.ID) })
	return result, nil
}

func readScenario(path string) (Scenario, error) {
	info, err := os.Stat(path)
	if err != nil {
		return Scenario{}, err
	}
	if info.Size() > maxFileBytes {
		return Scenario{}, errors.New("the file is larger than 256 KiB")
	}
	data, err := os.ReadFile(path) // #nosec G304 -- file inside the project's acceptance folder
	if err != nil {
		return Scenario{}, err
	}
	var scenario Scenario
	if err := json.Unmarshal(data, &scenario); err != nil {
		return Scenario{}, fmt.Errorf("not a valid scenario: %w", err)
	}
	if scenario.Format != Format {
		return Scenario{}, fmt.Errorf("format %q is not %q", scenario.Format, Format)
	}
	return Normalize(scenario)
}

// Normalize validates a scenario and fills defaults; it is what Save writes.
func Normalize(scenario Scenario) (Scenario, error) {
	scenario.Format, scenario.File = Format, ""
	if scenario.Version == 0 || scenario.Version > Version {
		// Versioni future non note: si legge con lo schema attuale, il loader migrerà quando servirà.
		scenario.Version = Version
	}
	scenario.ID = strings.TrimSpace(scenario.ID)
	if !idPattern.MatchString(scenario.ID) {
		return Scenario{}, errors.New("the ID must be 1–64 letters, digits, dots, dashes or underscores")
	}
	scenario.Title = strings.TrimSpace(scenario.Title)
	if scenario.Title == "" {
		return Scenario{}, errors.New("a scenario needs a title")
	}
	switch scenario.Status {
	case "":
		scenario.Status = StatusDraft
	case StatusDraft, StatusActive, StatusRetired:
	default:
		return Scenario{}, fmt.Errorf("status must be draft, active or retired, not %q", scenario.Status)
	}
	if len(scenario.Description) > maxTextLength {
		return Scenario{}, errors.New("the description is longer than 8 KiB")
	}
	var err error
	if scenario.Routes, err = cleanLinks(scenario.Routes, normalizeRoute); err != nil {
		return Scenario{}, err
	}
	if scenario.Files, err = cleanLinks(scenario.Files, normalizeFile); err != nil {
		return Scenario{}, err
	}
	if len(scenario.Criteria) > maxCriteria {
		return Scenario{}, fmt.Errorf("a scenario can have at most %d criteria", maxCriteria)
	}
	seen := map[string]bool{}
	for index := range scenario.Criteria {
		criterion := &scenario.Criteria[index]
		criterion.ID = strings.TrimSpace(criterion.ID)
		if criterion.ID == "" {
			criterion.ID = fmt.Sprintf("c%d", index+1)
		}
		if seen[criterion.ID] || !idPattern.MatchString(criterion.ID) {
			return Scenario{}, fmt.Errorf("criterion %d needs a unique ID", index+1)
		}
		seen[criterion.ID] = true
		criterion.Text = strings.TrimSpace(criterion.Text)
		if criterion.Text == "" || len(criterion.Text) > maxTextLength {
			return Scenario{}, fmt.Errorf("criterion %s needs a text up to 8 KiB", criterion.ID)
		}
		if criterion.Check != nil && criterion.Check.Kind != "test" && criterion.Check.Kind != "request" {
			return Scenario{}, fmt.Errorf("criterion %s: a check is a test or a request", criterion.ID)
		}
	}
	return scenario, nil
}

func cleanLinks(values []string, normalize func(string) (string, error)) ([]string, error) {
	if len(values) > maxLinksPerSet {
		return nil, fmt.Errorf("at most %d links of each kind", maxLinksPerSet)
	}
	clean := []string{}
	for _, value := range values {
		normalized, err := normalize(value)
		if err != nil {
			return nil, err
		}
		if normalized != "" && !slices.Contains(clean, normalized) {
			clean = append(clean, normalized)
		}
	}
	return clean, nil
}

// normalizeRoute keeps "METHOD /path" with an upper-case method.
func normalizeRoute(value string) (string, error) {
	fields := strings.Fields(value)
	if len(fields) == 0 {
		return "", nil
	}
	if len(fields) != 2 || !strings.HasPrefix(fields[1], "/") {
		return "", fmt.Errorf("route %q must be written as \"METHOD /path\"", value)
	}
	return strings.ToUpper(fields[0]) + " " + fields[1], nil
}

func normalizeFile(value string) (string, error) {
	value = strings.TrimSpace(strings.ReplaceAll(value, "\\", "/"))
	if value == "" {
		return "", nil
	}
	cleaned := filepath.ToSlash(filepath.Clean(value))
	if filepath.IsAbs(value) || cleaned == ".." || strings.HasPrefix(cleaned, "../") || strings.Contains(cleaned, ":") {
		return "", fmt.Errorf("file %q must be relative to the project", value)
	}
	return cleaned, nil
}

// Save writes the scenario as pretty, stable JSON to .adomnia/acceptance/<id>.json.
func Save(root string, scenario Scenario) (Scenario, error) {
	normalized, err := Normalize(scenario)
	if err != nil {
		return Scenario{}, err
	}
	dir, err := scenarioDir(root)
	if err != nil {
		return Scenario{}, err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return Scenario{}, fmt.Errorf("create %s: %w", Dir, err)
	}
	data, err := json.Marshal(normalized, jsontext.WithIndent("  "))
	if err != nil {
		return Scenario{}, err
	}
	if err := fileio.AtomicWriteFile(filepath.Join(dir, normalized.ID+".json"), append(data, '\n'), 0o644); err != nil {
		return Scenario{}, fmt.Errorf("save the scenario: %w", err)
	}
	normalized.File = Dir + "/" + normalized.ID + ".json"
	return normalized, nil
}

func scenarioDir(root string) (string, error) {
	root = strings.TrimSpace(root)
	if root == "" || !filepath.IsAbs(root) {
		return "", errors.New("the project root must be an absolute path")
	}
	return filepath.Join(filepath.Clean(root), filepath.FromSlash(Dir)), nil
}

// Touched returns the IDs of the scenarios linked to a changed file. It only reads the
// explicit links: the documents are never modified.
func Touched(scenarios []Scenario, changedFiles []string) []string {
	changed := map[string]bool{}
	for _, file := range changedFiles {
		changed[filepath.ToSlash(filepath.Clean(file))] = true
	}
	touched := []string{}
	for _, scenario := range scenarios {
		for _, file := range scenario.Files {
			if changed[file] {
				touched = append(touched, scenario.ID)
				break
			}
		}
	}
	return touched
}
