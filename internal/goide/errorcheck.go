package goide

import (
	"context"
	"errors"
	"fmt"
	"go/token"
	"os"
	"path/filepath"
	"time"

	"adomnia/internal/languages/golang"

	"golang.org/x/tools/go/packages"
)

// Error Handling Intelligence: carica ogni modulo con go/packages (avvia `go list`, quindi
// richiede un progetto autorizzato) e converte l'analisi dell'adapter Go in posizioni dell'editor.

const errorAnalysisTimeout = 3 * time.Minute

// ErrorLocation è una posizione dell'editor (colonne UTF-16 come Monaco).
type ErrorLocation struct {
	RelativePath string `json:"relativePath"`
	Line         int    `json:"line"`
	Column       int    `json:"column"`
}

// ErrorHandlingEdit è un edit di un fix; Original è il testo atteso nel range.
type ErrorHandlingEdit struct {
	Range    EditorRange `json:"range"`
	Original string      `json:"original"`
	Text     string      `json:"text"`
}

type ErrorHandlingFix struct {
	Label string              `json:"label"`
	Edits []ErrorHandlingEdit `json:"edits"`
}

type ErrorHandlingFinding struct {
	Kind     string            `json:"kind"`
	Severity string            `json:"severity"`
	Message  string            `json:"message"`
	Function string            `json:"function,omitempty"`
	Location ErrorLocation     `json:"location"`
	End      ErrorLocation     `json:"end"`
	Fix      *ErrorHandlingFix `json:"fix,omitempty"`
}

type ErrorHandlingRef struct {
	Kind     string        `json:"kind"`
	Function string        `json:"function,omitempty"`
	Location ErrorLocation `json:"location"`
}

type ErrorSentinel struct {
	Name     string             `json:"name"`
	Package  string             `json:"package"`
	Message  string             `json:"message,omitempty"`
	Location ErrorLocation      `json:"location"`
	Refs     []ErrorHandlingRef `json:"refs"`
}

type ErrorTypeEntry struct {
	Name     string             `json:"name"`
	Package  string             `json:"package"`
	Location ErrorLocation      `json:"location"`
	Pointer  bool               `json:"pointer"`
	Unwrap   bool               `json:"unwrap"`
	Is       bool               `json:"is"`
	As       bool               `json:"as"`
	Wraps    []string           `json:"wraps"`
	Refs     []ErrorHandlingRef `json:"refs"`
}

type ErrorFunctionReturn struct {
	Location ErrorLocation `json:"location"`
	Kind     string        `json:"kind"`
	Detail   string        `json:"detail"`
}

type ErrorFunctionPath struct {
	Function string                `json:"function"`
	Location ErrorLocation         `json:"location"`
	Returns  []ErrorFunctionReturn `json:"returns"`
}

// ErrorHandlingReport è l'analisi di tutti i moduli del progetto.
type ErrorHandlingReport struct {
	Findings  []ErrorHandlingFinding `json:"findings"`
	Sentinels []ErrorSentinel        `json:"sentinels"`
	Types     []ErrorTypeEntry       `json:"types"`
	Paths     []ErrorFunctionPath    `json:"paths"`
	Problems  []string               `json:"problems"`
	Modules   int                    `json:"modules"`
}

// AnalyzeErrorHandling analizza la gestione degli errori di ogni modulo Go del progetto.
func (s *Service) AnalyzeErrorHandling(sessionID string) (ErrorHandlingReport, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return ErrorHandlingReport{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return ErrorHandlingReport{}, errors.New("autorizza esplicitamente gli strumenti per questo progetto")
	}
	environment, err := s.toolchain.Environment(SessionID(sessionID), nil)
	if err != nil {
		return ErrorHandlingReport{}, err
	}
	binary, err := s.toolchain.GoBinary(SessionID(sessionID))
	if err != nil {
		return ErrorHandlingReport{}, errors.New("go non disponibile: rileva o configura la toolchain")
	}
	environment = withGoFirstInPath(environment, binary)
	root := session.Project.RealPath
	report := ErrorHandlingReport{Findings: []ErrorHandlingFinding{}, Sentinels: []ErrorSentinel{}, Types: []ErrorTypeEntry{}, Paths: []ErrorFunctionPath{}, Problems: []string{}}
	ctx, cancel := context.WithTimeout(context.Background(), errorAnalysisTimeout)
	defer cancel()
	texts := newErrorTexts(root)
	for _, module := range goLayoutOf(session.Project).Modules {
		fset := token.NewFileSet()
		config := &packages.Config{
			Context: ctx, Dir: module.Path, Env: environment, Tests: true, Fset: fset,
			Mode: packages.NeedName | packages.NeedFiles | packages.NeedCompiledGoFiles | packages.NeedSyntax | packages.NeedTypes | packages.NeedTypesInfo,
		}
		loaded, err := packages.Load(config, "./...")
		if err != nil {
			report.Problems = append(report.Problems, fmt.Sprintf("%s: %v", relativeOrDot(root, module.Path), err))
			continue
		}
		report.Modules++
		for _, pkg := range loaded {
			for _, loadErr := range pkg.Errors {
				if len(report.Problems) < 20 {
					report.Problems = append(report.Problems, loadErr.Error())
				}
			}
		}
		texts.merge(&report, golang.AnalyzeErrorHandling(fset, loaded, texts.read))
	}
	return report, nil
}

