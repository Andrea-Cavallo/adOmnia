package goide

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

// La baseline SonarQube è versionabile con il progetto: chi clona vede solo i problemi nuovi,
// senza dover silenziare il debito preesistente sul server.

type sonarBaselineEntry struct {
	Rule    string `json:"rule"`
	File    string `json:"file"`
	Message string `json:"message"`
	Count   int    `json:"count"`
}

type sonarBaseline struct {
	Format  string               `json:"format"`
	Version int                  `json:"version"`
	Issues  []sonarBaselineEntry `json:"issues"`
}

func sonarBaselineKey(issue SonarIssue) sonarBaselineEntry {
	return sonarBaselineEntry{Rule: issue.Rule, File: issue.File, Message: issue.Message}
}

func writeSonarBaseline(root string, issues []SonarIssue) (int, error) {
	counts := map[sonarBaselineEntry]int{}
	for _, issue := range issues {
		counts[sonarBaselineKey(issue)]++
	}
	baseline := sonarBaseline{Format: sonarBaselineFmt, Version: sonarBaselineVrs, Issues: make([]sonarBaselineEntry, 0, len(counts))}
	for entry, count := range counts {
		entry.Count = count
		baseline.Issues = append(baseline.Issues, entry)
	}
	sort.Slice(baseline.Issues, func(i, j int) bool {
		a, b := baseline.Issues[i], baseline.Issues[j]
		if a.File != b.File {
			return a.File < b.File
		}
		if a.Rule != b.Rule {
			return a.Rule < b.Rule
		}
		return a.Message < b.Message
	})
	data, err := json.MarshalIndent(baseline, "", "  ")
	if err != nil {
		return 0, err
	}
	path := filepath.Join(root, filepath.FromSlash(sonarBaselineFile))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return 0, fmt.Errorf("cartella .adomnia non scrivibile: %w", err)
	}
	if err := atomicWriteFile(path, append(data, '\n'), 0o644); err != nil {
		return 0, err
	}
	return len(issues), nil
}

// applySonarBaseline nasconde gli issue già registrati; una baseline illeggibile non nasconde nulla.
func applySonarBaseline(root string, issues []SonarIssue) ([]SonarIssue, int) {
	data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(sonarBaselineFile)))
	if err != nil {
		return issues, 0
	}
	var baseline sonarBaseline
	if json.Unmarshal(data, &baseline) != nil {
		return issues, 0
	}
	remaining := map[sonarBaselineEntry]int{}
	for _, entry := range baseline.Issues {
		count := entry.Count
		entry.Count = 0
		remaining[entry] += max(count, 1)
	}
	kept := make([]SonarIssue, 0, len(issues))
	hidden := 0
	for _, issue := range issues {
		key := sonarBaselineKey(issue)
		if remaining[key] > 0 {
			remaining[key]--
			hidden++
			continue
		}
		kept = append(kept, issue)
	}
	return kept, hidden
}
