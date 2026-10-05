package golang

import (
	"bytes"
	"go/ast"
	"go/doc"
	"go/parser"
	"go/printer"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Documentation Intelligence: la documentazione dei package del progetto letta con go/doc
// (solo parsing, nessun processo) e i simboli esportati senza doc comment, con lo stub da inserire.

const (
	maxDocPackages = 1000
	maxDocDirDepth = 12
)

type DocValue struct {
	Names []string `json:"names"`
	Doc   string   `json:"doc"`
	Decl  string   `json:"decl"`
	Site  ArchSite `json:"site"`
}

type DocFunc struct {
	Name string   `json:"name"`
	Recv string   `json:"recv,omitempty"`
	Doc  string   `json:"doc"`
	Decl string   `json:"decl"`
	Site ArchSite `json:"site"`
}

type DocType struct {
	Name    string     `json:"name"`
	Doc     string     `json:"doc"`
	Decl    string     `json:"decl"`
	Site    ArchSite   `json:"site"`
	Consts  []DocValue `json:"consts"`
	Vars    []DocValue `json:"vars"`
	Funcs   []DocFunc  `json:"funcs"`
	Methods []DocFunc  `json:"methods"`
}

// DocProblem è un simbolo esportato senza documentazione o con un commento che non inizia col nome.
type DocProblem struct {
	Kind    string    `json:"kind"`
	Name    string    `json:"name"`
	Problem string    `json:"problem"`
	Site    ArchSite  `json:"site"`
	Fix     *ErrorFix `json:"fix,omitempty"`
}

type PackageDoc struct {
	ImportPath string              `json:"importPath"`
	Name       string              `json:"name"`
	Dir        string              `json:"dir"`
	Synopsis   string              `json:"synopsis"`
	Doc        string              `json:"doc"`
	Consts     []DocValue          `json:"consts"`
	Vars       []DocValue          `json:"vars"`
	Funcs      []DocFunc           `json:"funcs"`
	Types      []DocType           `json:"types"`
	Notes      map[string][]string `json:"notes"`
	Problems   []DocProblem        `json:"problems"`
	Site       ArchSite            `json:"site"`
}

// PackageDocs legge i package Go sotto root. importPath ricava l'import path di una cartella.
func PackageDocs(root string, importPath func(dir string) string) []PackageDoc {
	result := []PackageDoc{}
	_ = filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil || !entry.IsDir() || len(result) >= maxDocPackages {
			return nil
		}
		name := entry.Name()
		if path != root && (strings.HasPrefix(name, ".") || strings.HasPrefix(name, "_") || name == "testdata" || name == "vendor" || name == "node_modules") {
			return filepath.SkipDir
		}
		if rel, _ := filepath.Rel(root, path); strings.Count(filepath.ToSlash(rel), "/") >= maxDocDirDepth {
			return filepath.SkipDir
		}
		if pkg, ok := packageDocIn(path, importPath(path)); ok {
			result = append(result, pkg)
		}
		return nil
	})
	sort.Slice(result, func(i, j int) bool { return result[i].ImportPath < result[j].ImportPath })
	return result
}

