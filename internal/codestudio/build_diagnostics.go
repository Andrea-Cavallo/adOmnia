package codestudio

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"unicode/utf16"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
)

// BuildDiagnostics sono i diagnostici dell'ultima build/run di una sessione, nella forma dei
// report LSP: il frontend li mostra in Problems accanto a quelli del language server e del linter.
type BuildDiagnostics struct {
	RunID   string              `json:"runId"`
	Reports []DiagnosticsReport `json:"reports"`
}

// publishBuildDiagnostics pubblica i diagnostici raccolti dall'output di una Run finita (RS-3.3).
// Va sempre pubblicato, anche vuoto: una build pulita azzera gli errori della precedente.
func (s *Service) publishBuildDiagnostics(execution Execution) {
	session, err := s.session(string(execution.SessionID))
	if err != nil {
		return
	}
	s.emit("build.diagnostics", execution.SessionID, string(execution.ID), BuildDiagnostics{
		RunID: string(execution.ID), Reports: buildDiagnosticReports(session, execution.WorkingDirectory, execution.Diagnostics),
	})
}

// buildDiagnosticReports raggruppa i diagnostici per file del progetto. I percorsi del compilatore
// sono relativi alla radice del suo workspace, che può stare sopra la cartella della Run: si prova
// la cartella di lavoro e poi i suoi genitori fino alla radice del progetto. I file fuori dal
// progetto (registry, sysroot) sono scartati.
func buildDiagnosticReports(session Session, workingDirectory string, diagnostics []run.Diagnostic) []DiagnosticsReport {
	byPath := map[string][]run.Diagnostic{}
	for _, diagnostic := range diagnostics {
		if diagnostic.File == "" || diagnostic.Line < 1 {
			continue
		}
		if path := resolveBuildFile(session.Project.RealPath, workingDirectory, diagnostic.File); path != "" {
			byPath[path] = append(byPath[path], diagnostic)
		}
	}
	reports := make([]DiagnosticsReport, 0, len(byPath))
	for path, items := range byPath {
		relative := relativeWithin(session.Project.RealPath, path)
		if relative == "" {
			continue
		}
		text, _, _, _ := readTextFile(path)
		lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
		converted := make([]EditorDiagnostic, 0, len(items))
		for _, item := range items {
			column := characterColumn(lines, item.Line, item.Column)
			message := item.Message
			if item.Help != "" {
				message += "\nhelp: " + item.Help
			}
			converted = append(converted, EditorDiagnostic{
				Range:    EditorRange{StartLine: item.Line, StartColumn: column, EndLine: item.Line, EndColumn: column + 1},
				Severity: item.Severity, Message: message, Source: "cargo", Code: item.Code,
			})
		}
		sort.Slice(converted, func(left, right int) bool { return converted[left].Range.StartLine < converted[right].Range.StartLine })
		reports = append(reports, DiagnosticsReport{URI: fileURI(path), Path: path, RelativePath: relative, DocumentID: stableDocumentID(session.ID, path), Diagnostics: converted})
	}
	sort.Slice(reports, func(left, right int) bool { return reports[left].RelativePath < reports[right].RelativePath })
	return reports
}

// resolveBuildFile trova il file di un diagnostico dentro il progetto, "" se non esiste lì.
func resolveBuildFile(projectRoot, workingDirectory, file string) string {
	file = filepath.FromSlash(file)
	if filepath.IsAbs(file) {
		if relativeWithin(projectRoot, file) != "" {
			return file
		}
		return ""
	}
	// Il compilatore stampa i percorsi relativi alla radice del suo workspace (per cargo la radice
	// `[workspace]`, che può stare sopra la cartella della Run): la si prova prima della cartella di
	// lavoro, sennò vince l'omonimo del membro (`crates/api/src/main.rs` per `src/main.rs`).
	if root := buildRootDirectory(projectRoot, workingDirectory); !samePath(root, workingDirectory) {
		if candidate := existingBuildFile(projectRoot, filepath.Join(root, file)); candidate != "" {
			return candidate
		}
	}
	directory := filepath.Clean(workingDirectory)
	for {
		if candidate := existingBuildFile(projectRoot, filepath.Join(directory, file)); candidate != "" {
			return candidate
		}
		if samePath(directory, projectRoot) || filepath.Dir(directory) == directory {
			return ""
		}
		directory = filepath.Dir(directory)
	}
}

func existingBuildFile(projectRoot, candidate string) string {
	if info, err := os.Stat(candidate); err == nil && info.Mode().IsRegular() && relativeWithin(projectRoot, candidate) != "" {
		return candidate
	}
	return ""
}

// buildRootDirectory è la radice rispetto a cui il compilatore stampa i percorsi relativi. Per i
// progetti Cargo è la radice del workspace (il manifest con `[workspace]` più vicino) o, senza
// workspace, la cartella del package. Senza manifest Cargo vale la cartella di lavoro.
func buildRootDirectory(projectRoot, workingDirectory string) string {
	packageRoot := ""
	directory := filepath.Clean(workingDirectory)
	for {
		manifest := filepath.Join(directory, "Cargo.toml")
		if info, err := os.Stat(manifest); err == nil && info.Mode().IsRegular() {
			if packageRoot == "" {
				packageRoot = directory
			}
			if cargoWorkspaceManifest(manifest) {
				return directory
			}
		}
		if samePath(directory, projectRoot) || filepath.Dir(directory) == directory {
			break
		}
		directory = filepath.Dir(directory)
	}
	if packageRoot != "" {
		return packageRoot
	}
	return filepath.Clean(workingDirectory)
}

var cargoWorkspaceHeader = regexp.MustCompile(`(?m)^\s*\[workspace\]`)

// cargoWorkspaceManifest dice se il manifest Cargo dichiara una sezione `[workspace]`.
func cargoWorkspaceManifest(path string) bool {
	data, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	return cargoWorkspaceHeader.Match(data)
}

// characterColumn converte una colonna in caratteri (1-based, come rustc) in unità UTF-16 (Monaco).
func characterColumn(lines []string, line, column int) int {
	if column <= 1 || line > len(lines) {
		return max(1, column)
	}
	runes := []rune(lines[line-1])
	return len(utf16.Encode(runes[:min(column-1, len(runes))])) + 1
}
