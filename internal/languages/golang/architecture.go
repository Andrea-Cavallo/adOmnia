package golang

import (
	"go/ast"
	"go/token"
	"go/types"
	"path/filepath"
	"sort"
	"strings"

	"golang.org/x/mod/modfile"
	"golang.org/x/tools/go/packages"
	"golang.org/x/tools/go/types/typeutil"
)

// Architecture Explorer: grafo dei package, degli import, delle chiamate e dei moduli, interfacce
// con implementazioni e usi, entry point e servizi (HTTP, gRPC, Kafka, repository, job, CLI).
// Tutto dai tipi di go/packages, senza eseguire codice. Posizioni in offset di byte.

const (
	maxArchFunctions = 20000
	maxArchCalls     = 50000
	maxArchEntries   = 2000
	maxArchExternal  = 60
)

// ArchSite è una posizione nel sorgente: Path e Offset dall'analisi, poi Resolve la traduce in
// percorso relativo al progetto, riga e colonna dell'editor.
type ArchSite struct {
	Path   string `json:"relativePath"`
	Offset int    `json:"-"`
	Line   int    `json:"line"`
	Column int    `json:"column"`
}

// Resolve traduce ogni posizione del report con resolve(percorso, offset).
func (r *ArchitectureReport) Resolve(resolve func(path string, offset int) (string, int, int)) {
	fix := func(site *ArchSite) { site.Path, site.Line, site.Column = resolve(site.Path, site.Offset) }
	for index := range r.Packages {
		fix(&r.Packages[index].Site)
	}
	for index := range r.Functions {
		fix(&r.Functions[index].Site)
	}
	for index := range r.Modules {
		fix(&r.Modules[index].Site)
	}
	for index := range r.Entries {
		fix(&r.Entries[index].Site)
		if r.Entries[index].HandlerSite != nil {
			fix(r.Entries[index].HandlerSite)
		}
		if r.Entries[index].BreakSite != nil {
			fix(r.Entries[index].BreakSite)
		}
	}
	for index := range r.Schemas {
		fix(&r.Schemas[index].Site)
	}
	for index := range r.Queries {
		fix(&r.Queries[index].Site)
	}
	for index := range r.ContextCalls {
		fix(&r.ContextCalls[index].Site)
	}
	for index := range r.Interfaces {
		item := &r.Interfaces[index]
		fix(&item.Site)
		for j := range item.Implementations {
			fix(&item.Implementations[j].Site)
		}
		for j := range item.Users {
			fix(&item.Users[j].Site)
		}
		for j := range item.NearMisses {
			fix(&item.NearMisses[j].Site)
		}
	}
}

// Merge aggiunge il report di un altro modulo (le funzioni condivise compaiono una volta).
func (r *ArchitectureReport) Merge(other ArchitectureReport) {
	seen := make(map[string]bool, len(r.Functions))
	for _, function := range r.Functions {
		seen[function.ID] = true
	}
	for _, function := range other.Functions {
		if !seen[function.ID] {
			r.Functions = append(r.Functions, function)
		}
	}
	r.Packages = append(r.Packages, other.Packages...)
	r.Imports = append(r.Imports, other.Imports...)
	r.PackageCalls = append(r.PackageCalls, other.PackageCalls...)
	r.Calls = append(r.Calls, other.Calls...)
	r.Modules = append(r.Modules, other.Modules...)
	r.Interfaces = append(r.Interfaces, other.Interfaces...)
	r.Entries = append(r.Entries, other.Entries...)
	r.Schemas = append(r.Schemas, other.Schemas...)
	r.Queries = append(r.Queries, other.Queries...)
	r.ContextCalls = append(r.ContextCalls, other.ContextCalls...)
	r.Truncated = r.Truncated || other.Truncated
}