func packageDocIn(dir, importPath string) (PackageDoc, bool) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return PackageDoc{}, false
	}
	fset := token.NewFileSet()
	var files []*ast.File
	texts := map[string][]byte{}
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		path := filepath.Join(dir, name)
		text, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		file, err := parser.ParseFile(fset, path, text, parser.ParseComments)
		if err != nil || (len(files) > 0 && file.Name.Name != files[0].Name.Name) || isIgnoredBuild(file) {
			continue
		}
		files = append(files, file)
		texts[path] = text
	}
	if len(files) == 0 {
		return PackageDoc{}, false
	}
	if importPath == "" {
		importPath = files[0].Name.Name
	}
	docs, err := doc.NewFromFiles(fset, files, importPath)
	if err != nil {
		return PackageDoc{}, false
	}
	builder := docBuilder{fset: fset, texts: texts}
	result := PackageDoc{
		ImportPath: importPath, Name: docs.Name, Dir: dir, Doc: docs.Doc, Synopsis: docs.Synopsis(docs.Doc),
		Consts: builder.values(docs.Consts), Vars: builder.values(docs.Vars), Funcs: builder.funcs(docs.Funcs), Types: []DocType{},
		Notes: map[string][]string{}, Problems: []DocProblem{}, Site: ArchSite{Path: filepath.Clean(fset.Position(files[0].Package).Filename), Offset: fset.Position(files[0].Package).Offset},
	}
	for _, typ := range docs.Types {
		result.Types = append(result.Types, DocType{
			Name: typ.Name, Doc: typ.Doc, Decl: builder.decl(typ.Decl), Site: builder.site(typ.Decl),
			Consts: builder.values(typ.Consts), Vars: builder.values(typ.Vars), Funcs: builder.funcs(typ.Funcs), Methods: builder.funcs(typ.Methods),
		})
	}
	for marker, notes := range docs.Notes {
		for _, note := range notes {
			result.Notes[marker] = append(result.Notes[marker], strings.TrimSpace(note.Body))
		}
	}
	result.Problems = builder.problems(docs, files[0])
	return result, true
}

// isIgnoredBuild scarta i file con //go:build ignore (generatori e simili).
func isIgnoredBuild(file *ast.File) bool {
	for _, group := range file.Comments {
		if group.Pos() >= file.Package {
			break
		}
		for _, comment := range group.List {
			if strings.HasPrefix(comment.Text, "//go:build") && strings.Contains(comment.Text, "ignore") {
				return true
			}
		}
	}
	return false
}

type docBuilder struct {
	fset  *token.FileSet
	texts map[string][]byte
}

func (b docBuilder) site(node ast.Node) ArchSite {
	if node == nil {
		return ArchSite{}
	}
	position := b.fset.Position(node.Pos())
	return ArchSite{Path: filepath.Clean(position.Filename), Offset: position.Offset}
}

// decl stampa la dichiarazione senza corpo e senza commenti, come go doc.
func (b docBuilder) decl(node ast.Node) string {
	switch node := node.(type) {
	case *ast.FuncDecl:
		copy := *node
		copy.Body, copy.Doc = nil, nil
		node = &copy
	case *ast.GenDecl:
		copy := *node
		copy.Doc = nil
		node = &copy
	}
	var buffer bytes.Buffer
	if err := (&printer.Config{Mode: printer.UseSpaces | printer.TabIndent, Tabwidth: 4}).Fprint(&buffer, b.fset, node); err != nil {
		return ""
	}
	text := buffer.String()
	if len(text) > 4000 {
		text = text[:4000] + "\n…"
	}
	return text
}

func (b docBuilder) values(values []*doc.Value) []DocValue {
	result := make([]DocValue, 0, len(values))
	for _, value := range values {
		result = append(result, DocValue{Names: value.Names, Doc: value.Doc, Decl: b.decl(value.Decl), Site: b.site(value.Decl)})
	}
	return result
}

func (b docBuilder) funcs(funcs []*doc.Func) []DocFunc {
	result := make([]DocFunc, 0, len(funcs))
	for _, fn := range funcs {
		result = append(result, DocFunc{Name: fn.Name, Recv: fn.Recv, Doc: fn.Doc, Decl: b.decl(fn.Decl), Site: b.site(fn.Decl)})
	}
	return result
}

