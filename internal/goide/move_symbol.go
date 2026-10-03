package goide

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"go/ast"
	"go/format"
	"go/parser"
	"go/token"
	"go/types"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"golang.org/x/tools/go/ast/astutil"
	"golang.org/x/tools/go/packages"
)

// Move symbol: sposta una dichiarazione di primo livello (func, type con i suoi metodi, var, const)
// in un altro package dello stesso modulo, riscrive riferimenti e import in tutto il modulo e verifica
// che i package toccati compilino ancora (go test -run=^$ con -overlay) prima di proporre le modifiche.
// Nulla viene scritto su disco: il risultato è un WorkspaceChange da mostrare in anteprima.

const moveSymbolTimeout = 5 * time.Minute

// MoveSymbolRequest indica la dichiarazione (posizione del cursore nel file) e la cartella di destinazione.
type MoveSymbolRequest struct {
	RelativePath string `json:"relativePath"`
	// Line e Column sono 1-based, colonna in unità UTF-16 come nell'editor.
	Line   int `json:"line"`
	Column int `json:"column"`
	// TargetDirectory è relativa al progetto; può non esistere ancora (nuovo package).
	TargetDirectory string `json:"targetDirectory"`
}

// MoveSymbol calcola lo spostamento e lo restituisce come anteprima di modifiche multi-file.
func (s *Service) MoveSymbol(sessionID string, request MoveSymbolRequest) (WorkspaceChange, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return WorkspaceChange{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return WorkspaceChange{}, errors.New("autorizza esplicitamente gli strumenti per questo progetto")
	}
	root := session.Project.RealPath
	sourcePath := filepath.Join(root, filepath.FromSlash(request.RelativePath))
	if err := ensureWithinRoot(root, sourcePath); err != nil {
		return WorkspaceChange{}, err
	}
	targetDirectory := filepath.Join(root, filepath.FromSlash(strings.TrimSpace(request.TargetDirectory)))
	if strings.TrimSpace(request.TargetDirectory) == "" || ensureWithinRoot(root, targetDirectory) != nil {
		return WorkspaceChange{}, errors.New("cartella di destinazione non valida")
	}
	moduleRelative := moduleForDir(root, goLayoutOf(session.Project).Modules, path.Dir(filepath.ToSlash(request.RelativePath)))
	moduleDir := filepath.Join(root, filepath.FromSlash(moduleRelative))
	environment, err := s.toolchain.Environment(SessionID(sessionID), nil)
	if err != nil {
		return WorkspaceChange{}, err
	}
	binary, err := s.toolchain.GoBinary(SessionID(sessionID))
	if err != nil {
		return WorkspaceChange{}, err
	}
	environment = withGoFirstInPath(environment, binary)
	ctx, cancel := context.WithTimeout(context.Background(), moveSymbolTimeout)
	defer cancel()
	plan, err := planMove(ctx, environment, moduleDir, sourcePath, request.Line, request.Column, targetDirectory)
	if err != nil {
		return WorkspaceChange{}, err
	}
	if err := verifyMove(ctx, binary, environment, moduleDir, plan); err != nil {
		return WorkspaceChange{}, err
	}
	return plan.workspaceChange(root), nil
}

type movedFile struct {
	path     string
	original string
	content  string
	created  bool
}

type movePlan struct {
	symbol   string
	target   string
	files    []movedFile
	packages []string // directory dei package da ricompilare
}

func (p movePlan) workspaceChange(root string) WorkspaceChange {
	change := WorkspaceChange{Label: fmt.Sprintf("Move %s to %s", p.symbol, p.target), Files: []FileChange{}}
	for _, file := range p.files {
		relative := filepath.ToSlash(relativeWithin(root, file.path))
		item := FileChange{URI: "file://" + filepath.ToSlash(file.path), Path: file.path, RelativePath: relative, NewContent: file.content, OriginalContent: file.original, Created: file.created, Edits: []EditorTextEdit{}}
		if !file.created {
			end := editorPositionAt(file.original, len(file.original))
			item.Edits = []EditorTextEdit{{Range: EditorRange{StartLine: 1, StartColumn: 1, EndLine: end.line, EndColumn: end.column}, Text: file.content}}
		}
		change.Files = append(change.Files, item)
	}
	sort.Slice(change.Files, func(left, right int) bool { return change.Files[left].RelativePath < change.Files[right].RelativePath })
	return change
}

