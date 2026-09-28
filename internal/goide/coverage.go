package goide

import (
	"bufio"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

const maxCoverageFiles = 5000

// CoverageBlock è un blocco del profilo con colonne Monaco (1-based, UTF-16).
type CoverageBlock struct {
	StartLine   int  `json:"startLine"`
	StartColumn int  `json:"startColumn"`
	EndLine     int  `json:"endLine"`
	EndColumn   int  `json:"endColumn"`
	Covered     bool `json:"covered"`
}

// CoverageFile riporta la copertura di un file e l'impronta del contenuto analizzato:
// se il file cambia, l'editor sa che le annotazioni non corrispondono più.
type CoverageFile struct {
	ImportPath   string          `json:"importPath"`
	RelativePath string          `json:"relativePath"`
	Statements   int             `json:"statements"`
	Covered      int             `json:"covered"`
	Percent      float64         `json:"percent"`
	DiskToken    string          `json:"diskToken"`
	Blocks       []CoverageBlock `json:"blocks"`
}

// CoveragePackage aggrega i file di un package.
type CoveragePackage struct {
	ImportPath   string  `json:"importPath"`
	RelativePath string  `json:"relativePath"`
	Statements   int     `json:"statements"`
	Covered      int     `json:"covered"`
	Percent      float64 `json:"percent"`
}

// CoverageReport è il risultato di `go test -coverprofile`, già risolto sui file del progetto.
type CoverageReport struct {
	Mode        string            `json:"mode"`
	Statements  int               `json:"statements"`
	Covered     int               `json:"covered"`
	Percent     float64           `json:"percent"`
	Packages    []CoveragePackage `json:"packages"`
	Files       []CoverageFile    `json:"files"`
	GeneratedAt time.Time         `json:"generatedAt"`
}

type rawCoverageBlock struct {
	startLine, startColumn, endLine, endColumn, statements int
	count                                                  int
}

// parseCoverageProfile legge un profilo Go; i blocchi ripetuti (più package di test) vengono uniti.
func parseCoverageProfile(data []byte) (string, map[string][]rawCoverageBlock, error) {
	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	mode := ""
	files := map[string][]rawCoverageBlock{}
	seen := map[string]int{}
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "mode:") {
			mode = strings.TrimSpace(strings.TrimPrefix(line, "mode:"))
			continue
		}
		file, block, err := parseCoverageLine(line)
		if err != nil {
			return "", nil, err
		}
		key := fmt.Sprintf("%s:%d.%d,%d.%d", file, block.startLine, block.startColumn, block.endLine, block.endColumn)
		if index, duplicate := seen[key]; duplicate {
			files[file][index].count += block.count
			continue
		}
		if _, known := files[file]; !known && len(files) >= maxCoverageFiles {
			continue
		}
		seen[key] = len(files[file])
		files[file] = append(files[file], block)
	}
	if mode == "" {
		return "", nil, fmt.Errorf("profilo di coverage senza intestazione mode")
	}
	return mode, files, scanner.Err()
}

// parseCoverageLine interpreta "import/path/file.go:3.24,5.2 2 1".
func parseCoverageLine(line string) (string, rawCoverageBlock, error) {
	fields := strings.Fields(line)
	colon := strings.LastIndex(fields[0], ":")
	if len(fields) != 3 || colon < 0 {
		return "", rawCoverageBlock{}, fmt.Errorf("riga di coverage non valida: %q", line)
	}
	start, end, ok := strings.Cut(fields[0][colon+1:], ",")
	if !ok {
		return "", rawCoverageBlock{}, fmt.Errorf("intervallo di coverage non valido: %q", line)
	}
	var block rawCoverageBlock
	var err error
	if block.startLine, block.startColumn, err = parsePosition(start); err != nil {
		return "", rawCoverageBlock{}, err
	}
	if block.endLine, block.endColumn, err = parsePosition(end); err != nil {
		return "", rawCoverageBlock{}, err
	}
	if block.statements, err = strconv.Atoi(fields[1]); err != nil {
		return "", rawCoverageBlock{}, fmt.Errorf("numero di istruzioni non valido: %q", line)
	}
	if block.count, err = strconv.Atoi(fields[2]); err != nil {
		return "", rawCoverageBlock{}, fmt.Errorf("conteggio non valido: %q", line)
	}
	return fields[0][:colon], block, nil
}

