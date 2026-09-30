package devcontext

import (
	"go/ast"
	"go/token"
	"strconv"
	"strings"
)

// handlerDeclKind marks internal entities: a function whose signature is an
// HTTP handler. They only exist to link routes to their declaration and are
// removed from the snapshot by linkHandlers.
const handlerDeclKind = "handlerdecl"

// handlerParamTypes are the parameter types of net/http, Gin, Echo, Fiber and
// Chi handlers (Chi uses net/http signatures).
var handlerParamTypes = map[string]bool{
	"http.ResponseWriter": true, "*http.Request": true, "*gin.Context": true,
	"echo.Context": true, "*fiber.Ctx": true, "fiber.Ctx": true,
}

// detectHandlerDecls records functions and methods with a handler signature.
func detectHandlerDecls(rel string, fset *token.FileSet, file *ast.File) []Entity {
	var out []Entity
	for _, decl := range file.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Type.Params == nil || !isHandlerSignature(fn.Type.Params) {
			continue
		}
		recv := ""
		if fn.Recv != nil && len(fn.Recv.List) == 1 {
			recv = strings.TrimPrefix(exprString(fn.Recv.List[0].Type), "*")
		}
		line := fset.Position(fn.Name.Pos()).Line
		out = append(out, Entity{
			ID: handlerDeclKind + ":" + rel + ":" + strconv.Itoa(line), Kind: handlerDeclKind, Label: fn.Name.Name,
			Attrs:      map[string]string{"name": fn.Name.Name, "recv": recv, "file": rel, "line": strconv.Itoa(line)},
			Sources:    []Source{{Detector: "gohandlers", File: rel, Line: line}},
			Confidence: ConfidenceInferred,
		})
	}
	return out
}

func isHandlerSignature(params *ast.FieldList) bool {
	for _, field := range params.List {
		if handlerParamTypes[exprString(field.Type)] {
			return true
		}
	}
	return false
}

func exprString(e ast.Expr) string {
	switch t := e.(type) {
	case *ast.Ident:
		return t.Name
	case *ast.StarExpr:
		return "*" + exprString(t.X)
	case *ast.SelectorExpr:
		return exprString(t.X) + "." + t.Sel.Name
	case *ast.IndexExpr: // generic receiver T[K]
		return exprString(t.X)
	}
	return ""
}

// linkHandlers gives each route the declaration of its handler (declName,
// declFile, declLine) and drops the internal handler entities. A handler
// written as h.UpdateUser or handler.UpdateUser matches a declaration named
// UpdateUser; with several candidates the one in the route's file wins, then
// the only one, otherwise the route stays unlinked (no guess).
func linkHandlers(entities []Entity) []Entity {
	decls := map[string][]Entity{}
	out := entities[:0]
	for _, e := range entities {
		if e.Kind == handlerDeclKind {
			decls[e.Attrs["name"]] = append(decls[e.Attrs["name"]], e)
			continue
		}
		out = append(out, e)
	}
	for i := range out {
		route := &out[i]
		if route.Kind != "route" || route.Attrs["handler"] == "" {
			continue
		}
		expr := route.Attrs["handler"]
		name := expr[strings.LastIndex(expr, ".")+1:]
		decl, ok := pickDecl(decls[name], route.Attrs["handlerFile"])
		if !ok {
			continue
		}
		attrs := make(map[string]string, len(route.Attrs)+3)
		for k, v := range route.Attrs {
			attrs[k] = v
		}
		route.Attrs = attrs // the per-file cache keeps its own map
		route.Attrs["declName"] = name
		if recv := decl.Attrs["recv"]; recv != "" {
			route.Attrs["declName"] = recv + "." + name
		}
		route.Attrs["declFile"], route.Attrs["declLine"] = decl.Attrs["file"], decl.Attrs["line"]
	}
	return out
}

func pickDecl(candidates []Entity, routeFile string) (Entity, bool) {
	if len(candidates) == 1 {
		return candidates[0], true
	}
	for _, c := range candidates {
		if c.Attrs["file"] == routeFile {
			return c, true
		}
	}
	return Entity{}, false
}
