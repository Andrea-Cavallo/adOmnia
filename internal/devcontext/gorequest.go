package devcontext

import (
	"encoding/json"
	"go/ast"
	"go/token"
	"sort"
	"strconv"
	"strings"
)

// bodyDeclKind marks internal type declarations used to build a request body
// example. Like handler declarations they are removed from the snapshot.
const bodyDeclKind = "bodydecl"

// requestParam is one value the handler reads from the request. The frontend
// turns it into a path/query/header row, so the generated request matches the
// method instead of only its URL.
type requestParam struct {
	Name     string `json:"name"`
	In       string `json:"in"`
	Type     string `json:"type,omitempty"`
	Required bool   `json:"required,omitempty"`
	Default  string `json:"default,omitempty"`
}

type bodyField struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

// handlerRequest extracts the request shape read by a handler body. Detection
// is call-shape based (no type checking), like route detection: unknown
// receivers simply produce no parameter.
func handlerRequest(fn *ast.FuncDecl) ([]requestParam, string) {
	locals := map[string]string{}
	if fn.Type.Params != nil {
		for _, field := range fn.Type.Params.List {
			typ := exprString(field.Type)
			for _, name := range field.Names {
				locals[name.Name] = typ
			}
		}
	}
	params := map[string]requestParam{}
	var bodyType string
	if fn.Body == nil {
		return nil, ""
	}
	ast.Inspect(fn.Body, func(n ast.Node) bool {
		switch node := n.(type) {
		case *ast.AssignStmt:
			for i, lhs := range node.Lhs {
				id, ok := lhs.(*ast.Ident)
				if !ok || i >= len(node.Rhs) {
					continue
				}
				if typ := expressionType(node.Rhs[i]); typ != "" {
					locals[id.Name] = typ
				}
			}
		case *ast.DeclStmt:
			decl, ok := node.Decl.(*ast.GenDecl)
			if !ok || decl.Tok != token.VAR {
				break
			}
			for _, spec := range decl.Specs {
				value, ok := spec.(*ast.ValueSpec)
				if !ok || value.Type == nil {
					continue
				}
				typ := exprString(value.Type)
				for _, name := range value.Names {
					locals[name.Name] = typ
				}
			}
		case *ast.CallExpr:
			collectRequestCall(node, locals, params, &bodyType)
		}
		return true
	})
	out := make([]requestParam, 0, len(params))
	for _, param := range params {
		out = append(out, param)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].In != out[j].In {
			return out[i].In < out[j].In
		}
		return out[i].Name < out[j].Name
	})
	return out, bodyType
}

func expressionType(expr ast.Expr) string {
	switch value := expr.(type) {
	case *ast.CompositeLit:
		return exprString(value.Type)
	case *ast.UnaryExpr:
		if value.Op == token.AND {
			return expressionType(value.X)
		}
	case *ast.CallExpr:
		if fun, ok := value.Fun.(*ast.Ident); ok && fun.Name == "new" && len(value.Args) == 1 {
			return exprString(value.Args[0])
		}
	}
	return ""
}

func collectRequestCall(call *ast.CallExpr, locals map[string]string, params map[string]requestParam, bodyType *string) {
	selector, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		return
	}
	name := selector.Sel.Name
	add := func(in, value, fallback string) {
		if value == "" {
			return
		}
		key := in + "\x00" + value
		param := requestParam{Name: value, In: in, Type: "string", Required: in == "path"}
		if fallback != "" {
			param.Default = fallback
		}
		params[key] = param
	}
	switch name {
	case "Query", "QueryParam", "DefaultQuery", "FormValue":
		if len(call.Args) >= 1 {
			value, _ := stringLit(call.Args[0])
			fallback := ""
			if len(call.Args) >= 2 {
				fallback, _ = stringLit(call.Args[1])
			}
			add("query", value, fallback)
		}
	case "Param", "PathValue", "Params":
		if len(call.Args) >= 1 {
			value, _ := stringLit(call.Args[0])
			add("path", value, "")
		}
	case "URLParam": // chi.URLParam(r, "id")
		if len(call.Args) >= 2 {
			value, _ := stringLit(call.Args[1])
			add("path", value, "")
		}
	case "Get", "GetHeader":
		if len(call.Args) < 1 {
			return
		}
		value, _ := stringLit(call.Args[0])
		switch {
		case name == "GetHeader" || chainHas(selector.X, "Header"):
			add("header", value, "")
		case chainHas(selector.X, "Query"):
			add("query", value, "")
		}
	case "ShouldBindJSON", "BindJSON", "Bind", "ShouldBind", "BodyParser", "Decode":
		if len(call.Args) == 1 {
			if id := referencedIdent(call.Args[0]); id != "" {
				if typ := locals[id]; typ != "" {
					*bodyType = typ
				}
			}
		}
	}
}

func chainHas(expr ast.Expr, name string) bool {
	switch value := expr.(type) {
	case *ast.Ident:
		return value.Name == name
	case *ast.SelectorExpr:
		return value.Sel.Name == name || chainHas(value.X, name)
	case *ast.CallExpr:
		return chainHas(value.Fun, name)
	case *ast.IndexExpr:
		return chainHas(value.X, name)
	}
	return false
}

