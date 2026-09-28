package goide

import (
	"go/ast"
	"go/parser"
	"go/token"

	"adomnia/internal/goide/lsp"
)

// Tipi di utilizzo mostrati nella vista Usages, ricavati dall'AST e mai da euristiche testuali.
const (
	UsageDeclaration = "declaration"
	UsageWrite       = "write"
	UsageRead        = "read"
	UsageImport      = "import"
)

// classifyUsages assegna a ogni riferimento il tipo di utilizzo, analizzando una sola volta ogni file coinvolto.
func classifyUsages(locations []EditorLocation, textFor func(EditorLocation) string) {
	parsed := map[string]*usageFile{}
	for index := range locations {
		location := &locations[index]
		file, ok := parsed[location.URI]
		if !ok {
			file = parseUsageFile(textFor(*location))
			parsed[location.URI] = file
		}
		location.Usage = file.usageAt(location.Range)
	}
}

type usageFile struct {
	text   string
	fset   *token.FileSet
	syntax *ast.File
}

func parseUsageFile(text string) *usageFile {
	fset := token.NewFileSet()
	// Il parser tollera errori: un buffer in modifica restituisce comunque un AST parziale utile.
	syntax, _ := parser.ParseFile(fset, "", text, parser.SkipObjectResolution)
	return &usageFile{text: text, fset: fset, syntax: syntax}
}

func (f *usageFile) usageAt(value EditorRange) string {
	if f.syntax == nil {
		return ""
	}
	offset, err := lsp.OffsetForPosition(f.text, lspPosition(value.StartLine, value.StartColumn))
	if err != nil {
		return ""
	}
	path := enclosingPath(f.syntax, f.fset.File(f.syntax.Pos()), offset)
	if len(path) == 0 {
		return ""
	}
	return usageOf(path)
}

// enclosingPath restituisce i nodi che racchiudono l'offset, fermandosi sull'identificatore che vi inizia.
func enclosingPath(file *ast.File, tokenFile *token.File, offset int) []ast.Node {
	if tokenFile == nil || offset > tokenFile.Size() {
		return nil
	}
	target := tokenFile.Pos(offset)
	var path []ast.Node
	found := false
	ast.Inspect(file, func(node ast.Node) bool {
		if found || node == nil {
			return false
		}
		if target < node.Pos() || target >= node.End() {
			return false
		}
		path = append(path, node)
		if ident, ok := node.(*ast.Ident); ok && ident.Pos() == target {
			found = true
		}
		return !found
	})
	return path
}

func usageOf(path []ast.Node) string {
	for _, node := range path {
		if _, ok := node.(*ast.ImportSpec); ok {
			return UsageImport
		}
	}
	ident, ok := path[len(path)-1].(*ast.Ident)
	if !ok {
		return ""
	}
	parent := nodeAt(path, len(path)-2)
	if isDeclaration(ident, parent, nodeAt(path, len(path)-3)) {
		return UsageDeclaration
	}
	if isWrite(ident, path) {
		return UsageWrite
	}
	return UsageRead
}

func nodeAt(path []ast.Node, index int) ast.Node {
	if index < 0 {
		return nil
	}
	return path[index]
}

func isDeclaration(ident *ast.Ident, parent, grandparent ast.Node) bool {
	switch node := parent.(type) {
	case *ast.FuncDecl:
		return node.Name == ident
	case *ast.TypeSpec:
		return node.Name == ident
	case *ast.ValueSpec:
		return containsIdent(node.Names, ident)
	case *ast.Field:
		return containsIdent(node.Names, ident)
	case *ast.LabeledStmt:
		return node.Label == ident
	case *ast.AssignStmt:
		return node.Tok == token.DEFINE && containsExpr(node.Lhs, ident)
	case *ast.RangeStmt:
		return node.Tok == token.DEFINE && (node.Key == ident || node.Value == ident)
	}
	return false
}

// isWrite riconosce assegnamenti e incrementi, anche tramite selettore (x.campo = …).
func isWrite(ident *ast.Ident, path []ast.Node) bool {
	target := ast.Expr(ident)
	index := len(path) - 2
	if selector, ok := nodeAt(path, index).(*ast.SelectorExpr); ok && selector.Sel == ident {
		target = selector
		index--
	}
	switch node := nodeAt(path, index).(type) {
	case *ast.AssignStmt:
		return containsExpr(node.Lhs, target)
	case *ast.IncDecStmt:
		return node.X == target
	case *ast.RangeStmt:
		return node.Key == target || node.Value == target
	}
	return false
}

func containsIdent(names []*ast.Ident, ident *ast.Ident) bool {
	for _, name := range names {
		if name == ident {
			return true
		}
	}
	return false
}

func containsExpr(expressions []ast.Expr, target ast.Expr) bool {
	for _, expression := range expressions {
		if expression == target {
			return true
		}
	}
	return false
}
