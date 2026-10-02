package goide

import (
	"go/ast"
	"go/parser"
	"go/token"
)

// CoverageBranch è un ramo mai eseguito benché la sua condizione sia stata valutata: l'indizio più
// utile che un profilo per istruzioni può dare sui rami (Go non misura la branch coverage).
type CoverageBranch struct {
	Line int `json:"line"`
	// Kind: "then" (if mai vero), "else" (if mai falso), "case" o "default" di switch/select mai scelti.
	Kind string `json:"kind"`
}

type coveragePosition struct{ line, column int }

func positionBefore(left, right coveragePosition) bool {
	return left.line < right.line || left.line == right.line && left.column <= right.column
}

// untakenBranches analizza if/else e i case di switch e select; i rami vuoti non hanno blocchi e si ignorano.
// Restituisce i rami mai eseguiti e quanti rami con istruzioni hanno la condizione eseguita.
func untakenBranches(text string, blocks []rawCoverageBlock) ([]CoverageBranch, int) {
	fileSet := token.NewFileSet()
	parsed, err := parser.ParseFile(fileSet, "", text, parser.SkipObjectResolution)
	if err != nil {
		return []CoverageBranch{}, 0
	}
	at := func(pos token.Pos) coveragePosition {
		position := fileSet.Position(pos)
		return coveragePosition{position.Line, position.Column}
	}
	executed := func(pos token.Pos) bool {
		point := at(pos)
		for _, block := range blocks {
			if block.count > 0 && positionBefore(coveragePosition{block.startLine, block.startColumn}, point) && positionBefore(point, coveragePosition{block.endLine, block.endColumn}) {
				return true
			}
		}
		return false
	}
	// rangeState: il ramo ha istruzioni (blocchi che iniziano dentro) ed è stato eseguito.
	rangeState := func(from, to token.Pos) (bool, bool) {
		start, end := at(from), at(to)
		has, taken := false, false
		for _, block := range blocks {
			begin := coveragePosition{block.startLine, block.startColumn}
			if positionBefore(start, begin) && positionBefore(begin, end) {
				has = true
				taken = taken || block.count > 0
			}
		}
		return has, taken
	}
	branches := []CoverageBranch{}
	evaluated := 0
	report := func(kind string, line int, from, to token.Pos) {
		if has, taken := rangeState(from, to); has {
			evaluated++
			if !taken {
				branches = append(branches, CoverageBranch{Line: line, Kind: kind})
			}
		}
	}
	ast.Inspect(parsed, func(node ast.Node) bool {
		switch value := node.(type) {
		case *ast.IfStmt:
			if !executed(value.If) {
				return true
			}
			report("then", fileSet.Position(value.If).Line, value.Body.Lbrace, value.Body.Rbrace)
			if nested, ok := value.Else.(*ast.IfStmt); ok {
				// "else if": il ramo è preso quando la condizione annidata viene valutata.
				evaluated++
				if !executed(nested.If) {
					branches = append(branches, CoverageBranch{Line: fileSet.Position(nested.If).Line, Kind: "else"})
				}
			} else if value.Else != nil {
				report("else", fileSet.Position(value.Else.Pos()).Line, value.Else.Pos(), value.Else.End())
			}
		case *ast.SwitchStmt, *ast.TypeSwitchStmt, *ast.SelectStmt:
			if !executed(node.Pos()) {
				return true
			}
			var body *ast.BlockStmt
			switch typed := value.(type) {
			case *ast.SwitchStmt:
				body = typed.Body
			case *ast.TypeSwitchStmt:
				body = typed.Body
			case *ast.SelectStmt:
				body = typed.Body
			}
			for _, clause := range body.List {
				kind, colon, end := "case", token.NoPos, clause.End()
				switch typed := clause.(type) {
				case *ast.CaseClause:
					colon = typed.Colon
					if typed.List == nil {
						kind = "default"
					}
				case *ast.CommClause:
					colon = typed.Colon
					if typed.Comm == nil {
						kind = "default"
					}
				}
				report(kind, fileSet.Position(clause.Pos()).Line, colon, end)
			}
		}
		return true
	})
	return branches, evaluated
}