// fileInfo è un file Go del modulo con la sintassi e i tipi della variante di package più completa.
type fileInfo struct {
	pkg  *packages.Package
	file *ast.File
	text []byte
}

type moveContext struct {
	fset       *token.FileSet
	files      map[string]*fileInfo // per percorso assoluto pulito
	byDir      map[string]*packages.Package
	importers  map[string][]string // import path → package che lo importano direttamente
	modulePath string
	moduleDir  string
}

func loadModule(ctx context.Context, environment []string, moduleDir string) (*moveContext, error) {
	config := &packages.Config{
		Context: ctx, Dir: moduleDir, Env: environment, Tests: true, Fset: token.NewFileSet(),
		Mode: packages.NeedName | packages.NeedFiles | packages.NeedCompiledGoFiles | packages.NeedSyntax | packages.NeedTypes | packages.NeedTypesInfo | packages.NeedImports | packages.NeedModule,
	}
	loaded, err := packages.Load(config, "./...")
	if err != nil {
		return nil, fmt.Errorf("analisi del modulo fallita: %w", err)
	}
	result := &moveContext{fset: config.Fset, files: map[string]*fileInfo{}, byDir: map[string]*packages.Package{}, importers: map[string][]string{}, moduleDir: moduleDir}
	var problems []string
	for _, pkg := range loaded {
		for _, loadErr := range pkg.Errors {
			problems = append(problems, loadErr.Error())
		}
		if pkg.Module != nil && result.modulePath == "" {
			result.modulePath = pkg.Module.Path
		}
		for index, name := range pkg.CompiledGoFiles {
			if index >= len(pkg.Syntax) {
				break
			}
			key := filepath.Clean(name)
			// La variante di test di un package contiene anche i file normali: si tiene la più completa.
			if current, ok := result.files[key]; !ok || len(pkg.Syntax) > len(current.pkg.Syntax) {
				text, err := os.ReadFile(name)
				if err != nil {
					return nil, err
				}
				result.files[key] = &fileInfo{pkg: pkg, file: pkg.Syntax[index], text: text}
			}
		}
		if !strings.HasSuffix(pkg.ID, ".test") && !strings.HasSuffix(pkg.Name, "_test") && !strings.Contains(pkg.ID, " [") && len(pkg.GoFiles) > 0 {
			result.byDir[filepath.Clean(filepath.Dir(pkg.GoFiles[0]))] = pkg
		}
		for importPath := range pkg.Imports {
			result.importers[importPath] = appendUnique(result.importers[importPath], pkg.PkgPath)
		}
	}
	if len(problems) > 0 {
		return nil, fmt.Errorf("il modulo non compila, correggi prima questi errori: %s", strings.Join(firstN(problems, 3), "; "))
	}
	return result, nil
}

