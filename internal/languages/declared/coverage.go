package declared

import (
	"encoding/json"
	"encoding/xml"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	idetesting "github.com/Andrea-Cavallo/adOmnia/internal/ide/testing"
)

// coverageCandidates are the standard files coverage tools write without a project-specific path.
// A declared row cannot force a tool to emit coverage, but when the project already does we read it.
var coverageCandidates = []string{
	"coverage/lcov.info", "lcov.info", "coverage/lcov/lcov.info",
	"coverage/.resultset.json",
	"coverage.xml", "cobertura.xml", "coverage/cobertura-coverage.xml", "coverage/coverage.xml",
	"target/scoverage-report/scoverage.xml", "target/test-reports/coverage.xml",
}

// scanProjectCoverage returns the first standard coverage report under root, or nil.
func scanProjectCoverage(root string) *idetesting.CoverageReport {
	if root == "" {
		return nil
	}
	for _, candidate := range coverageCandidates {
		path := filepath.Join(root, filepath.FromSlash(candidate))
		data, err := os.ReadFile(path) // #nosec G304 -- fixed candidate list inside the project
		if err != nil || len(data) == 0 || len(data) > 8<<20 {
			continue
		}
		if strings.HasSuffix(candidate, ".info") {
			if report := lcovCoverage(data, root); report != nil {
				return report
			}
			continue
		}
		if strings.HasSuffix(candidate, ".resultset.json") {
			if report := simpleCovCoverage(data, root); report != nil {
				return report
			}
			continue
		}
		if report := coberturaCoverage(data, root); report != nil {
			return report
		}
	}
	return nil
}

// lcovCoverage parses the line records of an lcov file (SF + DA); branch records are ignored.
func lcovCoverage(data []byte, root string) *idetesting.CoverageReport {
	report := &idetesting.CoverageReport{Mode: "lcov"}
	var current *idetesting.CoverageFile
	flush := func() {
		if current == nil {
			return
		}
		if current.Statements > 0 {
			current.Percent = float64(current.Covered) / float64(current.Statements) * 100
		}
		report.Statements += current.Statements
		report.Covered += current.Covered
		report.Files = append(report.Files, *current)
		current = nil
	}
	for raw := range strings.SplitSeq(string(data), "\n") {
		line := strings.TrimSpace(raw)
		switch {
		case strings.HasPrefix(line, "SF:"):
			flush()
			current = &idetesting.CoverageFile{Path: coveragePath(strings.TrimPrefix(line, "SF:"), root)}
		case strings.HasPrefix(line, "DA:") && current != nil:
			parts := strings.Split(strings.TrimPrefix(line, "DA:"), ",")
			if len(parts) < 2 {
				continue
			}
			number, err := strconv.Atoi(parts[0])
			if err != nil || number < 1 {
				continue
			}
			hits, _ := strconv.Atoi(parts[1])
			current.Statements++
			if hits > 0 {
				current.Covered++
			}
			current.Blocks = append(current.Blocks, idetesting.CoverageBlock{
				StartLine: number, EndLine: number, StartColumn: 1, EndColumn: 1,
				Covered: hits > 0, Statements: 1,
			})
		}
	}
	flush()
	if len(report.Files) == 0 {
		return nil
	}
	report.Percent = coveragePercent(report.Covered, report.Statements)
	return report
}

type coberturaLine struct {
	Number int `xml:"number,attr"`
	Hits   int `xml:"hits,attr"`
}

type coberturaClass struct {
	Filename string          `xml:"filename,attr"`
	Lines    []coberturaLine `xml:"lines>line"`
}

type coberturaPackage struct {
	Classes []coberturaClass `xml:"classes>class"`
}

type coberturaDocument struct {
	Packages []coberturaPackage `xml:"packages>package"`
}