type ArchPackage struct {
	Path     string   `json:"path"`
	Name     string   `json:"name"`
	Dir      string   `json:"-"`
	Module   string   `json:"module,omitempty"`
	Files    int      `json:"files"`
	Site     ArchSite `json:"site"`
	External []string `json:"external"`
	Std      int      `json:"std"`
}

// ArchEdge collega due nodi (package o funzioni) con un peso.
type ArchEdge struct {
	From  string `json:"from"`
	To    string `json:"to"`
	Count int    `json:"count"`
}

type ArchFunction struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Package  string   `json:"package"`
	Abstract bool     `json:"abstract,omitempty"`
	Context  bool     `json:"context,omitempty"` // riceve un context.Context
	Site     ArchSite `json:"site"`
}

type ArchModule struct {
	Path     string   `json:"path"`
	Dir      string   `json:"-"`
	Requires []string `json:"requires"`
	External []string `json:"external"`
	Site     ArchSite `json:"site"`
}

type ArchitectureReport struct {
	Packages     []ArchPackage     `json:"packages"`
	Imports      []ArchEdge        `json:"imports"`
	PackageCalls []ArchEdge        `json:"packageCalls"`
	Functions    []ArchFunction    `json:"functions"`
	Calls        []ArchEdge        `json:"calls"`
	Modules      []ArchModule      `json:"modules"`
	Interfaces   []ArchInterface   `json:"interfaces"`
	Entries      []ArchEntry       `json:"entries"`
	Schemas      []ArchSchema      `json:"schemas"`
	Queries      []ArchQuery       `json:"queries"`
	ContextCalls []ArchContextCall `json:"contextCalls"`
	Truncated    bool              `json:"truncated,omitempty"`
}

// funcDecl è la dichiarazione di una funzione del progetto con il suo file.
type funcDecl struct {
	decl *ast.FuncDecl
	file typedFile
}

type architecture struct {
	decls          map[*types.Func]funcDecl
	middlewareSeen map[string]bool
	schemaNames    map[string]string // tipo → nome dello schema
	schemaTaken    map[string]bool
	fset           *token.FileSet
	files          []typedFile
	project        map[string]bool // import path dei package del progetto
	report         ArchitectureReport
	functions      map[string]*ArchFunction
	calls          map[[2]string]int
	pkgCalls       map[[2]string]int
	kafkaGroups    map[string]map[string]bool // package → consumer groups named in it
	readerTopics   map[string]map[string]bool // package → topics of consumer configs (ReaderConfig) named in it
}

// AnalyzeArchitecture costruisce il modello dell'architettura dai package caricati.
func AnalyzeArchitecture(fset *token.FileSet, loaded []*packages.Package, read func(string) ([]byte, error)) ArchitectureReport {
	a := &architecture{fset: fset, files: typedFiles(loaded, read), project: map[string]bool{}, functions: map[string]*ArchFunction{}, calls: map[[2]string]int{}, pkgCalls: map[[2]string]int{}, kafkaGroups: map[string]map[string]bool{}, readerTopics: map[string]map[string]bool{}}
	a.decls, a.middlewareSeen, a.schemaNames, a.schemaTaken = map[*types.Func]funcDecl{}, map[string]bool{}, map[string]string{}, map[string]bool{}
	for _, file := range a.files {
		a.project[file.pkg.PkgPath] = true
		for _, decl := range file.file.Decls {
			if fn, ok := decl.(*ast.FuncDecl); ok && fn.Body != nil {
				if object, ok := file.pkg.TypesInfo.Defs[fn.Name].(*types.Func); ok {
					a.decls[object] = funcDecl{decl: fn, file: file}
				}
			}
		}
	}
	a.collectPackages(loaded, read)
	a.collectModules(loaded, read)
	for _, file := range a.files {
		a.collectCalls(file)
	}
	a.collectContextFlow()
	a.collectInterfaces()
	a.collectEntries()
	a.finish()
	return a.report
}

