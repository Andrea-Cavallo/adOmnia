package golang

import (
	"fmt"
	"go/ast"
	"go/constant"
	"go/token"
	"go/types"

	"golang.org/x/tools/go/types/typeutil"
)

// checkReturn classifica l'errore restituito (percorsi d'errore), segnala `return nil, nil`
// sospetti e gli errori di altri package restituiti senza contesto, con il wrapping generato.
func (a *errorAnalysis) checkReturn(fn *errorFunc, statement *ast.ReturnStmt, path *ErrorPath) {
	if !returnsError(fn.signature) {
		return
	}
	results := fn.signature.Results()
	if len(statement.Results) == 0 {
		a.addReturn(path, statement, "named", "named result "+results.At(results.Len()-1).Name())
		return
	}
	if len(statement.Results) != results.Len() {
		a.addReturn(path, statement, "propagate", "result of "+calleeLabel(fn.file.pkg.TypesInfo, statement.Results[0]))
		return
	}
	last := statement.Results[len(statement.Results)-1]
	kind, detail, origin := a.classifyError(fn, last, statement.Pos())
	a.addReturn(path, statement, kind, detail)
	if kind == "nil" {
		a.checkNilNil(fn, statement)
	}
	if origin != nil {
		a.suggestContext(fn, last, origin)
	}
}

func (a *errorAnalysis) addReturn(path *ErrorPath, statement *ast.ReturnStmt, kind, detail string) {
	if path != nil {
		path.Returns = append(path.Returns, ErrorReturn{Offset: a.offset(statement.Pos()), Kind: kind, Detail: detail})
	}
}

// classifyError descrive da dove viene l'errore restituito. origin è la chiamata di un altro
// package il cui errore torna invariato: candidata al wrapping con contesto.
func (a *errorAnalysis) classifyError(fn *errorFunc, expression ast.Expr, before token.Pos) (string, string, *ast.CallExpr) {
	info := fn.file.pkg.TypesInfo
	expression = ast.Unparen(expression)
	if info.Types[expression].IsNil() {
		return "nil", "nil", nil
	}
	if sentinel := sentinelOf(info, expression); sentinel != nil {
		return "sentinel", sentinel.Name(), nil
	}
	switch expression := expression.(type) {
	case *ast.Ident:
		variable, ok := info.Uses[expression].(*types.Var)
		if !ok {
			return "other", expression.Name, nil
		}
		write, found := latestWrite(fn, variable, before)
		if !found || write.value == nil {
			return "propagate", variable.Name(), nil
		}
		call, isCallExpr := ast.Unparen(write.value).(*ast.CallExpr)
		if !isCallExpr {
			return "propagate", variable.Name(), nil
		}
		kind, detail, _ := a.classifyCall(fn, call)
		if kind != "propagate" {
			return kind, detail + " (via " + variable.Name() + ")", nil
		}
		callee := typeutil.Callee(info, call)
		if callee != nil && callee.Pkg() != nil && callee.Pkg() != fn.file.pkg.Types {
			return "propagate", "from " + calleeLabel(info, call), call
		}
		return "propagate", "from " + calleeLabel(info, call), nil
	case *ast.CallExpr:
		kind, detail, _ := a.classifyCall(fn, expression)
		return kind, detail, nil
	case *ast.UnaryExpr:
		if literal, ok := expression.X.(*ast.CompositeLit); ok && expression.Op == token.AND {
			return "typed", "&" + types.TypeString(info.Types[literal].Type, types.RelativeTo(fn.file.pkg.Types)) + "{…}", nil
		}
	case *ast.CompositeLit:
		return "typed", types.TypeString(info.Types[expression].Type, types.RelativeTo(fn.file.pkg.Types)) + "{…}", nil
	}
	return "other", string(fn.file.text[a.offset(expression.Pos()):a.offset(expression.End())]), nil
}

func (a *errorAnalysis) classifyCall(fn *errorFunc, call *ast.CallExpr) (string, string, bool) {
	info := fn.file.pkg.TypesInfo
	callee := typeutil.Callee(info, call)
	if callee == nil {
		return "propagate", "result of a call", false
	}
	switch fullName(callee) {
	case "errors.New":
		return "new", "errors.New(…)", true
	case "errors.Join":
		return "wrap", "errors.Join(…)", true
	case "fmt.Errorf":
		if len(call.Args) > 0 {
			if value := info.Types[call.Args[0]].Value; value != nil && value.Kind() == constant.String {
				verbs, _ := parseFormatVerbs(constant.StringVal(value))
				for _, verb := range verbs {
					if verb.verb == 'w' {
						return "wrap", "fmt.Errorf(… %w …)", true
					}
				}
			}
		}
		return "new", "fmt.Errorf(…) without %w", true
	}
	return "propagate", "from " + calleeLabel(info, call), false
}

