package codestudio

import (
	"io/fs"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/Andrea-Cavallo/adOmnia/internal/languages/java"
)

const maxCoverageSourceScan = 20_000

// javaCoverageReport legge i report JaCoCo scritti dalla run di test e li porta nello stesso CoverageReport di Go:
// una riga = un'unità, così editor, pannello e percentuali funzionano senza cambiare. Una riga parziale (alcune
// istruzioni eseguite, altre no) genera un blocco coperto e uno scoperto, che l'editor mostra come parziale.
func javaCoverageReport(projectRoot, moduleDir string, since time.Time) (*CoverageReport, error) {
	reports := java.FindJaCoCoReports(moduleDir, since)
	if len(reports) == 0 {
		return nil, errNoJavaCoverage
	}
	sources := javaSourceIndex(moduleDir)
	report := CoverageReport{Mode: "line", GeneratedAt: time.Now().UTC(), Packages: []CoveragePackage{}, Files: []CoverageFile{}}
	packages := map[string]*CoveragePackage{}
	for _, covered := range java.ReadJaCoCoReports(reports) {
		source, ok := sources[covered.Package+"/"+covered.Name]
		if !ok {
			continue
		}
		relative := filepath.ToSlash(relativeWithin(projectRoot, source))
		text, _, token, err := readTextFile(source)
		if err != nil {
			continue
		}
		lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
		file := CoverageFile{ImportPath: covered.Package + "/" + covered.Name, RelativePath: relative, DiskToken: token, Blocks: []CoverageBlock{}, Functions: []CoverageFunction{}, Branches: []CoverageBranch{}}
		for _, line := range covered.Lines {
			if line.Number < 1 || line.Number > len(lines) {
				continue
			}
			end := len(utf16.Encode([]rune(lines[line.Number-1]))) + 1
			block := func(isCovered bool, statements int) CoverageBlock {
				return CoverageBlock{StartLine: line.Number, StartColumn: 1, EndLine: line.Number, EndColumn: end, Covered: isCovered, Statements: statements}
			}
			file.Statements++
			switch {
			case line.CoveredInstructions > 0:
				file.Covered++
				file.Blocks = append(file.Blocks, block(true, 1))
				if line.MissedInstructions > 0 {
					file.Blocks = append(file.Blocks, block(false, 0))
				}
			default:
				file.Blocks = append(file.Blocks, block(false, 1))
			}
		}
		if file.Statements == 0 {
			continue
		}
		file.Percent = percent(file.Covered, file.Statements)
		report.Files = append(report.Files, file)
		directory := path.Dir(file.RelativePath)
		pkg := packages[covered.Package]
		if pkg == nil {
			pkg = &CoveragePackage{ImportPath: strings.ReplaceAll(covered.Package, "/", "."), RelativePath: directory}
			packages[covered.Package] = pkg
		}
		pkg.Statements += file.Statements
		pkg.Covered += file.Covered
		report.Statements += file.Statements
		report.Covered += file.Covered
	}
	if len(report.Files) == 0 {
		return nil, errNoJavaCoverage
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
	return &report, nil
}

type javaCoverageError string

func (e javaCoverageError) Error() string { return string(e) }

const errNoJavaCoverage = javaCoverageError("JaCoCo wrote no report: check that the tests ran and the build finished")

// javaSourceIndex mappa `it/acme/Foo.java` sul sorgente sotto src/main (java, kotlin) del modulo e dei suoi moduli figli.
func javaSourceIndex(moduleDir string) map[string]string {
	index := map[string]string{}
	scanned := 0
	_ = filepath.WalkDir(moduleDir, func(file string, entry fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			if file != moduleDir && (entry.Name() == "node_modules" || entry.Name() == "target" || entry.Name() == "build" || strings.HasPrefix(entry.Name(), ".")) {
				return filepath.SkipDir
			}
			return nil
		}
		if scanned++; scanned > maxCoverageSourceScan {
			return filepath.SkipAll
		}
		slashed := filepath.ToSlash(file)
		for _, root := range []string{"/src/main/java/", "/src/main/kotlin/"} {
			if at := strings.LastIndex(slashed, root); at >= 0 {
				if key := slashed[at+len(root):]; strings.HasSuffix(key, ".java") || strings.HasSuffix(key, ".kt") {
					if _, exists := index[key]; !exists {
						index[key] = file
					}
				}
				break
			}
		}
		return nil
	})
	return index
}