// coberturaCoverage parses the line elements of a Cobertura/Scoverage XML report.
func coberturaCoverage(data []byte, root string) *idetesting.CoverageReport {
	var document coberturaDocument
	if xml.Unmarshal(data, &document) != nil {
		return nil
	}
	report := &idetesting.CoverageReport{Mode: "cobertura"}
	for _, pack := range document.Packages {
		for _, class := range pack.Classes {
			file := idetesting.CoverageFile{Path: coveragePath(class.Filename, root)}
			for _, line := range class.Lines {
				if line.Number < 1 {
					continue
				}
				file.Statements++
				if line.Hits > 0 {
					file.Covered++
				}
				file.Blocks = append(file.Blocks, idetesting.CoverageBlock{
					StartLine: line.Number, EndLine: line.Number, StartColumn: 1, EndColumn: 1,
					Covered: line.Hits > 0, Statements: 1,
				})
			}
			if file.Statements == 0 {
				continue
			}
			file.Percent = coveragePercent(file.Covered, file.Statements)
			report.Statements += file.Statements
			report.Covered += file.Covered
			report.Files = append(report.Files, file)
		}
	}
	if len(report.Files) == 0 {
		return nil
	}
	report.Percent = coveragePercent(report.Covered, report.Statements)
	return report
}

// simpleCovGroup is one suite of SimpleCov's coverage/.resultset.json. A line is null when it is
// not executable, 0 when it was missed and a positive hit count when it was covered.
type simpleCovGroup struct {
	Coverage map[string]struct {
		Lines []*int `json:"lines"`
	} `json:"coverage"`
}

func simpleCovCoverage(data []byte, root string) *idetesting.CoverageReport {
	var suites map[string]simpleCovGroup
	if json.Unmarshal(data, &suites) != nil {
		return nil
	}
	report := &idetesting.CoverageReport{Mode: "simplecov"}
	seen := map[string]bool{}
	for _, suite := range suites {
		for path, file := range suite.Coverage {
			relative := coveragePath(path, root)
			if seen[relative] {
				continue
			}
			seen[relative] = true
			result := idetesting.CoverageFile{Path: relative}
			for index, hits := range file.Lines {
				if hits == nil {
					continue
				}
				line := index + 1
				result.Statements++
				if *hits > 0 {
					result.Covered++
				}
				result.Blocks = append(result.Blocks, idetesting.CoverageBlock{
					StartLine: line, EndLine: line, StartColumn: 1, EndColumn: 1,
					Covered: *hits > 0, Statements: 1,
				})
			}
			if result.Statements == 0 {
				continue
			}
			result.Percent = coveragePercent(result.Covered, result.Statements)
			report.Statements += result.Statements
			report.Covered += result.Covered
			report.Files = append(report.Files, result)
		}
	}
	if len(report.Files) == 0 {
		return nil
	}
	report.Percent = coveragePercent(report.Covered, report.Statements)
	return report
}

func coveragePercent(covered, statements int) float64 {
	if statements == 0 {
		return 0
	}
	return float64(covered) / float64(statements) * 100
}

// coveragePath keeps a project-relative slash path; a report outside the project keeps its name.
func coveragePath(path, root string) string {
	clean := filepath.Clean(strings.TrimSpace(path))
	if relative, err := filepath.Rel(root, clean); err == nil && !strings.HasPrefix(relative, "..") {
		return filepath.ToSlash(relative)
	}
	if filepath.IsAbs(clean) {
		return filepath.ToSlash(filepath.Base(clean))
	}
	return filepath.ToSlash(clean)
}

// coverageParser adds coverage discovery to any declared parser without changing its events.
type coverageParser struct {
	inner    idetesting.EventParser
	root     string
	coverage *idetesting.CoverageReport
}

func (p *coverageParser) Parse(line []byte) (idetesting.Event, bool) {
	return p.inner.Parse(line)
}

func (p *coverageParser) Finish() []idetesting.Event {
	defer func() { p.coverage = scanProjectCoverage(p.root) }()
	if finisher, ok := p.inner.(idetesting.Finisher); ok {
		return finisher.Finish()
	}
	return nil
}

func (p *coverageParser) Coverage() *idetesting.CoverageReport { return p.coverage }
