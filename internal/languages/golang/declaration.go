package golang

import (
	"go/ast"
	"go/parser"
	"go/token"
	"strings"

	"adomnia/internal/ide/lsp"
)

// DeclarationSource restituisce la dichiarazione top-level (con commento di documentazione) che contiene la posizione.
func (*Language) DeclarationSource(text string, at lsp.Position) (string, int, bool) {
	fset := token.NewFileSet()
	file, _ := parser.ParseFile(fset, "", text, parser.ParseComments|parser.SkipObjectResolution)
	offset, err := lsp.OffsetForPosition(text, at)
	if file == nil || err != nil {
		return "", 0, false
	}
	tokenFile := fset.File(file.Pos())
	target := tokenFile.Pos(offset)
	for _, declaration := range file.Decls {
		if target < declaration.Pos() || target >= declaration.End() {
			continue
		}
		start := declaration.Pos()
		if doc := declarationDoc(declaration); doc != nil {
			start = doc.Pos()
		}
		startOffset := tokenFile.Offset(start)
		startOffset -= len(text[:startOffset]) - len(strings.TrimRight(text[:startOffset], " \t"))
		return text[startOffset:tokenFile.Offset(declaration.End())], fset.Position(start).Line, true
	}
	return "", 0, false
}

func declarationDoc(declaration ast.Decl) *ast.CommentGroup {
	switch node := declaration.(type) {
	case *ast.FuncDecl:
		return node.Doc
	case *ast.GenDecl:
		return node.Doc
	}
	return nil
}