func planMove(ctx context.Context, environment []string, moduleDir, sourcePath string, line, column int, targetDirectory string) (movePlan, error) {
	module, err := loadModule(ctx, environment, moduleDir)
	if err != nil {
		return movePlan{}, err
	}
	source := module.files[filepath.Clean(sourcePath)]
	if source == nil {
		return movePlan{}, errors.New("il file non fa parte di un package del modulo")
	}
	offset, err := byteOffsetAt(string(source.text), line, column)
	if err != nil {
		return movePlan{}, err
	}
	decl := topLevelDeclAt(module.fset, source.file, offset)
	if decl == nil {
		return movePlan{}, errors.New("posiziona il cursore su una dichiarazione di primo livello (func, type, var o const)")
	}
	primary, err := declaredObject(source.pkg.TypesInfo, decl)
	if err != nil {
		return movePlan{}, err
	}
	sourcePkg := primary.Pkg()
	targetDirectory = filepath.Clean(targetDirectory)
	if filepath.Clean(filepath.Dir(sourcePath)) == targetDirectory {
		return movePlan{}, errors.New("la destinazione è il package di partenza")
	}
	if ensureWithinRoot(moduleDir, targetDirectory) != nil || hasNestedModule(moduleDir, targetDirectory) {
		return movePlan{}, errors.New("la destinazione deve essere nello stesso modulo Go")
	}
	target := module.byDir[targetDirectory]
	targetPath := module.modulePath + "/" + filepath.ToSlash(relativeWithin(moduleDir, targetDirectory))
	targetName := packageNameForDir(targetDirectory)
	if target != nil {
		targetPath, targetName = target.PkgPath, target.Name
	} else if hasGoFiles(targetDirectory) {
		return movePlan{}, errors.New("la cartella di destinazione contiene file Go che non fanno parte di un package valido")
	}
	if targetName == "main" {
		return movePlan{}, errors.New("un package main non si può importare: scegli un altro package")
	}
	if sourcePkg.Name() == "main" {
		return movePlan{}, errors.New("da un package main si possono spostare simboli solo con Move to New File")
	}
	if target != nil && target.Types.Scope().Lookup(primary.Name()) != nil {
		return movePlan{}, fmt.Errorf("%s esiste già in %s", primary.Name(), targetPath)
	}

	moved := movedDecls(module, sourcePkg, decl, primary)
	movedObjects := map[types.Object]bool{primary: true}
	for _, item := range moved {
		if obj, err := declaredObject(item.info.pkg.TypesInfo, item.decl); err == nil {
			movedObjects[obj] = true
		}
	}

	builder := newMoveBuilder(module, sourcePkg, primary, movedObjects, targetPath, targetName)
	if err := builder.analyseMovedCode(moved); err != nil {
		return movePlan{}, err
	}
	if err := builder.rewriteReferences(moved); err != nil {
		return movePlan{}, err
	}
	if err := builder.checkCycles(); err != nil {
		return movePlan{}, err
	}
	files, err := builder.render(moved, targetDirectory)
	if err != nil {
		return movePlan{}, err
	}
	packagesToBuild := []string{filepath.Dir(sourcePath), targetDirectory}
	for _, file := range files {
		packagesToBuild = appendUnique(packagesToBuild, filepath.Dir(file.path))
	}
	return movePlan{symbol: primary.Name(), target: targetPath, files: files, packages: packagesToBuild}, nil
}

type movedDecl struct {
	info *fileInfo
	path string
	decl ast.Decl
}

// movedDecls restituisce la dichiarazione e, per un tipo, tutti i suoi metodi nel package di partenza.
func movedDecls(module *moveContext, sourcePkg *types.Package, decl ast.Decl, primary types.Object) []movedDecl {
	var result []movedDecl
	paths := make([]string, 0, len(module.files))
	for filePath := range module.files {
		paths = append(paths, filePath)
	}
	sort.Strings(paths)
	for _, filePath := range paths {
		info := module.files[filePath]
		if info.pkg.Types != sourcePkg && info.pkg.Types.Path() != sourcePkg.Path() {
			continue
		}
		for _, candidate := range info.file.Decls {
			if candidate == decl {
				result = append([]movedDecl{{info: info, path: filePath, decl: candidate}}, result...)
				continue
			}
			function, ok := candidate.(*ast.FuncDecl)
			if !ok || function.Recv == nil || len(function.Recv.List) == 0 {
				continue
			}
			if _, isType := primary.(*types.TypeName); isType && receiverTypeName(function.Recv.List[0].Type) == primary.Name() && !strings.HasSuffix(filePath, "_test.go") {
				result = append(result, movedDecl{info: info, path: filePath, decl: candidate})
			}
		}
	}
	return result
}

func receiverTypeName(expression ast.Expr) string {
	switch value := expression.(type) {
	case *ast.StarExpr:
		return receiverTypeName(value.X)
	case *ast.IndexExpr:
		return receiverTypeName(value.X)
	case *ast.IndexListExpr:
		return receiverTypeName(value.X)
	case *ast.Ident:
		return value.Name
	}
	return ""
}

