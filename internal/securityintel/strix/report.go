package strix

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Finding è un problema trovato da Strix, ricavato dal file SARIF della run.
type Finding struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Severity string `json:"severity"` // critical, high, medium, low, info
	Message  string `json:"message,omitempty"`
	File     string `json:"file,omitempty"`
	Line     int    `json:"line,omitempty"`
}

// Report è ciò che Strix ha scritto in `strix_runs/<nome>/`.
type Report struct {
	RunName  string    `json:"runName"`
	Markdown string    `json:"markdown"`
	Findings []Finding `json:"findings"`
	// Details sono i file `vulnerabilities/*.md`, uno per problema, con PoC e correzione.
	Details []Detail `json:"details"`
	// Status e CostUSD vengono da run.json; vuoti se Strix non l'ha scritto.
	Status  string  `json:"status,omitempty"`
	CostUSD float64 `json:"costUsd,omitempty"`
}

// Detail è la pagina di un singolo problema.
type Detail struct {
	Name     string `json:"name"`
	Markdown string `json:"markdown"`
}

const (
	maxReportBytes = 4 << 20
	maxDetailFiles = 200
)

// LoadReport legge gli artefatti dell'ultima run dentro runDir (la cartella di lavoro di Strix).
func LoadReport(runDir string) (Report, error) {
	base := filepath.Join(runDir, "strix_runs")
	entries, err := os.ReadDir(base)
	if err != nil {
		return Report{}, fmt.Errorf("Strix did not write any results: %w", err)
	}
	latest := ""
	var latestTime int64
	for _, entry := range entries {
		info, err := entry.Info()
		if err == nil && entry.IsDir() && info.ModTime().UnixNano() >= latestTime {
			latest, latestTime = entry.Name(), info.ModTime().UnixNano()
		}
	}
	if latest == "" {
		return Report{}, fmt.Errorf("Strix did not write any results")
	}
	dir := filepath.Join(base, latest)
	report := Report{RunName: latest, Markdown: readLimited(filepath.Join(dir, "penetration_test_report.md"))}
	report.Findings = readSARIF(filepath.Join(dir, "findings.sarif"))
	report.Details = readDetails(filepath.Join(dir, "vulnerabilities"))
	report.Status, report.CostUSD = readRunInfo(filepath.Join(dir, "run.json"))
	return report, nil
}

func readLimited(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	if len(data) > maxReportBytes {
		data = data[:maxReportBytes]
	}
	return string(data)
}

func readDetails(dir string) []Detail {
	matches, _ := filepath.Glob(filepath.Join(dir, "*.md"))
	sort.Strings(matches)
	if len(matches) > maxDetailFiles {
		matches = matches[:maxDetailFiles]
	}
	details := make([]Detail, 0, len(matches))
	for _, path := range matches {
		details = append(details, Detail{Name: strings.TrimSuffix(filepath.Base(path), ".md"), Markdown: readLimited(path)})
	}
	return details
}

// readRunInfo legge status e costo da run.json senza dipendere dallo schema esatto: chiavi mancanti restano vuote.
func readRunInfo(path string) (string, float64) {
	var run struct {
		Status   string `json:"status"`
		LLMUsage struct {
			Cost float64 `json:"cost"`
		} `json:"llm_usage"`
	}
	if data, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(data, &run)
	}
	return run.Status, run.LLMUsage.Cost
}

type sarifLog struct {
	Runs []struct {
		Tool struct {
			Driver struct {
				Rules []struct {
					ID               string `json:"id"`
					Name             string `json:"name"`
					ShortDescription struct {
						Text string `json:"text"`
					} `json:"shortDescription"`
					Properties struct {
						Severity string `json:"security-severity"`
					} `json:"properties"`
				} `json:"rules"`
			} `json:"driver"`
		} `json:"tool"`
		Results []struct {
			RuleID  string `json:"ruleId"`
			Level   string `json:"level"`
			Message struct {
				Text string `json:"text"`
			} `json:"message"`
			Locations []struct {
				PhysicalLocation struct {
					ArtifactLocation struct {
						URI string `json:"uri"`
					} `json:"artifactLocation"`
					Region struct {
						StartLine int `json:"startLine"`
					} `json:"region"`
				} `json:"physicalLocation"`
			} `json:"locations"`
		} `json:"results"`
	} `json:"runs"`
}