// problems: doc mancanti o che non iniziano con il nome (convenzione di go doc e degli IDE).
func (b docBuilder) problems(docs *doc.Package, first *ast.File) []DocProblem {
	var result []DocProblem
	if strings.TrimSpace(docs.Doc) == "" && docs.Name != "main" {
		result = append(result, b.problem("package", docs.Name, first.Package, "Package "+docs.Name))
	}
	check := func(kind, name, text string, node ast.Node, prefix string) {
		if node == nil || !ast.IsExported(name) {
			return
		}
		b.checkDoc(&result, kind, name, text, node, prefix)
	}
	for _, fn := range docs.Funcs {
		check("func", fn.Name, fn.Doc, fn.Decl, fn.Name)
	}
	for _, typ := range docs.Types {
		check("type", typ.Name, typ.Doc, specNode(typ.Decl, typ.Name), typ.Name)
		for _, fn := range typ.Funcs {
			check("func", fn.Name, fn.Doc, fn.Decl, fn.Name)
		}
		for _, method := range typ.Methods {
			check("method", typ.Name+"."+method.Name, method.Doc, method.Decl, method.Name)
		}
	}
	for _, group := range [][]*doc.Value{docs.Consts, docs.Vars} {
		for _, value := range group {
			// Un gruppo const ( … ) documentato sopra copre tutti i nomi.
			if strings.TrimSpace(value.Doc) == "" && len(value.Names) == 1 {
				check(map[token.Token]string{token.CONST: "const", token.VAR: "var"}[value.Decl.Tok], value.Names[0], value.Doc, specNode(value.Decl, value.Names[0]), value.Names[0])
			}
		}
	}
	if result == nil {
		result = []DocProblem{}
	}
	return result
}

// specNode: in un gruppo `type ( … )` o `var ( … )` lo stub va sopra la singola specifica.
func specNode(decl *ast.GenDecl, name string) ast.Node {
	if decl == nil || !decl.Lparen.IsValid() {
		return decl
	}
	for _, spec := range decl.Specs {
		switch spec := spec.(type) {
		case *ast.TypeSpec:
			if spec.Name.Name == name {
				return spec
			}
		case *ast.ValueSpec:
			for _, ident := range spec.Names {
				if ident.Name == name {
					return spec
				}
			}
		}
	}
	return decl
}

func (b docBuilder) checkDoc(result *[]DocProblem, kind, name, text string, node ast.Node, prefix string) {
	text = strings.TrimSpace(text)
	if text == "" {
		*result = append(*result, b.problem(kind, name, node.Pos(), prefix))
		return
	}
	first, _, _ := strings.Cut(text, " ")
	article := first == "A" || first == "An" || first == "The"
	if !strings.HasPrefix(text, prefix) && !(article && strings.HasPrefix(strings.TrimPrefix(text, first+" "), prefix)) {
		*result = append(*result, DocProblem{Kind: kind, Name: name, Problem: "The comment should start with " + prefix, Site: b.site(node)})
	}
}

// problem crea il suggerimento con lo stub "// Nome " sulla riga sopra la dichiarazione.
func (b docBuilder) problem(kind, name string, pos token.Pos, prefix string) DocProblem {
	position := b.fset.Position(pos)
	text := b.texts[position.Filename]
	lineStart := position.Offset
	for lineStart > 0 && text[lineStart-1] != '\n' {
		lineStart--
	}
	indent := ""
	for index := lineStart; index < len(text); {
		r, size := utf8.DecodeRune(text[index:])
		if !unicode.IsSpace(r) || r == '\n' {
			break
		}
		indent += string(r)
		index += size
	}
	stub := indent + "// " + prefix + " \n"
	return DocProblem{
		Kind: kind, Name: name, Problem: "Missing documentation", Site: ArchSite{Path: filepath.Clean(position.Filename), Offset: position.Offset},
		Fix: &ErrorFix{Label: "Add doc comment", Edits: []ErrorEdit{{Offset: lineStart, End: lineStart, Text: stub}}},
	}
}

// Resolve traduce tutte le posizioni della documentazione con resolve(percorso, offset).
func (d *PackageDoc) Resolve(resolve func(path string, offset int) (string, int, int)) {
	fix := func(site *ArchSite) { site.Path, site.Line, site.Column = resolve(site.Path, site.Offset) }
	values := func(items []DocValue) {
		for index := range items {
			fix(&items[index].Site)
		}
	}
	funcs := func(items []DocFunc) {
		for index := range items {
			fix(&items[index].Site)
		}
	}
	fix(&d.Site)
	values(d.Consts)
	values(d.Vars)
	funcs(d.Funcs)
	for index := range d.Types {
		item := &d.Types[index]
		fix(&item.Site)
		values(item.Consts)
		values(item.Vars)
		funcs(item.Funcs)
		funcs(item.Methods)
	}
}
