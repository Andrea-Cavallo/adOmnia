// Package security è lo scanner di sicurezza statico del core IDE: indipendente dal linguaggio,
// raccoglie i finding degli Analyzer (segreti nei file, regole del linguaggio fornite dagli adapter),
// applica soppressioni motivate e baseline versionabili in .adomnia/security.json.
package security

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Severità dei finding: high = sfruttabile così com'è, medium = rischioso nel contesto giusto, low = igiene.
const (
	SeverityHigh   = "high"
	SeverityMedium = "medium"
	SeverityLow    = "low"
)

const (
	maxScanFileBytes = 1 << 20
	maxSnippetRunes  = 200
	maxFindings      = 5000
)

// Rule descrive una regola: cosa cerca, perché è un rischio e come si corregge.
type Rule struct {
	ID          string `json:"id"`
	Category    string `json:"category"`
	Severity    string `json:"severity"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Remediation string `json:"remediation"`
}

// Finding è un problema trovato in un file del progetto.
type Finding struct {
	Rule     string `json:"rule"`
	Category string `json:"category"`
	Severity string `json:"severity"`
	Title    string `json:"title"`
	Message  string `json:"message"`
	// File è relativo alla radice del progetto, con "/".
	File   string `json:"file"`
	Line   int    `json:"line"`
	Column int    `json:"column,omitempty"`
	// Snippet è la riga di codice, con eventuali segreti mascherati.
	Snippet     string `json:"snippet,omitempty"`
	Fingerprint string `json:"fingerprint"`
	// Suppressed: soppresso da un commento nel codice o dal pannello, sempre con motivazione.
	Suppressed        bool   `json:"suppressed,omitempty"`
	SuppressionReason string `json:"suppressionReason,omitempty"`
	SuppressedInline  bool   `json:"suppressedInline,omitempty"`
	// Baselined: era già presente quando è stata salvata la baseline.
	Baselined bool `json:"baselined,omitempty"`
}

// Analyzer trova problemi in un file. Accepts filtra per percorso (estensione, nome) prima di leggerlo.
type Analyzer interface {
	Rules() []Rule
	Accepts(relativePath string) bool
	Analyze(relativePath string, content []byte) []Finding
}

// Report è il risultato di una scansione.
type Report struct {
	Root         string    `json:"root"`
	FilesScanned int       `json:"filesScanned"`
	Findings     []Finding `json:"findings"`
	Rules        []Rule    `json:"rules"`
	Truncated    bool      `json:"truncated,omitempty"`
}

// skippedDirectories non contengono codice del progetto (dipendenze, build, VCS, cache).
var skippedDirectories = map[string]bool{
	".git": true, ".hg": true, ".svn": true, "node_modules": true, "vendor": true, "dist": true, "build": true,
	".idea": true, ".vscode": true, ".adomnia": true, "testdata": true, ".cache": true, "bin": true, "target": true,
}

// Scan percorre il progetto e applica gli analyzer a ogni file accettato, poi soppressioni e baseline.
func Scan(root string, analyzers ...Analyzer) (Report, error) {
	report := Report{Root: root, Findings: []Finding{}}
	seenRules := map[string]bool{}
	for _, analyzer := range analyzers {
		for _, rule := range analyzer.Rules() {
			if !seenRules[rule.ID] {
				seenRules[rule.ID] = true
				report.Rules = append(report.Rules, rule)
			}
		}
	}
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if entry.IsDir() {
			if path != root && (skippedDirectories[entry.Name()] || strings.HasPrefix(entry.Name(), ".") && entry.Name() != ".github") {
				return filepath.SkipDir
			}
			return nil
		}
		if !entry.Type().IsRegular() || len(report.Findings) >= maxFindings {
			return nil
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return nil
		}
		relative = filepath.ToSlash(relative)
		var interested []Analyzer
		for _, analyzer := range analyzers {
			if analyzer.Accepts(relative) {
				interested = append(interested, analyzer)
			}
		}
		if len(interested) == 0 {
			return nil
		}
		info, err := entry.Info()
		if err != nil || info.Size() > maxScanFileBytes {
			return nil
		}
		content, err := os.ReadFile(path)
		if err != nil || looksBinary(content) {
			return nil
		}
		report.FilesScanned++
		for _, analyzer := range interested {
			for _, finding := range analyzer.Analyze(relative, content) {
				report.Findings = append(report.Findings, completeFinding(finding, relative, content))
			}
		}
		return nil
	})
	if err != nil {
		return report, err
	}
	if len(report.Findings) >= maxFindings {
		report.Findings = report.Findings[:maxFindings]
		report.Truncated = true
	}
	settings, _ := LoadSettings(root)
	ApplySettings(report.Findings, settings)
	sortFindings(report.Findings)
	return report, nil
}

func looksBinary(content []byte) bool {
	sample := content
	if len(sample) > 8000 {
		sample = sample[:8000]
	}
	return bytes.IndexByte(sample, 0) >= 0
}

// completeFinding aggiunge file, riga di codice, impronta e soppressione inline.
func completeFinding(finding Finding, relative string, content []byte) Finding {
	finding.File = relative
	lines := strings.Split(string(content), "\n")
	line := ""
	if finding.Line >= 1 && finding.Line <= len(lines) {
		line = strings.TrimSpace(strings.TrimRight(lines[finding.Line-1], "\r"))
	}
	if finding.Snippet == "" {
		finding.Snippet = truncateRunes(line, maxSnippetRunes)
	}
	finding.Fingerprint = Fingerprint(finding.Rule, relative, line)
	if reason, ok := inlineSuppression(lines, finding.Line, finding.Rule); ok {
		finding.Suppressed = true
		finding.SuppressedInline = true
		finding.SuppressionReason = reason
	}
	return finding
}

// Fingerprint identifica un finding senza numero di riga: regola, file e codice della riga.
// Resta valido se il codice sopra si sposta, cambia se la riga incriminata cambia.
func Fingerprint(rule, file, line string) string {
	normalized := strings.Join(strings.Fields(line), " ")
	sum := sha256.Sum256([]byte(rule + "\x00" + file + "\x00" + normalized))
	return hex.EncodeToString(sum[:12])
}

// InlineMarker è il commento che sopprime un finding nel codice, sulla stessa riga o su quella sopra:
//
//	// adomnia:security-ignore go/weak-crypto: checksum only, not used for passwords
//
// La motivazione dopo i due punti è obbligatoria: senza, il finding resta visibile.
const InlineMarker = "adomnia:security-ignore"

func inlineSuppression(lines []string, line int, rule string) (string, bool) {
	for _, candidate := range []int{line, line - 1} {
		if candidate < 1 || candidate > len(lines) {
			continue
		}
		text := lines[candidate-1]
		index := strings.Index(text, InlineMarker)
		if index < 0 {
			continue
		}
		directive := strings.TrimSpace(text[index+len(InlineMarker):])
		rules, reason, found := strings.Cut(directive, ":")
		reason = strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(reason), "*/"))
		if !found || reason == "" {
			continue
		}
		for _, candidateRule := range strings.FieldsFunc(rules, func(r rune) bool { return r == ',' || r == ' ' }) {
			if candidateRule == rule || candidateRule == "all" {
				return reason, true
			}
		}
	}
	return "", false
}

func truncateRunes(text string, limit int) string {
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}
	return string(runes[:limit-1]) + "…"
}

var severityRank = map[string]int{SeverityHigh: 3, SeverityMedium: 2, SeverityLow: 1}

// SeverityRank serve a ordinare: high prima di medium prima di low.
func SeverityRank(severity string) int {
	return severityRank[severity]
}

func sortFindings(findings []Finding) {
	sort.SliceStable(findings, func(left, right int) bool {
		a, b := findings[left], findings[right]
		if SeverityRank(a.Severity) != SeverityRank(b.Severity) {
			return SeverityRank(a.Severity) > SeverityRank(b.Severity)
		}
		if a.File != b.File {
			return a.File < b.File
		}
		return a.Line < b.Line
	})
}
