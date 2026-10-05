package golang

import (
	"go/ast"
	"go/constant"
	"go/token"
	"go/types"
	"path/filepath"
	"sort"
	"strings"

	"golang.org/x/tools/go/packages"
	"golang.org/x/tools/go/types/typeutil"
)

// Error Handling Intelligence: analisi tipizzata (go/packages + go/types) della gestione degli
// errori. Produce problemi con fix opzionali, il catalogo di sentinel e tipi d'errore e i percorsi
// di ritorno degli errori per funzione. Le posizioni sono offset in byte del file su disco.

// ErrorEdit sostituisce [Offset, End) con Text; Original è il testo atteso, per non applicare fix obsoleti.
type ErrorEdit struct {
	Offset   int    `json:"offset"`
	End      int    `json:"end"`
	Original string `json:"original"`
	Text     string `json:"text"`
}

// ErrorFix è una correzione applicabile con un clic (tutti gli edit sullo stesso file).
type ErrorFix struct {
	Label string      `json:"label"`
	Edits []ErrorEdit `json:"edits"`
}

// ErrorFinding è un problema nella gestione degli errori.
type ErrorFinding struct {
	Kind     string    `json:"kind"`
	Severity string    `json:"severity"`
	Message  string    `json:"message"`
	Path     string    `json:"path"`
	Offset   int       `json:"offset"`
	End      int       `json:"end"`
	Function string    `json:"function,omitempty"`
	Fix      *ErrorFix `json:"fix,omitempty"`
}

// ErrorRef è un uso di un sentinel o di un tipo d'errore.
type ErrorRef struct {
	Kind     string `json:"kind"`
	Path     string `json:"path"`
	Offset   int    `json:"offset"`
	Function string `json:"function,omitempty"`
}

// SentinelError è una variabile di package di tipo error (es. var ErrNotFound = errors.New("…")).
type SentinelError struct {
	Name    string     `json:"name"`
	Package string     `json:"package"`
	Message string     `json:"message,omitempty"`
	Path    string     `json:"path"`
	Offset  int        `json:"offset"`
	Refs    []ErrorRef `json:"refs"`
}

// ErrorTypeInfo è un tipo che implementa error, con ciò che avvolge e dove viene usato.
type ErrorTypeInfo struct {
	Name    string     `json:"name"`
	Package string     `json:"package"`
	Path    string     `json:"path"`
	Offset  int        `json:"offset"`
	Pointer bool       `json:"pointer"`
	Unwrap  bool       `json:"unwrap"`
	Is      bool       `json:"is"`
	As      bool       `json:"as"`
	Wraps   []string   `json:"wraps"`
	Refs    []ErrorRef `json:"refs"`
}

// ErrorReturn è un punto in cui una funzione restituisce un errore, classificato per origine.
type ErrorReturn struct {
	Offset int    `json:"offset"`
	Kind   string `json:"kind"`
	Detail string `json:"detail"`
}

// ErrorPath elenca i ritorni d'errore di una funzione.
type ErrorPath struct {
	Function string        `json:"function"`
	Path     string        `json:"path"`
	Offset   int           `json:"offset"`
	Returns  []ErrorReturn `json:"returns"`
}

// ErrorReport è il risultato dell'analisi di un modulo.
type ErrorReport struct {
	Findings  []ErrorFinding  `json:"findings"`
	Sentinels []SentinelError `json:"sentinels"`
	Types     []ErrorTypeInfo `json:"types"`
	Paths     []ErrorPath     `json:"paths"`
}

const (
	maxErrorFindings = 5000
	maxErrorPaths    = 5000
	maxErrorRefs     = 200
)

var (
	errorType  = types.Universe.Lookup("error").Type()
	errorIface = errorType.Underlying().(*types.Interface)
)

// Funzioni il cui errore si ignora per convenzione (scritture in memoria o su stdout).
var ignorableErrorCalls = map[string]bool{
	"fmt.Print": true, "fmt.Printf": true, "fmt.Println": true,
	"fmt.Fprint": true, "fmt.Fprintf": true, "fmt.Fprintln": true,
	"(*strings.Builder).Write": true, "(*strings.Builder).WriteString": true, "(*strings.Builder).WriteByte": true, "(*strings.Builder).WriteRune": true,
	"(*bytes.Buffer).Write": true, "(*bytes.Buffer).WriteString": true, "(*bytes.Buffer).WriteByte": true, "(*bytes.Buffer).WriteRune": true,
	"(hash.Hash).Write": true, "(hash.Hash32).Write": true, "(hash.Hash64).Write": true,
}