func referencedIdent(expr ast.Expr) string {
	switch value := expr.(type) {
	case *ast.Ident:
		return value.Name
	case *ast.UnaryExpr:
		if value.Op == token.AND {
			return referencedIdent(value.X)
		}
	case *ast.CallExpr:
		if len(value.Args) == 1 {
			return referencedIdent(value.Args[0])
		}
	}
	return ""
}

func bodyDeclAttrs(name, fullName, example string, fields []bodyField) map[string]string {
	attrs := map[string]string{"name": name, "example": example}
	if fullName != "" {
		attrs["fullName"] = fullName
	}
	if data, err := json.Marshal(fields); err == nil {
		attrs["fields"] = string(data)
	}
	return attrs
}

// requestParamAttrs serialises the extracted request shape for an entity.
func requestParamAttrs(params []requestParam) map[string]string {
	if len(params) == 0 {
		return nil
	}
	data, err := json.Marshal(params)
	if err != nil {
		return nil
	}
	return map[string]string{"requestParams": string(data)}
}

// normalizeBodyType strips pointers/slices and reports whether the body is an
// array, so the example can be wrapped.
func normalizeBodyType(typ string) (string, bool) {
	typ = strings.TrimSpace(typ)
	array := false
	for strings.HasPrefix(typ, "[]") {
		array = true
		typ = strings.TrimPrefix(typ, "[]")
	}
	typ = strings.TrimPrefix(typ, "*")
	return strings.TrimSpace(typ), array
}

// detectBodyDecls records struct declarations and a JSON example built from
// their exported fields and json tags. It covers the request DTOs decoded by Go
// handlers without running the type checker.
func detectBodyDecls(rel string, fset *token.FileSet, file *ast.File) []Entity {
	var out []Entity
	for _, decl := range file.Decls {
		gen, ok := decl.(*ast.GenDecl)
		if !ok || gen.Tok != token.TYPE {
			continue
		}
		for _, spec := range gen.Specs {
			typeSpec, ok := spec.(*ast.TypeSpec)
			if !ok {
				continue
			}
			structType, ok := typeSpec.Type.(*ast.StructType)
			if !ok {
				continue
			}
			fields := goBodyFields(structType)
			example := bodyExample(fields)
			if example == "" {
				continue
			}
			line := fset.Position(typeSpec.Name.Pos()).Line
			out = append(out, Entity{
				ID: bodyDeclKind + ":" + rel + ":" + strconv.Itoa(line), Kind: bodyDeclKind, Label: typeSpec.Name.Name,
				Attrs:      bodyDeclAttrs(typeSpec.Name.Name, "", example, fields),
				Sources:    []Source{{Detector: "gobodies", File: rel, Line: line}},
				Confidence: ConfidenceInferred,
			})
		}
	}
	return out
}

func goBodyFields(structType *ast.StructType) []bodyField {
	var fields []bodyField
	for _, field := range structType.Fields.List {
		if len(field.Names) == 0 {
			continue
		}
		jsonName, skip := jsonTagName(field)
		if skip {
			continue
		}
		typ := exprString(field.Type)
		for _, name := range field.Names {
			if !name.IsExported() {
				continue
			}
			fieldName := name.Name
			if jsonName != "" {
				fieldName = jsonName
			}
			fields = append(fields, bodyField{Name: fieldName, Type: typ})
		}
	}
	return fields
}

func jsonTagName(field *ast.Field) (string, bool) {
	if field.Tag == nil {
		return "", false
	}
	raw, err := strconv.Unquote(field.Tag.Value)
	if err != nil {
		return "", false
	}
	const prefix = `json:"`
	_, rest, found := strings.Cut(raw, prefix)
	if !found {
		return "", false
	}
	value, _, found := strings.Cut(rest, `"`)
	if !found {
		return "", false
	}
	if value == "-" {
		return "", true
	}
	name, _, _ := strings.Cut(value, ",")
	return name, false
}

// bodyExample renders a deterministic JSON object for the given fields.
func bodyExample(fields []bodyField) string {
	if len(fields) == 0 {
		return ""
	}
	var builder strings.Builder
	builder.WriteByte('{')
	for index, field := range fields {
		if index > 0 {
			builder.WriteByte(',')
		}
		builder.WriteString(strconv.Quote(field.Name))
		builder.WriteByte(':')
		builder.WriteString(zeroJSON(field.Type))
	}
	builder.WriteByte('}')
	return builder.String()
}

// zeroJSON is a type-aware placeholder for one field: a valid JSON value of the
// declared kind, or an empty object when the concrete shape is unknown.
func zeroJSON(typ string) string {
	typ = strings.TrimSpace(typ)
	if strings.HasPrefix(typ, "[]") {
		return "[]"
	}
	if strings.HasPrefix(typ, "map[") {
		return "{}"
	}
	typ = strings.TrimPrefix(typ, "*")
	switch typ {
	case "string":
		return `""`
	case "bool":
		return "false"
	case "int", "int8", "int16", "int32", "int64", "uint", "uint8", "uint16", "uint32", "uint64", "float32", "float64", "byte", "rune":
		return "0"
	case "time.Time":
		return `"1970-01-01T00:00:00Z"`
	case "time.Duration":
		return "0"
	case "any", "interface{}":
		return "null"
	}
	if typ == "" {
		return "null"
	}
	// Named types are almost always DTO structs: an empty object is a valid,
	// editable starting point.
	return "{}"
}