func declaredObject(info *types.Info, decl ast.Decl) (types.Object, error) {
	switch value := decl.(type) {
	case *ast.FuncDecl:
		return info.Defs[value.Name], nil
	case *ast.GenDecl:
		if len(value.Specs) != 1 {
			return nil, errors.New("la dichiarazione fa parte di un gruppo: separala prima di spostarla")
		}
		switch spec := value.Specs[0].(type) {
		case *ast.TypeSpec:
			return info.Defs[spec.Name], nil
		case *ast.ValueSpec:
			if len(spec.Names) != 1 {
				return nil, errors.New("la dichiarazione definisce più nomi: separali prima di spostarla")
			}
			return info.Defs[spec.Names[0]], nil
		}
	}
	return nil, errors.New("dichiarazione non supportata")
}

func topLevelDeclAt(fset *token.FileSet, file *ast.File, offset int) ast.Decl {
	base := fset.File(file.Pos())
	if base == nil {
		return nil
	}
	for _, decl := range file.Decls {
		start, end := base.Offset(decl.Pos()), base.Offset(decl.End())
		if offset < start || offset > end {
			continue
		}
		if function, ok := decl.(*ast.FuncDecl); ok && function.Recv != nil {
			return nil // un metodo si sposta insieme al suo tipo
		}
		if general, ok := decl.(*ast.GenDecl); ok && general.Tok == token.IMPORT {
			return nil
		}
		return decl
	}
	return nil
}

// moveBuilder accumula gli edit per file e gli import da aggiungere.
type moveBuilder struct {
	module              *moveContext
	sourcePkg           *types.Package
	primary             types.Object
	moved               map[types.Object]bool
	targetPath          string
	targetName          string
	edits               map[string][]byteEdit        // file non spostati
	movedEdits          map[ast.Decl][]byteEdit      // edit relativi al testo della dichiarazione spostata
	addImports          map[string]map[string]string // file → import path → nome locale ("" = nome del package)
	movedImports        map[string]string            // import necessari al file di destinazione
	targetImportsSource bool
	referencingPkgs     []string
}

func newMoveBuilder(module *moveContext, sourcePkg *types.Package, primary types.Object, moved map[types.Object]bool, targetPath, targetName string) *moveBuilder {
	return &moveBuilder{module: module, sourcePkg: sourcePkg, primary: primary, moved: moved, targetPath: targetPath, targetName: targetName,
		edits: map[string][]byteEdit{}, movedEdits: map[ast.Decl][]byteEdit{}, addImports: map[string]map[string]string{}, movedImports: map[string]string{}}
}

func (b *moveBuilder) isMoved(obj types.Object) bool {
	if obj == nil {
		return false
	}
	if b.moved[obj] {
		return true
	}
	// Gli oggetti della variante di test sono istanze diverse: si confrontano per package, nome e posizione.
	for candidate := range b.moved {
		if candidate.Name() == obj.Name() && candidate.Pos() == obj.Pos() {
			return true
		}
	}
	return false
}

func (b *moveBuilder) offset(pos token.Pos) int {
	return b.module.fset.Position(pos).Offset
}

