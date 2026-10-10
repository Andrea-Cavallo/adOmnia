package devcontext

import (
	"go/ast"
	"go/token"
	"go/types"
	"strconv"
	"strings"
)

// unknownPrefix marks a router variable whose prefix is not a literal.
const unknownPrefix = "\x00"

var (
	upperMethods = map[string]bool{"GET": true, "POST": true, "PUT": true, "PATCH": true, "DELETE": true, "HEAD": true, "OPTIONS": true}
	chiMethods   = map[string]string{"Get": "GET", "Post": "POST", "Put": "PUT", "Patch": "PATCH", "Delete": "DELETE", "Head": "HEAD", "Options": "OPTIONS"}
)

// detectRoutes recognises net/http 1.22, gin, echo, chi and gorilla
// registrations by call shape only (no type checking). Prefixes are tracked
// per function and only when they are string literals.
func detectRoutes(rel string, fset *token.FileSet, file *ast.File, hints AdapterHints) []Entity {
	var out []Entity
	methods := routeMethodVerbs(hints)
	for _, decl := range file.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Body == nil {
			continue
		}
		w := &routeWalker{rel: rel, fset: fset, methods: methods, prefixes: map[string]string{}, consumed: map[ast.Node]bool{}}
		w.walk(fn.Body)
		out = append(out, w.out...)
	}
	return out
}

// routeMethodVerbs merges the built-in route registration method names with
// the ones contributed by framework adapters, mapping each to its HTTP verb.
func routeMethodVerbs(hints AdapterHints) map[string]string {
	methods := make(map[string]string, len(upperMethods)+len(chiMethods))
	for name := range upperMethods {
		methods[name] = name
	}
	for name, verb := range chiMethods {
		methods[name] = verb
	}
	for _, fh := range hints.Frameworks {
		for _, name := range fh.RouteMethods {
			methods[name] = strings.ToUpper(name)
		}
	}
	return methods
}

type routeWalker struct {
	rel      string
	fset     *token.FileSet
	methods  map[string]string
	prefixes map[string]string
	consumed map[ast.Node]bool
	out      []Entity
}

func (w *routeWalker) walk(root ast.Node) {
	ast.Inspect(root, func(n ast.Node) bool {
		switch node := n.(type) {
		case *ast.AssignStmt:
			w.trackGroup(node)
		case *ast.CallExpr:
			return w.call(node)
		}
		return true
	})
}

func (w *routeWalker) trackGroup(assign *ast.AssignStmt) {
	if len(assign.Lhs) != 1 || len(assign.Rhs) != 1 {
		return
	}
	lhs, ok := assign.Lhs[0].(*ast.Ident)
	call, ok2 := assign.Rhs[0].(*ast.CallExpr)
	if !ok || !ok2 {
		return
	}
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		return
	}
	if sel.Sel.Name == "Subrouter" { // gorilla: r.PathPrefix("/v2").Subrouter()
		inner, ok := sel.X.(*ast.CallExpr)
		if !ok {
			return
		}
		innerSel, ok := inner.Fun.(*ast.SelectorExpr)
		if !ok {
			return
		}
		call, sel = inner, innerSel
	}
	if (sel.Sel.Name != "Group" && sel.Sel.Name != "PathPrefix") || len(call.Args) == 0 {
		return
	}
	base := w.prefixOf(sel.X)
	lit, ok := stringLit(call.Args[0])
	if !ok || base == unknownPrefix {
		w.prefixes[lhs.Name] = unknownPrefix
		return
	}
	w.prefixes[lhs.Name] = base + lit
}

func (w *routeWalker) prefixOf(x ast.Expr) string {
	if id, ok := x.(*ast.Ident); ok {
		return w.prefixes[id.Name]
	}
	return ""
}

func (w *routeWalker) call(call *ast.CallExpr) bool {
	if w.consumed[call] {
		return true
	}
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		return true
	}
	name, args := sel.Sel.Name, call.Args
	switch {
	case name == "Methods":
		inner, ok := sel.X.(*ast.CallExpr)
		if !ok {
			return true
		}
		innerSel, ok := inner.Fun.(*ast.SelectorExpr)
		if !ok || (innerSel.Sel.Name != "HandleFunc" && innerSel.Sel.Name != "Handle") || len(inner.Args) < 2 {
			return true
		}
		p, ok := stringLit(inner.Args[0])
		if !ok {
			return true
		}
		w.consumed[inner] = true
		for _, arg := range args {
			if method, ok := stringLit(arg); ok {
				w.emit(method, w.prefixOf(innerSel.X), p, inner.Args[1], inner)
			}
		}
	case name == "Route" && len(args) == 2:
		fn, isFn := args[1].(*ast.FuncLit)
		if !isFn {
			return true
		}
		prefix := w.prefixOf(sel.X)
		if p, ok := stringLit(args[0]); ok && prefix != unknownPrefix {
			prefix += p
		} else {
			prefix = unknownPrefix
		}
		saved := w.prefixes
		w.prefixes = make(map[string]string, len(saved)+1)
		for k, v := range saved {
			w.prefixes[k] = v
		}
		if params := fn.Type.Params.List; len(params) == 1 && len(params[0].Names) == 1 {
			w.prefixes[params[0].Names[0].Name] = prefix
		}
		w.walk(fn.Body)
		w.prefixes = saved
		return false
	case (name == "HandleFunc" || name == "Handle") && len(args) >= 2:
		pattern, ok := stringLit(args[0])
		if !ok {
			return true
		}
		method, p := "ANY", pattern
		if m, rest, found := strings.Cut(pattern, " "); found {
			method, p = m, strings.TrimSpace(rest)
		}
		w.emit(method, w.prefixOf(sel.X), p, args[1], call)
	case w.methods[name] != "" && len(args) >= 2:
		if p, ok := stringLit(args[0]); ok {
			w.emit(w.methods[name], w.prefixOf(sel.X), p, args[1], call)
		}
	case (name == "Method" || name == "MethodFunc") && len(args) >= 3:
		method, ok1 := stringLit(args[0])
		p, ok2 := stringLit(args[1])
		if ok1 && ok2 {
			w.emit(method, w.prefixOf(sel.X), p, args[2], call)
		}
	}
	return true
}

func (w *routeWalker) emit(method, prefix, p string, handler ast.Expr, at ast.Node) {
	if !strings.HasPrefix(p, "/") {
		return
	}
	attrs := map[string]string{
		"handler":     types.ExprString(handler),
		"handlerFile": w.rel,
		"handlerLine": strconv.Itoa(w.fset.Position(handler.Pos()).Line),
	}
	full := p
	if prefix == unknownPrefix {
		attrs["partialPrefix"] = "true"
	} else if prefix != "" {
		full = strings.TrimSuffix(prefix, "/") + p
	}
	w.out = append(w.out, routeEntity(strings.ToUpper(method), full, ConfidenceInferred, attrs,
		Source{"goroutes", w.rel, w.fset.Position(at.Pos()).Line}))
}

func stringLit(e ast.Expr) (string, bool) {
	lit, ok := e.(*ast.BasicLit)
	if !ok || lit.Kind != token.STRING {
		return "", false
	}
	s, err := strconv.Unquote(lit.Value)
	return s, err == nil
}