// errorTexts legge una volta i file del progetto e converte offset in posizioni dell'editor.
type errorTexts struct {
	root  string
	files map[string]string
}

func newErrorTexts(root string) *errorTexts {
	return &errorTexts{root: root, files: map[string]string{}}
}

func (t *errorTexts) read(path string) ([]byte, error) {
	if relativeWithin(t.root, path) == "" {
		return nil, errors.New("file fuori dal progetto")
	}
	if text, ok := t.files[path]; ok {
		return []byte(text), nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	t.files[path] = string(data)
	return data, nil
}

func (t *errorTexts) location(path string, offset int) ErrorLocation {
	text := t.files[path]
	offset = min(max(offset, 0), len(text))
	position := editorPositionAt(text, offset)
	return ErrorLocation{RelativePath: filepath.ToSlash(relativeWithin(t.root, path)), Line: position.line, Column: position.column}
}

func (t *errorTexts) refs(refs []golang.ErrorRef) []ErrorHandlingRef {
	result := make([]ErrorHandlingRef, 0, len(refs))
	for _, ref := range refs {
		result = append(result, ErrorHandlingRef{Kind: ref.Kind, Function: ref.Function, Location: t.location(ref.Path, ref.Offset)})
	}
	return result
}

func (t *errorTexts) merge(report *ErrorHandlingReport, analysis golang.ErrorReport) {
	for _, finding := range analysis.Findings {
		converted := ErrorHandlingFinding{
			Kind: finding.Kind, Severity: finding.Severity, Message: finding.Message, Function: finding.Function,
			Location: t.location(finding.Path, finding.Offset), End: t.location(finding.Path, finding.End),
		}
		if finding.Fix != nil {
			fix := &ErrorHandlingFix{Label: finding.Fix.Label, Edits: []ErrorHandlingEdit{}}
			for _, edit := range finding.Fix.Edits {
				start, end := t.location(finding.Path, edit.Offset), t.location(finding.Path, edit.End)
				fix.Edits = append(fix.Edits, ErrorHandlingEdit{Range: EditorRange{StartLine: start.Line, StartColumn: start.Column, EndLine: end.Line, EndColumn: end.Column}, Original: edit.Original, Text: edit.Text})
			}
			converted.Fix = fix
		}
		report.Findings = append(report.Findings, converted)
	}
	for _, sentinel := range analysis.Sentinels {
		report.Sentinels = append(report.Sentinels, ErrorSentinel{Name: sentinel.Name, Package: sentinel.Package, Message: sentinel.Message, Location: t.location(sentinel.Path, sentinel.Offset), Refs: t.refs(sentinel.Refs)})
	}
	for _, info := range analysis.Types {
		report.Types = append(report.Types, ErrorTypeEntry{Name: info.Name, Package: info.Package, Location: t.location(info.Path, info.Offset), Pointer: info.Pointer, Unwrap: info.Unwrap, Is: info.Is, As: info.As, Wraps: info.Wraps, Refs: t.refs(info.Refs)})
	}
	for _, path := range analysis.Paths {
		converted := ErrorFunctionPath{Function: path.Function, Location: t.location(path.Path, path.Offset), Returns: []ErrorFunctionReturn{}}
		for _, ret := range path.Returns {
			converted.Returns = append(converted.Returns, ErrorFunctionReturn{Location: t.location(path.Path, ret.Offset), Kind: ret.Kind, Detail: ret.Detail})
		}
		report.Paths = append(report.Paths, converted)
	}
}