func isError(t types.Type) bool {
	return t != nil && types.Identical(t, errorType)
}

func implementsError(t types.Type) bool {
	if t == nil {
		return false
	}
	if _, isInterface := t.Underlying().(*types.Interface); isInterface {
		return types.Implements(t, errorIface)
	}
	return types.Implements(t, errorIface) || types.Implements(types.NewPointer(t), errorIface)
}

type typedFile struct {
	pkg  *packages.Package
	file *ast.File
	path string
	text []byte
}

// typedFiles (condiviso da errori e architettura) sceglie per ogni file la variante di package più completa (la variante di test include i file normali).
func typedFiles(loaded []*packages.Package, read func(string) ([]byte, error)) []typedFile {
	chosen := map[string]typedFile{}
	for _, pkg := range loaded {
		if pkg.TypesInfo == nil {
			continue
		}
		for index, name := range pkg.CompiledGoFiles {
			if index >= len(pkg.Syntax) || !strings.HasSuffix(name, ".go") {
				continue
			}
			key := filepath.Clean(name)
			if current, ok := chosen[key]; ok && len(current.pkg.Syntax) >= len(pkg.Syntax) {
				continue
			}
			chosen[key] = typedFile{pkg: pkg, file: pkg.Syntax[index], path: key}
		}
	}
	files := make([]typedFile, 0, len(chosen))
	for _, file := range chosen {
		text, err := read(file.path)
		if err != nil {
			continue
		}
		file.text = text
		files = append(files, file)
	}
	sort.Slice(files, func(left, right int) bool { return files[left].path < files[right].path })
	return files
}

// AnalyzeErrorHandling analizza i package caricati con sintassi e tipi.
func AnalyzeErrorHandling(fset *token.FileSet, loaded []*packages.Package, read func(string) ([]byte, error)) ErrorReport {
	files := typedFiles(loaded, read)
	analysis := &errorAnalysis{fset: fset, sentinels: map[*types.Var]*SentinelError{}, errorTypes: map[*types.TypeName]*ErrorTypeInfo{}}
	for _, file := range files {
		analysis.collectDeclarations(file)
	}
	for _, file := range files {
		analysis.analyzeFile(file)
	}
	return analysis.report()
}

type errorAnalysis struct {
	fset       *token.FileSet
	findings   []ErrorFinding
	paths      []ErrorPath
	sentinels  map[*types.Var]*SentinelError
	errorTypes map[*types.TypeName]*ErrorTypeInfo
}

func (a *errorAnalysis) offset(pos token.Pos) int {
	return a.fset.Position(pos).Offset
}

func (a *errorAnalysis) add(file typedFile, finding ErrorFinding) {
	if len(a.findings) >= maxErrorFindings {
		return
	}
	finding.Path = file.path
	a.findings = append(a.findings, finding)
}

// collectDeclarations registra sentinel e tipi d'errore dichiarati nei file del progetto.
func (a *errorAnalysis) collectDeclarations(file typedFile) {
	info := file.pkg.TypesInfo
	for _, decl := range file.file.Decls {
		gen, ok := decl.(*ast.GenDecl)
		if !ok {
			continue
		}
		for _, spec := range gen.Specs {
			switch spec := spec.(type) {
			case *ast.ValueSpec:
				if gen.Tok != token.VAR {
					continue
				}
				for index, name := range spec.Names {
					variable, ok := info.Defs[name].(*types.Var)
					if !ok || name.Name == "_" || !implementsError(variable.Type()) {
						continue
					}
					sentinel := &SentinelError{Name: name.Name, Package: file.pkg.PkgPath, Path: file.path, Offset: a.offset(name.Pos()), Refs: []ErrorRef{}}
					if index < len(spec.Values) {
						sentinel.Message = constructorMessage(info, spec.Values[index])
					}
					a.sentinels[variable] = sentinel
				}
			case *ast.TypeSpec:
				typeName, ok := info.Defs[spec.Name].(*types.TypeName)
				if !ok {
					continue
				}
				named := typeName.Type()
				if _, isInterface := named.Underlying().(*types.Interface); isInterface || !implementsError(named) {
					continue
				}
				a.errorTypes[typeName] = describeErrorType(typeName, file, a.offset(spec.Name.Pos()))
			}
		}
	}
}