func (a *architecture) site(pos token.Pos) ArchSite {
	position := a.fset.Position(pos)
	return ArchSite{Path: filepath.Clean(position.Filename), Offset: position.Offset}
}

func isTestVariant(pkg *packages.Package) bool {
	return strings.HasSuffix(pkg.ID, ".test") || strings.HasSuffix(pkg.Name, "_test") || strings.Contains(pkg.ID, " [")
}

func isStdPath(path string) bool {
	first, _, _ := strings.Cut(path, "/")
	return !strings.Contains(first, ".")
}

func (a *architecture) collectPackages(loaded []*packages.Package, read func(string) ([]byte, error)) {
	imports := map[[2]string]bool{}
	for _, pkg := range loaded {
		if isTestVariant(pkg) || len(pkg.GoFiles) == 0 || !a.project[pkg.PkgPath] {
			continue
		}
		if _, err := read(pkg.GoFiles[0]); err != nil {
			continue
		}
		entry := ArchPackage{Path: pkg.PkgPath, Name: pkg.Name, Dir: filepath.Dir(pkg.GoFiles[0]), Files: len(pkg.GoFiles), External: []string{}, Site: ArchSite{Path: filepath.Clean(pkg.GoFiles[0])}}
		if pkg.Module != nil {
			entry.Module = pkg.Module.Path
		}
		for path := range pkg.Imports {
			switch {
			case a.project[path]:
				imports[[2]string{pkg.PkgPath, path}] = true
			case isStdPath(path):
				entry.Std++
			case len(entry.External) < maxArchExternal:
				entry.External = append(entry.External, path)
			}
		}
		sort.Strings(entry.External)
		a.report.Packages = append(a.report.Packages, entry)
	}
	for edge := range imports {
		a.report.Imports = append(a.report.Imports, ArchEdge{From: edge[0], To: edge[1], Count: 1})
	}
}

func (a *architecture) collectModules(loaded []*packages.Package, read func(string) ([]byte, error)) {
	seen := map[string]*packages.Module{}
	for _, pkg := range loaded {
		if pkg.Module != nil && pkg.Module.GoMod != "" {
			seen[pkg.Module.Path] = pkg.Module
		}
	}
	for path, module := range seen {
		data, err := read(module.GoMod)
		if err != nil {
			continue
		}
		entry := ArchModule{Path: path, Dir: module.Dir, Requires: []string{}, External: []string{}, Site: ArchSite{Path: filepath.Clean(module.GoMod)}}
		if file, err := modfile.ParseLax(module.GoMod, data, nil); err == nil {
			for _, require := range file.Require {
				if require.Indirect {
					continue
				}
				if _, local := seen[require.Mod.Path]; local {
					entry.Requires = append(entry.Requires, require.Mod.Path)
				} else if len(entry.External) < maxArchExternal {
					entry.External = append(entry.External, require.Mod.Path+"@"+require.Mod.Version)
				}
			}
		}
		a.report.Modules = append(a.report.Modules, entry)
	}
}

// function registra (una volta) un nodo del grafo delle chiamate.
func (a *architecture) function(object *types.Func) *ArchFunction {
	id := object.FullName()
	if existing, ok := a.functions[id]; ok {
		return existing
	}
	if len(a.functions) >= maxArchFunctions {
		a.report.Truncated = true
		return nil
	}
	name := object.Name()
	abstract := false
	if signature, ok := object.Type().(*types.Signature); ok && signature.Recv() != nil {
		receiver := signature.Recv().Type()
		if pointer, ok := receiver.(*types.Pointer); ok {
			receiver = pointer.Elem()
		}
		if named, ok := receiver.(*types.Named); ok {
			name = named.Obj().Name() + "." + name
		}
		_, abstract = receiver.Underlying().(*types.Interface)
	}
	entry := &ArchFunction{ID: id, Name: name, Package: object.Pkg().Path(), Abstract: abstract, Site: a.site(object.Pos())}
	a.functions[id] = entry
	return entry
}