func readSARIF(path string) []Finding {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var log sarifLog
	if json.Unmarshal(data, &log) != nil {
		return nil
	}
	var findings []Finding
	for _, run := range log.Runs {
		titles := map[string]string{}
		scores := map[string]string{}
		for _, rule := range run.Tool.Driver.Rules {
			title := rule.ShortDescription.Text
			if title == "" {
				title = rule.Name
			}
			titles[rule.ID], scores[rule.ID] = title, rule.Properties.Severity
		}
		for _, result := range run.Results {
			finding := Finding{ID: result.RuleID, Title: titles[result.RuleID], Message: result.Message.Text, Severity: severityOf(result.Level, scores[result.RuleID])}
			if finding.Title == "" {
				finding.Title = result.RuleID
			}
			if len(result.Locations) > 0 {
				location := result.Locations[0].PhysicalLocation
				finding.File, finding.Line = location.ArtifactLocation.URI, location.Region.StartLine
			}
			findings = append(findings, finding)
		}
	}
	rank := map[string]int{"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
	sort.SliceStable(findings, func(i, j int) bool { return rank[findings[i].Severity] < rank[findings[j].Severity] })
	return findings
}

// severityOf preferisce il punteggio numerico di SARIF (security-severity, scala CVSS) al livello grossolano.
func severityOf(level, score string) string {
	var value float64
	if _, err := fmt.Sscanf(score, "%f", &value); err == nil && score != "" {
		switch {
		case value >= 9:
			return "critical"
		case value >= 7:
			return "high"
		case value >= 4:
			return "medium"
		case value > 0:
			return "low"
		}
	}
	switch level {
	case "error":
		return "high"
	case "warning":
		return "medium"
	case "note":
		return "low"
	}
	return "info"
}

// ExportMarkdown compone il report esportabile: quello di Strix, poi una pagina per ogni problema.
// Se Strix non ha scritto il report ma ci sono i dettagli, si parte da un riepilogo dei problemi.
func (r Report) ExportMarkdown(project string) string {
	var out strings.Builder
	fmt.Fprintf(&out, "# Strix security assessment\n\n- **Project:** %s\n- **Run:** %s\n", project, r.RunName)
	if r.Status != "" {
		fmt.Fprintf(&out, "- **Status:** %s\n", r.Status)
	}
	if r.CostUSD > 0 {
		fmt.Fprintf(&out, "- **LLM cost:** $%.2f\n", r.CostUSD)
	}
	fmt.Fprintf(&out, "- **Findings:** %d\n\n", len(r.Findings))
	if len(r.Findings) > 0 {
		out.WriteString("## Summary\n\n| Severity | Finding | Location |\n| --- | --- | --- |\n")
		for _, f := range r.Findings {
			location := f.File
			if f.Line > 0 {
				location = fmt.Sprintf("%s:%d", f.File, f.Line)
			}
			fmt.Fprintf(&out, "| %s | %s | %s |\n", f.Severity, strings.ReplaceAll(f.Title, "|", "\\|"), strings.ReplaceAll(location, "|", "\\|"))
		}
		out.WriteString("\n")
	}
	if strings.TrimSpace(r.Markdown) != "" {
		out.WriteString("## Report\n\n" + strings.TrimSpace(r.Markdown) + "\n\n")
	}
	for _, detail := range r.Details {
		out.WriteString("---\n\n" + strings.TrimSpace(detail.Markdown) + "\n\n")
	}
	return out.String()
}