// analyseMovedCode controlla cosa usa il codice spostato e prepara le qualificazioni nel nuovo package.
func (b *moveBuilder) analyseMovedCode(moved []movedDecl) error {
	for _, item := range moved {
		info := item.info.pkg.TypesInfo
		start := b.offset(declStart(item.decl))
		var problem error
		ast.Inspect(item.decl, func(node ast.Node) bool {
			if problem != nil {
				return false
			}
			switch value := node.(type) {
			case *ast.SelectorExpr:
				if ident, ok := value.X.(*ast.Ident); ok {
					if pkgName, ok := info.Uses[ident].(*types.PkgName); ok {
						imported := pkgName.Imported()
						if imported.Path() == b.targetPath {
							// tgt.Y diventa Y nel package di destinazione.
							b.movedEdits[item.decl] = append(b.movedEdits[item.decl], byteEdit{start: b.offset(value.Pos()) - start, end: b.offset(value.Sel.Pos()) - start, text: ""})
						} else {
							b.movedImports[imported.Path()] = localImportName(pkgName)
						}
						return false
					}
				}
				if selection := info.Selections[value]; selection != nil {
					field := selection.Obj()
					if field.Pkg() == b.sourcePkg && !field.Exported() && !b.isMoved(field) && !b.ownedByMovedType(field) {
						problem = fmt.Errorf("%s usa %s, non esportato in %s: esportalo prima di spostare", b.primary.Name(), field.Name(), b.sourcePkg.Name())
					}
				}
			case *ast.Ident:
				obj := info.Uses[value]
				if obj == nil || obj.Pkg() != b.sourcePkg || b.isMoved(obj) || obj.Parent() != b.sourcePkg.Scope() {
					return true
				}
				if !obj.Exported() {
					problem = fmt.Errorf("%s usa %s, non esportato in %s: esportalo prima di spostare", b.primary.Name(), obj.Name(), b.sourcePkg.Name())
					return false
				}
				b.targetImportsSource = true
				b.movedImports[b.sourcePkg.Path()] = ""
				position := b.offset(value.Pos()) - start
				b.movedEdits[item.decl] = append(b.movedEdits[item.decl], byteEdit{start: position, end: position, text: b.sourcePkg.Name() + "."})
			}
			return true
		})
		if problem != nil {
			return problem
		}
	}
	return nil
}

// ownedByMovedType vale per campi e metodi dei tipi che si spostano insieme.
func (b *moveBuilder) ownedByMovedType(obj types.Object) bool {
	for candidate := range b.moved {
		typeName, ok := candidate.(*types.TypeName)
		if !ok {
			continue
		}
		if named, ok := typeName.Type().(*types.Named); ok {
			for index := 0; index < named.NumMethods(); index++ {
				if named.Method(index) == obj {
					return true
				}
			}
			if structure, ok := named.Underlying().(*types.Struct); ok {
				for index := 0; index < structure.NumFields(); index++ {
					if structure.Field(index) == obj {
						return true
					}
				}
			}
		}
	}
	return false
}

// rewriteReferences riscrive ogni uso del simbolo fuori dal codice spostato.
func (b *moveBuilder) rewriteReferences(moved []movedDecl) error {
	movedRanges := map[string][][2]int{}
	for _, item := range moved {
		movedRanges[item.path] = append(movedRanges[item.path], [2]int{b.offset(declStart(item.decl)), b.offset(item.decl.End())})
	}
	inside := func(filePath string, offset int) bool {
		for _, span := range movedRanges[filePath] {
			if offset >= span[0] && offset <= span[1] {
				return true
			}
		}
		return false
	}
	paths := make([]string, 0, len(b.module.files))
	for filePath := range b.module.files {
		paths = append(paths, filePath)
	}
	sort.Strings(paths)
	for _, filePath := range paths {
		file := b.module.files[filePath]
		info := file.pkg.TypesInfo
		inTarget := file.pkg.PkgPath == b.targetPath || strings.TrimSuffix(file.pkg.PkgPath, "_test") == b.targetPath && file.pkg.Name == b.targetName
		inSource := file.pkg.Types.Path() == b.sourcePkg.Path() && file.pkg.Name == b.sourcePkg.Name()
		var problem error
		ast.Inspect(file.file, func(node ast.Node) bool {
			if problem != nil {
				return false
			}
			switch value := node.(type) {
			case *ast.SelectorExpr:
				ident, ok := value.X.(*ast.Ident)
				if !ok {
					return true
				}
				pkgName, ok := info.Uses[ident].(*types.PkgName)
				if !ok || pkgName.Imported().Path() != b.sourcePkg.Path() || !b.isMoved(info.Uses[value.Sel]) || info.Uses[value.Sel].Name() != b.primary.Name() {
					return true
				}
				if inTarget {
					b.edits[filePath] = append(b.edits[filePath], byteEdit{start: b.offset(value.Pos()), end: b.offset(value.Sel.Pos()), text: ""})
				} else {
					b.edits[filePath] = append(b.edits[filePath], byteEdit{start: b.offset(value.Pos()), end: b.offset(value.Sel.Pos()), text: b.targetName + "."})
					b.requireImport(filePath, b.targetPath)
					b.referencingPkgs = appendUnique(b.referencingPkgs, file.pkg.PkgPath)
				}
				return false
			case *ast.Ident:
				if !inSource || inside(filePath, b.offset(value.Pos())) {
					return true
				}
				obj := info.Uses[value]
				if obj == nil || !b.isMoved(obj) || obj.Name() != b.primary.Name() {
					return true
				}
				if !b.primary.Exported() {
					problem = fmt.Errorf("%s non è esportato ed è usato ancora in %s (%s): esportalo prima di spostarlo", b.primary.Name(), b.sourcePkg.Name(), b.module.fset.Position(value.Pos()))
					return false
				}
				b.edits[filePath] = append(b.edits[filePath], byteEdit{start: b.offset(value.Pos()), end: b.offset(value.Pos()), text: b.targetName + "."})
				b.requireImport(filePath, b.targetPath)
				b.referencingPkgs = appendUnique(b.referencingPkgs, file.pkg.PkgPath)
			}
			return true
		})
		if problem != nil {
			return problem
		}
	}
	return nil
}

