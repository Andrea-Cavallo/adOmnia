package auditskill

import (
	"encoding/json/v2"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/aipolicy"
)

// Le run stanno dove la skill le mette di default (~/security-audit-skill/<repo>/run-<N>): le run
// lanciate da adOmnia e quelle lanciate dal terminale si sommano, come la skill prevede.

var (
	unsafeName = regexp.MustCompile(`[^A-Za-z0-9._-]+`)
	runPattern = regexp.MustCompile(`^run-([0-9]+)$`)
	profiles   = map[string]bool{"quick": true, "standard": true, "deep": true}
)

// Run è una cartella di risultati.
type Run struct {
	Number      int    `json:"number"`
	Dir         string `json:"dir"`
	Status      string `json:"status,omitempty"`
	Profile     string `json:"profile,omitempty"`
	HasFindings bool   `json:"hasFindings"`
	HasReport   bool   `json:"hasReport"`
}

// Prepared è ciò che serve per avviare l'audit come Agent Task.
type Prepared struct {
	Run    Run    `json:"run"`
	Prompt string `json:"prompt"`
}

// Finding è il riassunto di un record di findings.json per la tabella del Security Center.
type Finding struct {
	Verdict     string `json:"verdict"`
	Fingerprint string `json:"fingerprint"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Severity    string `json:"severity,omitempty"`
	Confidence  string `json:"confidence,omitempty"`
	File        string `json:"file,omitempty"`
	Line        int    `json:"line,omitempty"`
	Remediation string `json:"remediation,omitempty"`
	// Blockers: per needs_validation, il fatto che manca; per rejected, il motivo.
	Blockers []string `json:"blockers,omitempty"`
}

// Report sono i risultati di una run; Missing elenca i file attesi e non ancora scritti.
type Report struct {
	Run      Run       `json:"run"`
	Findings []Finding `json:"findings"`
	Markdown string    `json:"markdown,omitempty"`
	Missing  []string  `json:"missing,omitempty"`
}

// OutputRoot è ~/security-audit-skill/<nome del progetto>.
func OutputRoot(root string) (string, error) {
	root = strings.TrimSpace(root)
	if root == "" || !filepath.IsAbs(root) {
		return "", errors.New("select an absolute project folder")
	}
	name := strings.Trim(unsafeName.ReplaceAllString(filepath.Base(filepath.Clean(root)), "-"), ".-")
	if name == "" {
		return "", fmt.Errorf("cannot derive a project name from %s", root)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("cannot find the home folder: %w", err)
	}
	return filepath.Join(home, "security-audit-skill", name), nil
}

// Runs elenca le run del progetto, la più recente per prima.
func Runs(root string) ([]Run, error) {
	base, err := OutputRoot(root)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(base)
	if errors.Is(err, os.ErrNotExist) {
		return []Run{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("cannot read %s: %w", base, err)
	}
	runs := []Run{}
	for _, entry := range entries {
		if match := runPattern.FindStringSubmatch(entry.Name()); entry.IsDir() && match != nil {
			number, _ := strconv.Atoi(match[1]) // la regexp garantisce solo cifre
			runs = append(runs, describeRun(filepath.Join(base, entry.Name()), number))
		}
	}
	slices.SortFunc(runs, func(a, b Run) int { return b.Number - a.Number })
	return runs, nil
}

func describeRun(dir string, number int) Run {
	run := Run{Number: number, Dir: dir, HasFindings: exists(filepath.Join(dir, "findings.json")), HasReport: exists(filepath.Join(dir, "REPORT.md"))}
	if data, err := os.ReadFile(filepath.Join(dir, "run-metadata.json")); err == nil {
		var metadata struct {
			Status  string `json:"run_status"`
			Profile string `json:"profile"`
		}
		if json.Unmarshal(data, &metadata) == nil {
			run.Status, run.Profile = metadata.Status, metadata.Profile
		}
	}
	return run
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// Prepare sceglie la prossima run e scrive il prompt; la cartella la crea l'agente, come chiede la skill.
func Prepare(root, profile, focus string) (Prepared, error) {
	if !profiles[profile] {
		return Prepared{}, fmt.Errorf("unknown audit profile %q", profile)
	}
	status, err := Detect()
	if err != nil {
		return Prepared{}, err
	}
	if !status.Installed {
		return Prepared{}, errors.New("install the security-audit skill first")
	}
	runs, err := Runs(root)
	if err != nil {
		return Prepared{}, err
	}
	// Lo stesso controllo lo fa l'host ACP all'invio; qui l'errore arriva prima di creare il task.
	if !aipolicy.Allows(aipolicy.Load(root), false) {
		return Prepared{}, fmt.Errorf("the project AI policy (%s) does not allow sending code to a coding agent", aipolicy.File)
	}
	base, _ := OutputRoot(root) // già validata da Runs
	number := 1
	if len(runs) > 0 {
		number = runs[0].Number + 1
	}
	run := Run{Number: number, Dir: filepath.Join(base, fmt.Sprintf("run-%d", number)), Profile: profile}
	return Prepared{Run: run, Prompt: prompt(status.SkillFile, filepath.Clean(root), run, base, len(runs) > 0, strings.TrimSpace(focus))}, nil
}

func prompt(skillFile, root string, run Run, base string, priorRuns bool, focus string) string {
	var text strings.Builder
	fmt.Fprintf(&text, "Use the security-audit skill. Read %s first and follow it exactly.\n\n", skillFile)
	fmt.Fprintf(&text, "Security audit this codebase: run the complete workflow in full audit mode.\n\n")
	fmt.Fprintf(&text, "- Target: %s\n- Profile: %s\n- Output directory: %s (create it; it is outside the repository)\n", root, run.Profile, run.Dir)
	if priorRuns {
		fmt.Fprintf(&text, "- Prior runs: %s (read their ledgers and findings as the skill describes)\n", base)
	}
	if focus != "" {
		fmt.Fprintf(&text, "- Prioritise: %s (this orders the work; it does not make the run scoped)\n", focus)
	}
	text.WriteString("\nDo not install dependencies. Run target code only inside the OS-enforced sandbox the skill requires; without it, keep those leads as needs_validation. ")
	text.WriteString("Finish with findings.json validated by validate-findings.cjs and REPORT.md in the output directory.")
	return text.String()
}

// ReadReport legge una run del progetto indicata per numero: il percorso non arriva mai dal frontend.
func ReadReport(root string, number int) (Report, error) {
	base, err := OutputRoot(root)
	if err != nil {
		return Report{}, err
	}
	if number < 1 {
		return Report{}, errors.New("invalid run number")
	}
	run := describeRun(filepath.Join(base, fmt.Sprintf("run-%d", number)), number)
	report := Report{Run: run, Findings: []Finding{}}
	if data, err := os.ReadFile(filepath.Join(run.Dir, "REPORT.md")); err == nil {
		report.Markdown = string(data)
	} else {
		report.Missing = append(report.Missing, "REPORT.md")
	}
	data, err := os.ReadFile(filepath.Join(run.Dir, "findings.json"))
	if errors.Is(err, os.ErrNotExist) {
		report.Missing = append(report.Missing, "findings.json")
		return report, nil
	}
	if err != nil {
		return Report{}, fmt.Errorf("cannot read findings.json: %w", err)
	}
	if report.Findings, err = parseFindings(data); err != nil {
		return Report{}, err
	}
	return report, nil
}

type record struct {
	Verdict          string `json:"verdict"`
	Fingerprint      string `json:"fingerprint"`
	Title            string `json:"title"`
	Description      string `json:"description"`
	ClaimedRootCause string `json:"claimed_root_cause"`
	Trace            []struct {
		Kind string `json:"kind"`
		File string `json:"file"`
		Line int    `json:"line"`
	} `json:"trace"`
	Severity struct {
		Overall string `json:"overall_severity"`
	} `json:"severity"`
	Confidence struct {
		Score string `json:"score"`
	} `json:"confidence"`
	Remediation struct {
		Strategy string `json:"strategy"`
	} `json:"remediation"`
	Blockers []string `json:"blockers"`
	Reason   string   `json:"reason"`
}

// parseFindings legge solo i campi mostrati; la validazione completa resta allo script della skill.
func parseFindings(data []byte) ([]Finding, error) {
	var records []record
	if err := json.Unmarshal(data, &records); err != nil {
		return nil, fmt.Errorf("findings.json is not a valid findings list: %w", err)
	}
	findings := make([]Finding, 0, len(records))
	for _, item := range records {
		finding := Finding{
			Verdict: item.Verdict, Fingerprint: item.Fingerprint, Title: item.Title, Description: item.Description,
			Severity: item.Severity.Overall, Confidence: item.Confidence.Score, Remediation: item.Remediation.Strategy,
		}
		// La riga più utile è il sink; altrimenti il primo passo della traccia.
		for index, step := range item.Trace {
			if index == 0 || step.Kind == "sink" {
				finding.File, finding.Line = step.File, step.Line
			}
		}
		finding.Blockers = item.Blockers
		if item.Reason != "" {
			finding.Blockers = append(finding.Blockers, item.Reason)
		}
		findings = append(findings, finding)
	}
	return findings, nil
}
