package golang

import (
	"go/ast"
	"go/types"
	"sort"

	"golang.org/x/tools/go/types/typeutil"
)

// Flusso di context.Context tra le funzioni del progetto, anche fra package diversi: per ogni
// chiamata a una funzione che accetta un context, cosa le passa il chiamante. Origin "param" = il
// context ricevuto dal chiamante (o un suo derivato), "root" = Background/TODO/WithoutCancel,
// "other" = campo, risultato di funzione o altro non seguito.

type ArchContextCall struct {
	From    string   `json:"from"`
	To      string   `json:"to"`
	Origin  string   `json:"origin"`
	Timeout bool     `json:"timeout,omitempty"`
	Site    ArchSite `json:"site"`
}

type ctxOrigin struct {
	origin  string
	timeout bool
}

func isContextType(t types.Type) bool {
	named, ok := t.(*types.Named)
	return ok && named.Obj().Pkg() != nil && named.Obj().Pkg().Path() == "context" && named.Obj().Name() == "Context"
}

func (a *architecture) collectContextFlow() {
	for object, decl := range a.decls {
		info := decl.file.pkg.TypesInfo
		signature, _ := object.Type().(*types.Signature)
		from := a.function(object)
		if signature == nil || from == nil {
			continue
		}
		vars := map[types.Object]ctxOrigin{}
		for index := 0; index < signature.Params().Len(); index++ {
			if param := signature.Params().At(index); isContextType(param.Type()) {
				vars[param] = ctxOrigin{origin: "param"}
				from.Context = true
			}
		}
		var origin func(ast.Expr) ctxOrigin
		origin = func(expression ast.Expr) ctxOrigin {
			switch expression := ast.Unparen(expression).(type) {
			case *ast.Ident:
				if found, ok := vars[info.Uses[expression]]; ok {
					return found
				}
			case *ast.CallExpr:
				callee, _ := typeutil.Callee(info, expression).(*types.Func)
				if callee == nil || callee.Pkg() == nil || callee.Pkg().Path() != "context" {
					break
				}
				switch callee.Name() {
				case "Background", "TODO", "WithoutCancel":
					return ctxOrigin{origin: "root"}
				case "WithTimeout", "WithDeadline", "WithTimeoutCause", "WithDeadlineCause":
					if len(expression.Args) > 0 {
						parent := origin(expression.Args[0])
						return ctxOrigin{origin: parent.origin, timeout: true}
					}
				case "WithCancel", "WithCancelCause", "WithValue":
					if len(expression.Args) > 0 {
						return origin(expression.Args[0])
					}
				}
			}
			return ctxOrigin{origin: "other"}
		}
		remember := func(name ast.Expr, value ast.Expr) {
			ident, ok := name.(*ast.Ident)
			if !ok || ident.Name == "_" {
				return
			}
			target := info.Defs[ident]
			if target == nil {
				target = info.Uses[ident]
			}
			if target == nil || !isContextType(target.Type()) {
				return
			}
			vars[target] = origin(value)
		}
		ast.Inspect(decl.decl.Body, func(node ast.Node) bool {
			switch node := node.(type) {
			case *ast.AssignStmt:
				// ctx := …, ctx, cancel := context.WithX(…): il context è sempre il primo valore.
				if len(node.Rhs) == 1 && len(node.Lhs) > 0 {
					remember(node.Lhs[0], node.Rhs[0])
				}
			case *ast.ValueSpec:
				if len(node.Values) == 1 && len(node.Names) > 0 {
					remember(node.Names[0], node.Values[0])
				}
			case *ast.CallExpr:
				a.contextCall(info, from, node, origin)
			}
			return true
		})
	}
}

func (a *architecture) contextCall(info *types.Info, from *ArchFunction, call *ast.CallExpr, origin func(ast.Expr) ctxOrigin) {
	callee, _ := typeutil.Callee(info, call).(*types.Func)
	if callee == nil || callee.Pkg() == nil || !a.project[callee.Pkg().Path()] {
		return
	}
	signature, _ := callee.Type().(*types.Signature)
	if signature == nil {
		return
	}
	for index := 0; index < signature.Params().Len() && index < len(call.Args); index++ {
		if !isContextType(signature.Params().At(index).Type()) {
			continue
		}
		to := a.function(callee)
		if to == nil {
			return
		}
		to.Context = true
		if len(a.report.ContextCalls) >= maxArchCalls {
			a.report.Truncated = true
			return
		}
		found := origin(call.Args[index])
		a.report.ContextCalls = append(a.report.ContextCalls, ArchContextCall{From: from.ID, To: to.ID, Origin: found.origin, Timeout: found.timeout, Site: a.site(call.Pos())})
		return
	}
}

func sortContextCalls(calls []ArchContextCall) {
	sort.Slice(calls, func(i, j int) bool {
		if calls[i].Site.Path != calls[j].Site.Path {
			return calls[i].Site.Path < calls[j].Site.Path
		}
		return calls[i].Site.Offset < calls[j].Site.Offset
	})
}