func (b *moveBuilder) requireImport(filePath, importPath string) {
	if b.addImports[filePath] == nil {
		b.addImports[filePath] = map[string]string{}
	}
	b.addImports[filePath][importPath] = ""
}

// checkCycles rifiuta lo spostamento se crea un ciclo di import.
func (b *moveBuilder) checkCycles() error {
	// Archi dopo lo spostamento: target → import del codice spostato; chi usa il simbolo → target.
	reaches := func(from, to string, extra map[string][]string) bool {
		seen := map[string]bool{}
		queue := []string{from}
		for len(queue) > 0 {
			current := queue[0]
			queue = queue[1:]
			if current == to {
				return true
			}
			if seen[current] {
				continue
			}
			seen[current] = true
			queue = append(queue, b.importsOf(current)...)
			queue = append(queue, extra[current]...)
		}
		return false
	}
	extra := map[string][]string{}
	for importPath := range b.movedImports {
		extra[b.targetPath] = append(extra[b.targetPath], importPath)
	}
	for _, user := range b.referencingPkgs {
		user = strings.TrimSuffix(user, "_test")
		if user == b.targetPath {
			continue
		}
		if reaches(b.targetPath, user, extra) {
			return fmt.Errorf("spostare %s creerebbe un ciclo di import: %s userebbe %s, che importa già (anche indirettamente) %s", b.primary.Name(), user, b.targetPath, user)
		}
	}
	return nil
}

func (b *moveBuilder) importsOf(importPath string) []string {
	var result []string
	for imported, importers := range b.module.importers {
		for _, importer := range importers {
			if importer == importPath {
				result = append(result, imported)
			}
		}
	}
	return result
}

// render applica gli edit e costruisce il contenuto finale di ogni file toccato.
func (b *moveBuilder) render(moved []movedDecl, targetDirectory string) ([]movedFile, error) {
	movedText := []string{}
	for _, item := range moved {
		start, end := b.offset(declStart(item.decl)), b.offset(item.decl.End())
		text := string(item.info.text[start:end])
		updated, err := applyByteEdits(text, b.movedEdits[item.decl])
		if err != nil {
			return nil, err
		}
		movedText = append(movedText, updated)
		end = extendOverNewlines(item.info.text, end)
		b.edits[item.path] = append(b.edits[item.path], byteEdit{start: start, end: end, text: ""})
	}

	var files []movedFile
	for filePath, edits := range b.edits {
		original := string(b.module.files[filePath].text)
		updated, err := applyByteEdits(original, edits)
		if err != nil {
			return nil, err
		}
		formatted, err := fixImports(updated, b.addImports[filePath])
		if err != nil {
			return nil, fmt.Errorf("%s: %w", filepath.Base(filePath), err)
		}
		files = append(files, movedFile{path: filePath, original: original, content: formatted})
	}

	// Destinazione: un file nuovo con il nome del simbolo, o quello esistente se c'è già.
	destination := filepath.Join(targetDirectory, snakeCase(b.primary.Name())+".go")
	body := strings.Join(movedText, "\n\n") + "\n"
	if existing := b.module.files[filepath.Clean(destination)]; existing != nil {
		original := string(existing.text)
		formatted, err := fixImports(strings.TrimRight(original, "\n")+"\n\n"+body, b.movedImports)
		if err != nil {
			return nil, err
		}
		for index := range files {
			if files[index].path == filepath.Clean(destination) {
				return nil, errors.New("il file di destinazione è anche un file da modificare: scegli un'altra cartella")
			}
		}
		files = append(files, movedFile{path: destination, original: original, content: formatted})
	} else {
		formatted, err := fixImports("package "+b.targetName+"\n\n"+body, b.movedImports)
		if err != nil {
			return nil, err
		}
		files = append(files, movedFile{path: destination, content: formatted, created: true})
	}
	return files, nil
}

