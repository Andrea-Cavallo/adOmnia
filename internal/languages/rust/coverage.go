package rust

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"adomnia/internal/ide/sdk"
	idetesting "adomnia/internal/ide/testing"
)

// Coverage opzionale dei test Rust (RS-5.6, scelta RS-0.3): cargo-llvm-cov (Windows, macOS e
// Linux) con report LCOV in una cartella temporanea fuori dal progetto. cargo-tarpaulin non gira
// su Windows e non è supportato. Lo strumento è **opzionale**: lo si usa solo se già presente
// (installazione esplicita dell'utente, mai automatica) e la baseline dei test non dipende da
// esso — senza "Run with coverage" il comando resta `cargo test`.
const (
	coverageTool = "cargo-llvm-cov"
	// maxCoverageBytes limita il report letto dal file temporaneo.
	maxCoverageBytes = 16 << 20
	// maxCoverageFiles e maxCoverageLines limitano la vista su progetti molto grandi.
	maxCoverageFiles = 4000
	maxCoverageLines = 200000
)

// coverageMissing spiega come installare gli strumenti di copertura: comandi visibili, nessuna
// installazione silenziosa (RS-5.6/RS-9.4).
const coverageMissing = "Run with coverage needs cargo-llvm-cov and the rustup llvm-tools component: install them explicitly (`cargo install cargo-llvm-cov`, `rustup component add llvm-tools`) and run again"

// coverageAvailable dice se cargo-llvm-cov è già installato (sottocomando cargo nel PATH).
func coverageAvailable() bool {
	_, err := lookPath(sdk.ExecutableName(coverageTool))
	return err == nil
}

// prepareCoverageReport crea il file del report LCOV nella cartella temporanea di sistema, mai
// dentro il progetto. Restituisce il percorso da passare a `--output-path`.
func prepareCoverageReport() (string, error) {
	file, err := os.CreateTemp("", "adomnia-rust-coverage-*.info")
	if err != nil {
		return "", fmt.Errorf("could not prepare the coverage report file: %w", err)
	}
	path := file.Name()
	if err := file.Close(); err != nil {
		return "", fmt.Errorf("could not prepare the coverage report file: %w", err)
	}
	return path, nil
}

// lcovFile è la copertura di un file nel report LCOV: `DA:riga,conteggio` per riga più i totali.
type lcovFile struct {
	path  string
	lines map[int]int
	found int
	hit   int
}

// parseLCOV legge il sottoinsieme del formato LCOV che serve alla vista: `SF`, `DA`, `LF`, `LH` e
// `end_of_record`. Un record senza righe o senza percorso viene ignorato.
func parseLCOV(data []byte) []lcovFile {
	var files []lcovFile
	current := lcovFile{lines: map[int]int{}}
	closeRecord := func() {
		if current.path != "" && (len(current.lines) > 0 || current.found > 0) {
			files = append(files, current)
		}
		current = lcovFile{lines: map[int]int{}}
	}
	for _, raw := range strings.Split(string(data), "\n") {
		line := strings.TrimSpace(strings.TrimRight(raw, "\r"))
		switch {
		case line == "end_of_record":
			closeRecord()
		case strings.HasPrefix(line, "SF:"):
			current.path = strings.TrimPrefix(line, "SF:")
		case strings.HasPrefix(line, "DA:"):
			fields := strings.Split(strings.TrimPrefix(line, "DA:"), ",")
			number, err := strconv.Atoi(fields[0])
			if err != nil || len(fields) < 2 {
				continue
			}
			count, err := strconv.Atoi(fields[1])
			if err != nil {
				continue
			}
			previous, seen := current.lines[number]
			if !seen {
				current.found++
				current.lines[number] = 0
			}
			if count > 0 {
				if previous == 0 {
					current.hit++
				}
				current.lines[number] = count
			}
		case strings.HasPrefix(line, "LF:"):
			if value, err := strconv.Atoi(strings.TrimPrefix(line, "LF:")); err == nil {
				current.found = value
			}
		case strings.HasPrefix(line, "LH:"):
			if value, err := strconv.Atoi(strings.TrimPrefix(line, "LH:")); err == nil {
				current.hit = value
			}
		}
	}
	closeRecord()
	sort.SliceStable(files, func(left, right int) bool { return files[left].path < files[right].path })
	return files
}

// convertLCOV porta il report LCOV nella forma neutra del core (testing.CoverageReport): per ogni
// file i blocchi di riga coperti/mancanti e i totali. I percorsi diventano relativi alla radice del
// progetto, in forma slash. Restituisce nil se il report non contiene nessun file.
func convertLCOV(root string, data []byte) *idetesting.CoverageReport {
	records := parseLCOV(data)
	if len(records) == 0 {
		return nil
	}
	report := &idetesting.CoverageReport{Mode: coverageTool}
	blocks := 0
	for _, record := range records {
		if len(report.Files) >= maxCoverageFiles || blocks >= maxCoverageLines {
			break
		}
		file := idetesting.CoverageFile{
			Path:       coverageRelativePath(root, record.path),
			Statements: record.found,
			Covered:    record.hit,
		}
		if file.Statements < len(record.lines) {
			file.Statements = len(record.lines)
		}
		lines := make([]int, 0, len(record.lines))
		for line := range record.lines {
			lines = append(lines, line)
		}
		sort.Ints(lines)
		for _, line := range lines {
			if blocks >= maxCoverageLines {
				break
			}
			file.Blocks = append(file.Blocks, idetesting.CoverageBlock{
				StartLine: line, StartColumn: 1, EndLine: line, EndColumn: 2,
				Covered: record.lines[line] > 0, Statements: 1,
			})
			blocks++
		}
		if file.Statements > 0 {
			file.Percent = math.Round(float64(file.Covered)/float64(file.Statements)*1000) / 10
		}
		report.Statements += file.Statements
		report.Covered += file.Covered
		report.Files = append(report.Files, file)
	}
	if report.Statements > 0 {
		report.Percent = math.Round(float64(report.Covered)/float64(report.Statements)*1000) / 10
	}
	return report
}

// coverageRelativePath porta il percorso del report alla forma relativa al progetto, in slash
// (stessa regola della copertura Python).
func coverageRelativePath(root, path string) string {
	cleaned := filepath.Clean(path)
	if filepath.IsAbs(cleaned) {
		if relative, err := filepath.Rel(root, cleaned); err == nil && !strings.HasPrefix(relative, "..") {
			return filepath.ToSlash(relative)
		}
	}
	return filepath.ToSlash(strings.TrimPrefix(filepath.ToSlash(cleaned), "./"))
}

// Coverage implementa idetesting.CoverageProvider: restituisce il report della run, se è stata
// chiesta la copertura e cargo-llvm-cov lo ha scritto. È chiamata una sola volta dal manager a
// fine processo; un file mancante o malformato non è un errore della run.
func (p *libtestParser) Coverage() *idetesting.CoverageReport {
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
	p.coverage = convertLCOV(p.paths.root, data)
	return p.coverage
}