func latestWrite(fn *errorFunc, variable *types.Var, before token.Pos) (errorWrite, bool) {
	var best errorWrite
	found := false
	for _, write := range fn.writes[variable] {
		if write.ident.Pos() < before && (!found || write.ident.Pos() > best.ident.Pos()) {
			best, found = write, true
		}
	}
	return best, found
}

func (a *errorAnalysis) checkNilNil(fn *errorFunc, statement *ast.ReturnStmt) {
	info := fn.file.pkg.TypesInfo
	if len(statement.Results) < 2 {
		return
	}
	for index, result := range statement.Results[:len(statement.Results)-1] {
		if !info.Types[result].IsNil() {
			return
		}
		switch underlying := fn.signature.Results().At(index).Type().Underlying().(type) {
		case *types.Interface:
			if underlying.Empty() {
				return // any: "nessun risultato" è un valore legittimo (es. handler JSON-RPC)
			}
		case *types.Pointer, *types.Map, *types.Slice, *types.Chan, *types.Signature:
		default:
			return
		}
	}
	a.add(fn.file, ErrorFinding{Kind: "nil-nil", Severity: "info", Function: fn.name, Message: "return nil, nil: callers cannot tell \"not found\" from success. Return a sentinel error or document it", Offset: a.offset(statement.Pos()), End: a.offset(statement.End())})
}

// suggestContext propone fmt.Errorf("<operazione>: %w", err) per un errore di un altro package restituito tale e quale.
func (a *errorAnalysis) suggestContext(fn *errorFunc, expression ast.Expr, origin *ast.CallExpr) {
	info := fn.file.pkg.TypesInfo
	callee := typeutil.Callee(info, origin)
	if callee == nil {
		return
	}
	original := string(fn.file.text[a.offset(expression.Pos()):a.offset(expression.End())])
	edits := []ErrorEdit{{Offset: a.offset(expression.Pos()), End: a.offset(expression.End()), Original: original, Text: fmt.Sprintf("fmt.Errorf(%q, %s)", humanizeName(callee.Name())+": %w", original)}}
	if edit, ok := a.importEdit(fn.file, "fmt"); ok {
		edits = append(edits, edit)
	}
	a.add(fn.file, ErrorFinding{
		Kind: "lost-context", Severity: "info", Function: fn.name,
		Message: fmt.Sprintf("The error from %s is returned without context: callers will not know which operation of %s failed", calleeLabel(info, origin), fn.name),
		Offset:  a.offset(expression.Pos()), End: a.offset(expression.End()),
		Fix: &ErrorFix{Label: "Wrap with context", Edits: edits},
	})
}

// recordRef registra gli usi di sentinel e tipi d'errore del progetto, con il ruolo nel codice.
func (a *errorAnalysis) recordRef(fn *errorFunc, ident *ast.Ident, stack []ast.Node) {
	info := fn.file.pkg.TypesInfo
	switch object := info.Uses[ident].(type) {
	case *types.Var:
		sentinel := a.sentinels[object]
		if sentinel == nil {
			return
		}
		sentinel.Refs = appendRef(sentinel.Refs, a.ref(fn.file, sentinelRole(info, stack), ident.Pos(), fn.name))
	case *types.TypeName:
		typeInfo := a.errorTypes[object]
		if typeInfo == nil {
			return
		}
		role := "use"
		for index := len(stack) - 1; index >= 0 && role == "use"; index-- {
			switch stack[index].(type) {
			case *ast.CompositeLit:
				role = "new"
			case *ast.TypeAssertExpr, *ast.CaseClause:
				role = "assert"
			case *ast.ValueSpec, *ast.Field:
				role = "declare"
			case ast.Stmt:
				index = -1
			}
		}
		if role != "assert" {
			typeInfo.Refs = appendRef(typeInfo.Refs, a.ref(fn.file, role, ident.Pos(), fn.name))
		}
	}
}

func sentinelRole(info *types.Info, stack []ast.Node) string {
	for index := len(stack) - 1; index >= 0; index-- {
		switch node := stack[index].(type) {
		case *ast.CallExpr:
			if callee := typeutil.Callee(info, node); callee != nil {
				switch fullName(callee) {
				case "errors.Is":
					return "is"
				case "fmt.Errorf", "errors.Join":
					return "wrap"
				}
			}
			return "use"
		case *ast.CompositeLit:
			return "wrap"
		case *ast.BinaryExpr:
			return "compare"
		case *ast.CaseClause:
			return "case"
		case *ast.ReturnStmt:
			return "return"
		case ast.Stmt:
			return "use"
		}
	}
	return "use"
}