func describeErrorType(typeName *types.TypeName, file typedFile, offset int) *ErrorTypeInfo {
	named := typeName.Type()
	pointerSet := types.NewMethodSet(types.NewPointer(named))
	has := func(method string) bool { return pointerSet.Lookup(typeName.Pkg(), method) != nil }
	result := &ErrorTypeInfo{
		Name: typeName.Name(), Package: file.pkg.PkgPath, Path: file.path, Offset: offset,
		Pointer: !types.Implements(named, errorIface), Unwrap: has("Unwrap"), Is: has("Is"), As: has("As"),
		Wraps: []string{}, Refs: []ErrorRef{},
	}
	if structure, ok := named.Underlying().(*types.Struct); ok {
		for index := 0; index < structure.NumFields(); index++ {
			field := structure.Field(index)
			if implementsError(field.Type()) {
				label := field.Name() + " " + types.TypeString(field.Type(), types.RelativeTo(typeName.Pkg()))
				if field.Embedded() {
					label = "embeds " + types.TypeString(field.Type(), types.RelativeTo(typeName.Pkg()))
				}
				result.Wraps = append(result.Wraps, label)
			}
		}
	}
	return result
}

// constructorMessage legge il messaggio costante di errors.New("…") o fmt.Errorf("…").
func constructorMessage(info *types.Info, value ast.Expr) string {
	call, ok := ast.Unparen(value).(*ast.CallExpr)
	if !ok || len(call.Args) == 0 {
		return ""
	}
	callee := typeutil.Callee(info, call)
	if callee == nil || (fullName(callee) != "errors.New" && fullName(callee) != "fmt.Errorf") {
		return ""
	}
	if tv, ok := info.Types[call.Args[0]]; ok && tv.Value != nil && tv.Value.Kind() == constant.String {
		return constant.StringVal(tv.Value)
	}
	return ""
}

func (a *errorAnalysis) report() ErrorReport {
	report := ErrorReport{Findings: a.findings, Sentinels: []SentinelError{}, Types: []ErrorTypeInfo{}, Paths: a.paths}
	if report.Findings == nil {
		report.Findings = []ErrorFinding{}
	}
	if report.Paths == nil {
		report.Paths = []ErrorPath{}
	}
	for _, sentinel := range a.sentinels {
		report.Sentinels = append(report.Sentinels, *sentinel)
	}
	for _, info := range a.errorTypes {
		report.Types = append(report.Types, *info)
	}
	sort.Slice(report.Sentinels, func(i, j int) bool {
		return report.Sentinels[i].Package+"."+report.Sentinels[i].Name < report.Sentinels[j].Package+"."+report.Sentinels[j].Name
	})
	sort.Slice(report.Types, func(i, j int) bool {
		return report.Types[i].Package+"."+report.Types[i].Name < report.Types[j].Package+"."+report.Types[j].Name
	})
	sort.SliceStable(report.Findings, func(i, j int) bool {
		if report.Findings[i].Path != report.Findings[j].Path {
			return report.Findings[i].Path < report.Findings[j].Path
		}
		return report.Findings[i].Offset < report.Findings[j].Offset
	})
	return report
}

func (a *errorAnalysis) ref(file typedFile, kind string, pos token.Pos, function string) ErrorRef {
	return ErrorRef{Kind: kind, Path: file.path, Offset: a.offset(pos), Function: function}
}

func appendRef(refs []ErrorRef, ref ErrorRef) []ErrorRef {
	if len(refs) >= maxErrorRefs {
		return refs
	}
	return append(refs, ref)
}

// fullName è il nome qualificato di una funzione o un metodo ("fmt.Errorf", "(*bytes.Buffer).Write").
func fullName(object types.Object) string {
	if function, ok := object.(*types.Func); ok {
		return function.FullName()
	}
	return ""
}
