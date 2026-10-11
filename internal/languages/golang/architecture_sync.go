package golang

import (
	"go/ast"
	"go/token"
	"go/types"
	"strings"

	"golang.org/x/tools/go/types/typeutil"
)

// ArchSync è un'operazione che il Go memory model considera di sincronizzazione.
// Kind: go | send | recv | close | lock | unlock | rlock | runlock | atomic | wg-add | wg-done | wg-wait | once.
type ArchSync struct {
	Kind     string   `json:"kind"`
	Target   string   `json:"target"` // l'espressione sincronizzata: "s.orders", "mu", "c.counter"
	Detail   string   `json:"detail,omitempty"`
	Package  string   `json:"package"`
	Function string   `json:"function"`
	Site     ArchSite `json:"site"`
}

const maxArchSync = 20000

func (a *architecture) sourceOf(file typedFile, node ast.Node) string {
	start, end := a.offset(node.Pos()), a.offset(node.End())
	if start < 0 || end > len(file.text) || start >= end {
		return ""
	}
	return strings.Join(strings.Fields(string(file.text[start:end])), " ")
}

// collectSync registra canali, mutex, atomic, WaitGroup, Once e istruzioni go di una funzione.
func (a *architecture) collectSync(file typedFile, fn *ast.FuncDecl, function string) {
	info := file.pkg.TypesInfo
	if info == nil || fn.Body == nil {
		return
	}
	add := func(kind string, target ast.Node, detail string, pos token.Pos) {
		if len(a.report.Syncs) >= maxArchSync {
			return
		}
		text := ""
		if target != nil {
			text = a.sourceOf(file, target)
		}
		a.report.Syncs = append(a.report.Syncs, ArchSync{Kind: kind, Target: text, Detail: detail, Package: file.pkg.PkgPath, Function: function, Site: a.site(pos)})
	}
	isChan := func(expression ast.Expr) bool {
		if t := info.TypeOf(expression); t != nil {
			_, ok := t.Underlying().(*types.Chan)
			return ok
		}
		return false
	}
	ast.Inspect(fn.Body, func(node ast.Node) bool {
		switch node := node.(type) {
		case *ast.GoStmt:
			add("go", node.Call.Fun, a.sourceOf(file, node.Call), node.Pos())
		case *ast.SendStmt:
			add("send", node.Chan, "", node.Pos())
		case *ast.UnaryExpr:
			if node.Op == token.ARROW && isChan(node.X) {
				add("recv", node.X, "", node.Pos())
			}
		case *ast.RangeStmt:
			if isChan(node.X) {
				add("recv", node.X, "range", node.Pos())
			}
		case *ast.CallExpr:
			if ident, ok := node.Fun.(*ast.Ident); ok && ident.Name == "close" && len(node.Args) == 1 && isChan(node.Args[0]) {
				add("close", node.Args[0], "", node.Pos())
				return true
			}
			callee, _ := typeutil.Callee(info, node).(*types.Func)
			if callee == nil || callee.Pkg() == nil {
				return true
			}
			selector, _ := node.Fun.(*ast.SelectorExpr)
			var receiver ast.Node
			if selector != nil {
				receiver = selector.X
			}
			full, name := callee.FullName(), callee.Name()
			switch {
			case strings.HasPrefix(full, "(*sync.Mutex).") || strings.HasPrefix(full, "(*sync.RWMutex)."):
				kinds := map[string]string{"Lock": "lock", "Unlock": "unlock", "RLock": "rlock", "RUnlock": "runlock", "TryLock": "lock"}
				if kind, ok := kinds[name]; ok {
					add(kind, receiver, "", node.Pos())
				}
			case strings.HasPrefix(full, "(*sync.WaitGroup)."):
				kinds := map[string]string{"Add": "wg-add", "Done": "wg-done", "Wait": "wg-wait", "Go": "go"}
				if kind, ok := kinds[name]; ok {
					add(kind, receiver, "", node.Pos())
				}
			case strings.HasPrefix(full, "(*sync.Once).Do"):
				add("once", receiver, "", node.Pos())
			case callee.Pkg().Path() == "sync/atomic":
				if receiver != nil && selector != nil && !isPackageSelector(info, selector) {
					add("atomic", receiver, name, node.Pos())
				} else if len(node.Args) > 0 {
					target := node.Args[0]
					if unary, ok := target.(*ast.UnaryExpr); ok && unary.Op == token.AND {
						target = unary.X
					}
					add("atomic", target, name, node.Pos())
				}
			}
		}
		return true
	})
}

func isPackageSelector(info *types.Info, selector *ast.SelectorExpr) bool {
	ident, ok := selector.X.(*ast.Ident)
	if !ok {
		return false
	}
	_, isPackage := info.Uses[ident].(*types.PkgName)
	return isPackage
}
