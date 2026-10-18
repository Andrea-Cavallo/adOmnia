package java

import (
	"encoding/xml"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Coverage Java con JaCoCo: il build gira con l'agente e scrive jacoco.xml; qui si legge quel report. JaCoCo conta
// le istruzioni bytecode per riga: una riga è coperta, scoperta o parziale (alcune istruzioni sì, altre no).

// JaCoCoPlugin è la versione fissata del plugin Maven: un build riproducibile non dipende dall'ultima release.
const JaCoCoPlugin = "org.jacoco:jacoco-maven-plugin:0.8.12"

const (
	jacocoMaxFiles = 400
	jacocoMaxBytes = 32 << 20
)

// JaCoCoLine è lo stato di una riga di sorgente.
type JaCoCoLine struct {
	Number int
	// MissedInstructions e CoveredInstructions: entrambi > 0 = riga parziale.
	MissedInstructions  int
	CoveredInstructions int
}

// JaCoCoFile è la copertura di un sorgente, identificato da package e nome file.
type JaCoCoFile struct {
	// Package nella forma di JaCoCo (`it/acme/orders`) e Name (`OrderService.java`).
	Package string
	Name    string
	Lines   []JaCoCoLine
}

type jacocoReport struct {
	Packages []struct {
		Name        string `xml:"name,attr"`
		SourceFiles []struct {
			Name  string `xml:"name,attr"`
			Lines []struct {
				Nr int `xml:"nr,attr"`
				Mi int `xml:"mi,attr"`
				Ci int `xml:"ci,attr"`
			} `xml:"line"`
		} `xml:"sourcefile"`
	} `xml:"package"`
}

// ParseJaCoCo legge un jacoco.xml.
func ParseJaCoCo(data []byte) ([]JaCoCoFile, error) {
	var report jacocoReport
	// JaCoCo scrive un DOCTYPE che punta a una DTD locale: il decoder non la cerca.
	if err := xml.Unmarshal(data, &report); err != nil {
		return nil, fmt.Errorf("invalid JaCoCo report: %w", err)
	}
	var files []JaCoCoFile
	for _, pkg := range report.Packages {
		for _, source := range pkg.SourceFiles {
			file := JaCoCoFile{Package: pkg.Name, Name: source.Name}
			for _, line := range source.Lines {
				if line.Mi == 0 && line.Ci == 0 {
					continue
				}
				file.Lines = append(file.Lines, JaCoCoLine{Number: line.Nr, MissedInstructions: line.Mi, CoveredInstructions: line.Ci})
			}
			if len(file.Lines) > 0 {
				files = append(files, file)
			}
		}
	}
	return files, nil
}

// FindJaCoCoReports cerca i jacoco.xml di Maven (target/site/jacoco) e Gradle (build/reports/jacoco) scritti dopo
// since, anche nei moduli. La ricerca ha dei limiti: un monorepo enorme non la blocca.
func FindJaCoCoReports(unitRoot string, since time.Time) []string {
	var found []string
	_ = filepath.WalkDir(unitRoot, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			if path != unitRoot && (entry.Name() == "src" || entry.Name() == "node_modules" || strings.HasPrefix(entry.Name(), ".") || depthOf(unitRoot, path) > maxReportDepth) {
				return filepath.SkipDir
			}
			return nil
		}
		slashed := filepath.ToSlash(path)
		if entry.Name() != "jacoco.xml" && entry.Name() != "jacocoTestReport.xml" {
			return nil
		}
		if !strings.Contains(slashed, "/target/site/jacoco/") && !strings.Contains(slashed, "/build/reports/jacoco/") {
			return nil
		}
		if info, infoErr := entry.Info(); infoErr != nil || info.ModTime().Before(since) || info.Size() > jacocoMaxBytes {
			return nil
		}
		if found = append(found, path); len(found) >= jacocoMaxFiles {
			return filepath.SkipAll
		}
		return nil
	})
	sort.Strings(found)
	return found
}

// ReadJaCoCoReports legge i report indicati; un report illeggibile si salta (gli altri moduli contano comunque).
func ReadJaCoCoReports(paths []string) []JaCoCoFile {
	var files []JaCoCoFile
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		if parsed, parseErr := ParseJaCoCo(data); parseErr == nil {
			files = append(files, parsed...)
		}
	}
	return files
}

// JaCoCoMavenGoals sono gli obiettivi da affiancare a `test`: l'agente prima e il report dopo.
func jacocoMavenArguments(arguments []string) []string {
	out := make([]string, 0, len(arguments)+2)
	for _, argument := range arguments {
		if argument == "test" {
			out = append(out, JaCoCoPlugin+":prepare-agent", "test", JaCoCoPlugin+":report")
			continue
		}
		out = append(out, argument)
	}
	return out
}

// jacocoGradleInit applica il plugin jacoco ai progetti java e scrive il report XML dopo ogni test.
const jacocoGradleInit = `allprojects {
  plugins.withId('java') {
    apply plugin: 'jacoco'
    tasks.withType(Test).configureEach { finalizedBy('jacocoTestReport') }
    tasks.withType(JacocoReport).configureEach { reports { xml.required = true } }
  }
}
`

// jacocoInitScript scrive (se serve) lo script di init di Gradle per il coverage.
func jacocoInitScript() (string, error) {
	base, err := os.UserCacheDir()
	if err != nil {
		base = os.TempDir()
	}
	directory := filepath.Join(base, "adomnia", "java")
	path := filepath.Join(directory, "adomnia-jacoco.init.gradle")
	if existing, readErr := os.ReadFile(path); readErr == nil && string(existing) == jacocoGradleInit {
		return path, nil
	}
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return "", fmt.Errorf("cannot prepare the coverage script: %w", err)
	}
	if err := os.WriteFile(path, []byte(jacocoGradleInit), 0o644); err != nil {
		return "", fmt.Errorf("cannot write the coverage script: %w", err)
	}
	return path, nil
}