func parsePosition(value string) (int, int, error) {
	lineText, columnText, ok := strings.Cut(value, ".")
	line, lineErr := strconv.Atoi(lineText)
	column, columnErr := strconv.Atoi(columnText)
	if !ok || lineErr != nil || columnErr != nil {
		return 0, 0, fmt.Errorf("posizione di coverage non valida: %q", value)
	}
	return line, column, nil
}

func percent(covered, total int) float64 {
	if total == 0 {
		return 0
	}
	return float64(covered) * 100 / float64(total)
}

// buildCoverageReport risolve i percorsi di import sui file del modulo e converte le colonne per Monaco.
func buildCoverageReport(projectRoot, moduleDir, modulePath string, data []byte) (CoverageReport, error) {
	mode, files, err := parseCoverageProfile(data)
	if err != nil {
		return CoverageReport{}, err
	}
	report := CoverageReport{Mode: mode, GeneratedAt: time.Now().UTC(), Packages: []CoveragePackage{}, Files: []CoverageFile{}}
	packages := map[string]*CoveragePackage{}
	for importPath, blocks := range files {
		if modulePath == "" || !strings.HasPrefix(importPath, modulePath+"/") {
			continue
		}
		relative := path.Join(moduleDir, strings.TrimPrefix(importPath, modulePath+"/"))
		text, _, token, readErr := readTextFile(filepath.Join(projectRoot, filepath.FromSlash(relative)))
		if readErr != nil {
			continue
		}
		lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
		file := CoverageFile{ImportPath: importPath, RelativePath: relative, DiskToken: token, Blocks: make([]CoverageBlock, 0, len(blocks))}
		for _, block := range blocks {
			file.Statements += block.statements
			if block.count > 0 {
				file.Covered += block.statements
			}
			file.Blocks = append(file.Blocks, CoverageBlock{
				StartLine: block.startLine, StartColumn: utf16Column(lines, block.startLine, block.startColumn),
				EndLine: block.endLine, EndColumn: utf16Column(lines, block.endLine, block.endColumn), Covered: block.count > 0,
			})
		}
		file.Percent = percent(file.Covered, file.Statements)
		report.Files = append(report.Files, file)
		pkgPath := path.Dir(importPath)
		pkg := packages[pkgPath]
		if pkg == nil {
			pkg = &CoveragePackage{ImportPath: pkgPath, RelativePath: path.Dir(relative)}
			packages[pkgPath] = pkg
		}
		pkg.Statements += file.Statements
		pkg.Covered += file.Covered
		report.Statements += file.Statements
		report.Covered += file.Covered
	}
	for _, pkg := range packages {
		pkg.Percent = percent(pkg.Covered, pkg.Statements)
		report.Packages = append(report.Packages, *pkg)
	}
	report.Percent = percent(report.Covered, report.Statements)
	sort.Slice(report.Files, func(left, right int) bool { return report.Files[left].RelativePath < report.Files[right].RelativePath })
	sort.Slice(report.Packages, func(left, right int) bool {
		return report.Packages[left].ImportPath < report.Packages[right].ImportPath
	})
	return report, nil
}

// loadCoverage legge il profilo scritto da go test e lo rimuove: il report resta solo in memoria.
func loadCoverage(projectRoot, moduleDir, modulePath, profilePath string) (*CoverageReport, error) {
	data, err := os.ReadFile(profilePath)
	_ = os.Remove(profilePath)
	if err != nil {
		return nil, fmt.Errorf("profilo di coverage non disponibile: %w", err)
	}
	report, err := buildCoverageReport(projectRoot, moduleDir, modulePath, data)
	if err != nil {
		return nil, err
	}
	return &report, nil
}
