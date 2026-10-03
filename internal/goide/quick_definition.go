package goide

import (
	"context"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"strings"

	"adomnia/internal/ide/lsp"
)

const maxQuickDefinitionLines = 120

// QuickDefinitionResult è il sorgente della dichiarazione da mostrare in popup, senza lasciare il file corrente.
type QuickDefinitionResult struct {
	Found     bool           `json:"found"`
	Location  EditorLocation `json:"location"`
	Code      string         `json:"code"`
	StartLine int            `json:"startLine"`
	Truncated bool           `json:"truncated"`
}

// QuickDefinition risolve la definizione con gopls e ne estrae la dichiarazione completa tramite AST.
func (m *LSPManager) QuickDefinition(ctx context.Context, sessionID SessionID, documentID DocumentID, line, column int) (QuickDefinitionResult, error) {
	locations, err := m.Locations(ctx, sessionID, documentID, "definition", line, column)
	if err != nil || len(locations) == 0 {
		return QuickDefinitionResult{}, err
	}
	state, ok := m.forDocument(sessionID, documentID)
	if !ok {
		return QuickDefinitionResult{}, fmt.Errorf("documento non sincronizzato con un language server")
	}
	location := locations[0]
	text := m.documentText(state, location.URI, location.Path)
	code, startLine, truncated := declarationSource(text, location.Range)
	return QuickDefinitionResult{Found: code != "", Location: location, Code: code, StartLine: startLine, Truncated: truncated}, nil
}

// declarationSource restituisce la dichiarazione top-level (con commento di documentazione) che contiene la posizione.
func declarationSource(text string, at EditorRange) (string, int, bool) {
	fset := token.NewFileSet()
	file, _ := parser.ParseFile(fset, "", text, parser.ParseComments|parser.SkipObjectResolution)
	offset, err := lsp.OffsetForPosition(text, lspPosition(at.StartLine, at.StartColumn))
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
		return clipLines(text[startOffset:tokenFile.Offset(declaration.End())], fset.Position(start).Line)
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

func clipLines(code string, startLine int) (string, int, bool) {
	lines := strings.Split(code, "\n")
	if len(lines) <= maxQuickDefinitionLines {
		return code, startLine, false
	}
	return strings.Join(lines[:maxQuickDefinitionLines], "\n"), startLine, true
}