// fixImports aggiunge gli import richiesti, toglie quelli rimasti inutilizzati e formatta con gofmt.
func fixImports(source string, required map[string]string) (string, error) {
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "", source, parser.ParseComments)
	if err != nil {
		return "", fmt.Errorf("risultato non valido: %w", err)
	}
	for importPath, name := range required {
		if name != "" && name != path.Base(importPath) {
			astutil.AddNamedImport(fset, file, name, importPath)
		} else {
			astutil.AddImport(fset, file, importPath)
		}
	}
	type unused struct{ name, path string }
	var remove []unused
	for _, spec := range file.Imports {
		importPath := strings.Trim(spec.Path.Value, `"`)
		name := ""
		if spec.Name != nil {
			name = spec.Name.Name
		}
		if name != "_" && name != "." && !astutil.UsesImport(file, importPath) {
			remove = append(remove, unused{name: name, path: importPath})
		}
	}
	// Si cancella dopo il giro: DeleteNamedImport modifica file.Imports.
	for _, item := range remove {
		astutil.DeleteNamedImport(fset, file, item.name, item.path)
	}
	var buffer bytes.Buffer
	if err := format.Node(&buffer, fset, file); err != nil {
		return "", err
	}
	return buffer.String(), nil
}

// verifyMove compila i package toccati con le modifiche in overlay, senza scrivere nel progetto.
func verifyMove(ctx context.Context, binary string, environment []string, moduleDir string, plan movePlan) error {
	overlayDir, err := os.MkdirTemp("", "adomnia-move-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(overlayDir)
	replace := map[string]string{}
	for index, file := range plan.files {
		temporary := filepath.Join(overlayDir, fmt.Sprintf("%d.go", index))
		if err := os.WriteFile(temporary, []byte(file.content), 0o600); err != nil {
			return err
		}
		replace[file.path] = temporary
	}
	overlay, _ := json.Marshal(map[string]any{"Replace": replace})
	overlayFile := filepath.Join(overlayDir, "overlay.json")
	if err := os.WriteFile(overlayFile, overlay, 0o600); err != nil {
		return err
	}
	arguments := []string{"test", "-vet=off", "-overlay", overlayFile, "-count=1", "-run=^$"}
	for _, directory := range plan.packages {
		relative := filepath.ToSlash(relativeWithin(moduleDir, directory))
		if relative == "" || relative == "." {
			arguments = append(arguments, ".")
		} else if !strings.HasPrefix(relative, "..") {
			arguments = append(arguments, "./"+relative)
		}
	}
	command := exec.CommandContext(ctx, binary, arguments...)
	command.Dir = moduleDir
	command.Env = environment
	configureProcess(command, false)
	output, err := command.CombinedOutput()
	if err != nil {
		message := strings.TrimSpace(string(output))
		if len(message) > 1500 {
			message = message[:1500]
		}
		return fmt.Errorf("lo spostamento romperebbe la compilazione, nessuna modifica applicata:\n%s", message)
	}
	return nil
}
