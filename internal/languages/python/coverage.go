package python

import (
	"encoding/json/v2"
	"math"
	"path/filepath"
	"sort"
	"strings"

	idetesting "adomnia/internal/ide/testing"
)

const (
	// maxCoverageBytes limita il report letto dal file temporaneo.
	maxCoverageBytes = 16 << 20
	// maxCoverageFiles e maxCoverageLines limitano la vista su progetti molto grandi.
	maxCoverageFiles = 4000
	maxCoverageLines = 200000
)

// coverageReport è il sottoinsieme del report JSON di coverage.py che serve alla vista.
type coverageReport struct {
	Totals struct {
		PercentCovered float64 `json:"percent_covered"`
		CoveredLines   int     `json:"covered_lines"`
		NumStatements  int     `json:"num_statements"`
	} `json:"totals"`
	Files map[string]struct {
		ExecutedLines []int `json:"executed_lines"`
		MissingLines  []int `json:"missing_lines"`
		Summary       struct {
			CoveredLines   int     `json:"covered_lines"`
			NumStatements  int     `json:"num_statements"`
			PercentCovered float64 `json:"percent_covered"`
		} `json:"summary"`
	} `json:"files"`
}

// Coverage restituisce il report della run, se è stata chiesta la copertura e pytest-cov lo ha
// scritto. È chiamata una volta sola dal manager a fine processo; un file mancante o malformato
// non è un errore della run.
func (p *pytestParser) Coverage() *idetesting.CoverageReport {
	if p.coverageRead {
		return p.coverage
	}
	p.coverageRead = true
	if p.coveragePath == "" {
		return nil
	}
	data, err := readLimited(p.coveragePath, maxCoverageBytes)
	if err != nil {
		return nil
	}
	var report coverageReport
	if err := json.Unmarshal(data, &report); err != nil {
		return nil
	}
	converted := idetesting.CoverageReport{
		Mode:       "pytest-cov",
		Statements: report.Totals.NumStatements,
		Covered:    report.Totals.CoveredLines,
		Percent:    report.Totals.PercentCovered,
	}
	if converted.Statements == 0 {
		for _, file := range report.Files {
			converted.Statements += file.Summary.NumStatements
			converted.Covered += file.Summary.CoveredLines
		}
	}
	if converted.Percent == 0 && converted.Statements > 0 {
		converted.Percent = math.Round(float64(converted.Covered)/float64(converted.Statements)*1000) / 10
	}
	paths := make([]string, 0, len(report.Files))
	for path := range report.Files {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	for _, path := range paths {
		if len(converted.Files) >= maxCoverageFiles {
			break
		}
		entry := report.Files[path]
		file := idetesting.CoverageFile{
			Path:       coverageRelativePath(p.root, path),
			Statements: entry.Summary.NumStatements,
			Covered:    entry.Summary.CoveredLines,
			Percent:    math.Round(entry.Summary.PercentCovered*10) / 10,
		}
		file.Blocks = coverageBlocks(entry.ExecutedLines, entry.MissingLines)
		converted.Files = append(converted.Files, file)
	}
	p.coverage = &converted
	return p.coverage
}

// coverageBlocks traduce le righe eseguite e mancanti in blocchi di una riga: la copertura Python
// è a istruzioni, non a intervalli. Le righe duplicate (eseguite e mancanti) restano coperte.
func coverageBlocks(executed, missing []int) []idetesting.CoverageBlock {
	seen := make(map[int]bool, len(executed)+len(missing))
	blocks := make([]idetesting.CoverageBlock, 0, len(executed)+len(missing))
	add := func(line int, covered bool) {
		if line < 1 || len(blocks) >= maxCoverageLines || seen[line] {
			return
		}
		seen[line] = true
		blocks = append(blocks, idetesting.CoverageBlock{StartLine: line, StartColumn: 1, EndLine: line, EndColumn: 2, Covered: covered, Statements: 1})
	}
	for _, line := range executed {
		add(line, true)
	}
	for _, line := range missing {
		add(line, false)
	}
	sort.Slice(blocks, func(left, right int) bool { return blocks[left].StartLine < blocks[right].StartLine })
	return blocks
}

// coverageRelativePath porta il percorso del report alla forma relativa al progetto, in slash.
func coverageRelativePath(root, path string) string {
	cleaned := filepath.Clean(path)
	if filepath.IsAbs(cleaned) {
		if relative, err := filepath.Rel(root, cleaned); err == nil && !strings.HasPrefix(relative, "..") {
			return filepath.ToSlash(relative)
		}
	}
	return filepath.ToSlash(strings.TrimPrefix(filepath.ToSlash(cleaned), "./"))
}
