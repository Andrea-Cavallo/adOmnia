package devcontext

import (
	"go/ast"
	"go/token"
	"maps"
	"slices"
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
func detectHandlerDecls(rel string, fset *token.FileSet, file *ast.File, hints AdapterHints) []Entity {
	var out []Entity
	for _, decl := range file.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Type.Params == nil || !isHandlerSignature(fn.Type.Params, hints) {
			continue
		}
		recv := ""
		if fn.Recv != nil && len(fn.Recv.List) == 1 {
			recv = strings.TrimPrefix(exprString(fn.Recv.List[0].Type), "*")
		}
		line := fset.Position(fn.Name.Pos()).Line
		attrs := map[string]string{"name": fn.Name.Name, "recv": recv, "file": rel, "line": strconv.Itoa(line)}
		params, bodyType := handlerRequest(fn)
		for key, value := range requestParamAttrs(params) {
			attrs[key] = value
		}
		if bodyType != "" {
			name, array := normalizeBodyType(bodyType)
			if name != "" {
				attrs["requestBodyType"] = name
				if array {
					attrs["requestBodyArray"] = "true"
				}
				attrs["requestContentType"] = "application/json"
			}
		}
		out = append(out, Entity{
			ID: handlerDeclKind + ":" + rel + ":" + strconv.Itoa(line), Kind: handlerDeclKind, Label: fn.Name.Name,
			Attrs:      attrs,
			Sources:    []Source{{Detector: "gohandlers", File: rel, Line: line}},
			Confidence: ConfidenceInferred,
		})
	}
	return out
}

func isHandlerSignature(params *ast.FieldList, hints AdapterHints) bool {
	for _, field := range params.List {
		t := exprString(field.Type)
		if handlerParamTypes[t] {
			return true
		}
		for _, fh := range hints.Frameworks {
			if slices.Contains(fh.HandlerTypes, t) {
				return true
			}
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
	case *ast.ArrayType:
		return "[]" + exprString(t.Elt)
	case *ast.MapType:
		return "map[" + exprString(t.Key) + "]" + exprString(t.Value)
	case *ast.InterfaceType:
		return "interface{}"
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
	bodies := map[string][]Entity{}
	var configs []Entity
	out := entities[:0]
	for _, e := range entities {
		switch e.Kind {
		case handlerDeclKind:
			decls[e.Attrs["name"]] = append(decls[e.Attrs["name"]], e)
			continue
		case bodyDeclKind:
			bodies[e.Attrs["name"]] = append(bodies[e.Attrs["name"]], e)
			continue
		case springConfigKind:
			configs = append(configs, e)
			continue
		}
		out = append(out, e)
	}
	prefix := javaContextPath(configs)
	for i := range out {
		route := &out[i]
		if route.Kind != "route" {
			continue
		}
		applyContextPath(route, prefix)
		if route.Attrs["handler"] != "" {
			expr := route.Attrs["handler"]
			name := handlerName(expr)
			decl, ok := pickDecl(decls[name], route.Attrs["handlerFile"])
			if ok {
				attrs := make(map[string]string, len(route.Attrs)+8)
				maps.Copy(attrs, route.Attrs)
				route.Attrs = attrs // the per-file cache keeps its own map
				route.Attrs["declName"] = name
				if recv := decl.Attrs["recv"]; recv != "" {
					route.Attrs["declName"] = recv + "." + name
				}
				route.Attrs["declFile"], route.Attrs["declLine"] = decl.Attrs["file"], decl.Attrs["line"]
				for _, key := range []string{"requestParams", "requestBodyType", "requestBodyArray", "requestContentType"} {
					if value := decl.Attrs[key]; value != "" {
						route.Attrs[key] = value
					}
				}
			} else if name == "" {
				// A closure is declared at the registration itself: it is still a
				// navigable handler, with the registration line as its declaration.
				route.Attrs["declName"] = "(closure)"
				route.Attrs["declFile"] = route.Attrs["handlerFile"]
				route.Attrs["declLine"] = route.Attrs["handlerLine"]
			}
		}
		linkRequestBody(route, bodies)
	}
	return out
}

// handlerName finds the handler identifier inside a route expression, including
// wrappers such as http.HandlerFunc(h.Get) or middleware(h.Get). A function
// literal has no name: the registration line is used as its declaration.
func handlerName(expr string) string {
	if strings.Contains(expr, "func(") {
		return ""
	}
	last := ""
	for index := 0; index < len(expr); index++ {
		if !isIdentStart(expr[index]) {
			continue
		}
		end := index + 1
		for end < len(expr) && isIdentPart(expr[end]) {
			end++
		}
		token := expr[index:end]
		switch token {
		case "http", "Handler", "HandlerFunc", "gin", "echo", "fiber", "chi", "mux", "WrapH", "WrapF", "adapt":
			// package or wrapper: not the handler itself
		default:
			last = token
		}
		index = end - 1
	}
	return last
}

func isIdentStart(value byte) bool {
	return value == '_' || value >= 'a' && value <= 'z' || value >= 'A' && value <= 'Z'
}

func isIdentPart(value byte) bool {
	return isIdentStart(value) || value >= '0' && value <= '9'
}

// linkRequestBody resolves the DTO decoded by a handler into a request body
// example. The declaration in the route's own file wins, then the unique match;
// an ambiguous DTO stays unlinked rather than producing a wrong body.
func linkRequestBody(route *Entity, bodies map[string][]Entity) {
	bodyType := route.Attrs["requestBodyType"]
	candidates := bodies[bodyType]
	if len(candidates) == 0 {
		candidates = bodies[bodyType[strings.LastIndex(bodyType, ".")+1:]]
	}
	if len(candidates) == 0 {
		return
	}
	if qualified := bodyType; strings.Contains(qualified, ".") {
		var matched []Entity
		for _, candidate := range candidates {
			if candidate.Attrs["fullName"] == qualified {
				matched = append(matched, candidate)
			}
		}
		if len(matched) > 0 {
			candidates = matched
		}
	}
	decl, ok := pickDecl(candidates, route.Attrs["declFile"])
	if !ok {
		return
	}
	example := resolvedBodyExample(decl, bodies, route.Attrs["declFile"])
	if example == "" {
		return
	}
	if route.Attrs["requestBodyArray"] == "true" {
		example = "[" + example + "]"
	}
	route.Attrs["requestBody"] = example
	if route.Attrs["requestContentType"] == "" {
		route.Attrs["requestContentType"] = "application/json"
	}
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