// collectCalls aggiunge gli archi statici chiamante → chiamato tra funzioni del progetto
// (le chiamate attraverso un'interfaccia puntano al metodo dell'interfaccia).
func (a *architecture) collectCalls(file typedFile) {
	info := file.pkg.TypesInfo
	for _, decl := range file.file.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Body == nil {
			continue
		}
		caller, _ := info.Defs[fn.Name].(*types.Func)
		if caller == nil {
			continue
		}
		from := a.function(caller)
		if from == nil {
			return
		}
		ast.Inspect(fn.Body, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			callee, _ := typeutil.Callee(info, call).(*types.Func)
			if callee == nil || callee.Pkg() == nil || !a.project[callee.Pkg().Path()] {
				return true
			}
			to := a.function(callee)
			if to == nil {
				return true
			}
			if len(a.calls) < maxArchCalls {
				a.calls[[2]string{from.ID, to.ID}]++
			} else {
				a.report.Truncated = true
			}
			if from.Package != to.Package {
				a.pkgCalls[[2]string{from.Package, to.Package}]++
			}
			return true
		})
	}
}

func (a *architecture) finish() {
	a.fillKafkaGroups()
	for _, function := range a.functions {
		a.report.Functions = append(a.report.Functions, *function)
	}
	for edge, count := range a.calls {
		a.report.Calls = append(a.report.Calls, ArchEdge{From: edge[0], To: edge[1], Count: count})
	}
	for edge, count := range a.pkgCalls {
		a.report.PackageCalls = append(a.report.PackageCalls, ArchEdge{From: edge[0], To: edge[1], Count: count})
	}
	byEdge := func(edges []ArchEdge) {
		sort.Slice(edges, func(i, j int) bool {
			if edges[i].From != edges[j].From {
				return edges[i].From < edges[j].From
			}
			return edges[i].To < edges[j].To
		})
	}
	byEdge(a.report.Imports)
	byEdge(a.report.Calls)
	byEdge(a.report.PackageCalls)
	sort.Slice(a.report.Functions, func(i, j int) bool { return a.report.Functions[i].ID < a.report.Functions[j].ID })
	sort.Slice(a.report.Packages, func(i, j int) bool { return a.report.Packages[i].Path < a.report.Packages[j].Path })
	sort.Slice(a.report.Modules, func(i, j int) bool { return a.report.Modules[i].Path < a.report.Modules[j].Path })
	sort.SliceStable(a.report.Entries, func(i, j int) bool {
		if a.report.Entries[i].Kind != a.report.Entries[j].Kind {
			return a.report.Entries[i].Kind < a.report.Entries[j].Kind
		}
		return a.report.Entries[i].Name < a.report.Entries[j].Name
	})
	for _, slice := range []*[]ArchEdge{&a.report.Imports, &a.report.Calls, &a.report.PackageCalls} {
		if *slice == nil {
			*slice = []ArchEdge{}
		}
	}
	if a.report.Packages == nil {
		a.report.Packages = []ArchPackage{}
	}
	if a.report.Functions == nil {
		a.report.Functions = []ArchFunction{}
	}
	if a.report.Modules == nil {
		a.report.Modules = []ArchModule{}
	}
	if a.report.Interfaces == nil {
		a.report.Interfaces = []ArchInterface{}
	}
	if a.report.Entries == nil {
		a.report.Entries = []ArchEntry{}
	}
	if a.report.Schemas == nil {
		a.report.Schemas = []ArchSchema{}
	}
	sortSchemas(a.report.Schemas)
	if a.report.Queries == nil {
		a.report.Queries = []ArchQuery{}
	}
	sortQueries(a.report.Queries)
	if a.report.ContextCalls == nil {
		a.report.ContextCalls = []ArchContextCall{}
	}
	sortContextCalls(a.report.ContextCalls)
}
