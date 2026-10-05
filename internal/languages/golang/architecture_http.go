package golang

import (
	"go/ast"
	"go/types"
	"reflect"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"

	"golang.org/x/tools/go/types/typeutil"
)

// Route HTTP: un adapter per framework dice quali metodi registrano route, dove sta l'handler e
// quali creano sotto-router con prefisso. Aggiungere un framework = una riga in httpFrameworks.

type httpFramework struct {
	label string
	pkg   string            // sottostringa dell'import path
	verbs map[string]string // metodo → verbo HTTP ("" = qualsiasi / dal pattern)
	// handler: indice dell'argomento handler (-1 = l'ultimo). Gli argomenti funzione tra il path e
	// l'handler (o dopo, con middlewareAfter) sono middleware della singola route.
	handler         int
	middlewareAfter bool
	groups          []string // metodi che creano un sotto-router: Group("/api"), Route("/api", func(r){…})
}

var standardVerbs = map[string]string{"GET": "GET", "POST": "POST", "PUT": "PUT", "PATCH": "PATCH", "DELETE": "DELETE", "HEAD": "HEAD", "OPTIONS": "OPTIONS"}

func verbTable(title bool, extra map[string]string) map[string]string {
	table := map[string]string{}
	for name, verb := range standardVerbs {
		if title {
			name = name[:1] + strings.ToLower(name[1:])
		}
		table[name] = verb
	}
	for name, verb := range extra {
		table[name] = verb
	}
	return table
}

var httpFrameworks = []httpFramework{
	{label: "net/http", pkg: "net/http", verbs: map[string]string{"Handle": "", "HandleFunc": ""}, handler: 1},
	{label: "chi", pkg: "go-chi/chi", verbs: verbTable(true, map[string]string{"Handle": "", "HandleFunc": ""}), handler: 1, groups: []string{"Route"}},
	{label: "gin", pkg: "gin-gonic/gin", verbs: verbTable(false, map[string]string{"Any": ""}), handler: -1, groups: []string{"Group"}},
	{label: "echo", pkg: "labstack/echo", verbs: verbTable(false, map[string]string{"Any": ""}), handler: 1, middlewareAfter: true, groups: []string{"Group"}},
	{label: "gorilla/mux", pkg: "gorilla/mux", verbs: map[string]string{"Handle": "", "HandleFunc": ""}, handler: 1},
	{label: "fiber", pkg: "gofiber/fiber", verbs: verbTable(true, map[string]string{"All": ""}), handler: -1, groups: []string{"Group"}},
	{label: "httprouter", pkg: "julienschmidt/httprouter", verbs: verbTable(false, nil), handler: 1},
}

func frameworkFor(packagePath string) *httpFramework {
	for index := range httpFrameworks {
		if strings.Contains(packagePath, httpFrameworks[index].pkg) {
			return &httpFrameworks[index]
		}
	}
	return nil
}

// ArchBody è il tipo del corpo di una richiesta o risposta; Ref punta a uno schema del report.
type ArchBody struct {
	Type  string `json:"type"`
	Ref   string `json:"ref,omitempty"`
	Array bool   `json:"array,omitempty"`
}

// ArchSchema è uno struct usato come DTO, con i campi come li vede JSON.
type ArchSchema struct {
	Name    string      `json:"name"`
	Package string      `json:"package"`
	Fields  []ArchField `json:"fields"`
	Site    ArchSite    `json:"site"`
}

type ArchField struct {
	Name     string `json:"name"`
	GoName   string `json:"goName"`
	Type     string `json:"type"` // string, integer, number, boolean, array, object
	Format   string `json:"format,omitempty"`
	Ref      string `json:"ref,omitempty"`
	Items    string `json:"items,omitempty"` // tipo degli elementi di un array
	Required bool   `json:"required,omitempty"`
}

// routeScope tiene, dentro una funzione, i prefissi e i middleware di ogni router.
type routeScope struct {
	prefix     map[types.Object]string
	middleware map[types.Object][]string
}

func receiverObject(info *types.Info, call *ast.CallExpr) types.Object {
	selector, ok := ast.Unparen(call.Fun).(*ast.SelectorExpr)
	if !ok {
		return nil
	}
	if ident, ok := ast.Unparen(selector.X).(*ast.Ident); ok {
		return info.ObjectOf(ident)
	}
	return nil
}

// collectRoutes registra le route della funzione, con prefissi di gruppo e middleware.
func (a *architecture) collectRoutes(file typedFile, fn *ast.FuncDecl, function string) {
	info := file.pkg.TypesInfo
	scope := routeScope{prefix: map[types.Object]string{}, middleware: map[types.Object][]string{}}
	inspectWithStack(fn.Body, func(node ast.Node, stack []ast.Node) bool {
		switch node := node.(type) {
		case *ast.AssignStmt:
			// api := r.Group("/api") / sub := r.PathPrefix("/v1").Subrouter()
			if len(node.Lhs) == 1 && len(node.Rhs) == 1 {
				if ident, ok := node.Lhs[0].(*ast.Ident); ok {
					if parent, prefix, ok := a.groupPrefix(info, node.Rhs[0], scope); ok {
						target := info.ObjectOf(ident)
						scope.prefix[target] = scope.prefix[parent] + prefix
						scope.middleware[target] = append([]string(nil), scope.middleware[parent]...)
					}
				}
			}
		case *ast.CallExpr:
			a.routeCall(file, node, stack, scope, function)
		}
		return true
	})
}

// groupPrefix riconosce recv.Group("/p"), recv.Route("/p", …) e recv.PathPrefix("/p").Subrouter().
func (a *architecture) groupPrefix(info *types.Info, expression ast.Expr, scope routeScope) (types.Object, string, bool) {
	call, ok := ast.Unparen(expression).(*ast.CallExpr)
	if !ok {
		return nil, "", false
	}
	callee, _ := typeutil.Callee(info, call).(*types.Func)
	if callee == nil || callee.Pkg() == nil {
		return nil, "", false
	}
	if callee.Name() == "Subrouter" {
		if inner, ok := ast.Unparen(call.Fun).(*ast.SelectorExpr); ok {
			if prefixCall, ok := ast.Unparen(inner.X).(*ast.CallExpr); ok && len(prefixCall.Args) == 1 {
				if prefix, ok := constantString(info, prefixCall.Args[0]); ok {
					return receiverObject(info, prefixCall), prefix, true
				}
			}
		}
		return nil, "", false
	}
	framework := frameworkFor(callee.Pkg().Path())
	if framework == nil || !slices.Contains(framework.groups, callee.Name()) || len(call.Args) == 0 {
		return nil, "", false
	}
	prefix, ok := constantString(info, call.Args[0])
	return receiverObject(info, call), prefix, ok
}

func (a *architecture) routeCall(file typedFile, call *ast.CallExpr, stack []ast.Node, scope routeScope, function string) {
	info := file.pkg.TypesInfo
	callee, _ := typeutil.Callee(info, call).(*types.Func)
	if callee == nil || callee.Pkg() == nil {
		return
	}
	framework := frameworkFor(callee.Pkg().Path())
	if framework == nil {
		return
	}
	receiver := receiverObject(info, call)
	name := callee.Name()
	switch {
	case name == "Use":
		for _, argument := range call.Args {
			if handler := a.resolveHandler(info, argument); handler.name != "" {
				scope.middleware[receiver] = append(scope.middleware[receiver], handler.name)
				a.addMiddleware(file, handler, framework.label)
			}
		}
		return
	case slices.Contains(framework.groups, name) && len(call.Args) == 2:
		// chi: r.Route("/api", func(r chi.Router) { … }): il parametro della closure eredita il prefisso.
		if literal, ok := call.Args[1].(*ast.FuncLit); ok && literal.Type.Params.NumFields() == 1 && len(literal.Type.Params.List[0].Names) == 1 {
			if prefix, ok := constantString(info, call.Args[0]); ok {
				target := info.ObjectOf(literal.Type.Params.List[0].Names[0])
				scope.prefix[target] = scope.prefix[receiver] + prefix
				scope.middleware[target] = append([]string(nil), scope.middleware[receiver]...)
			}
		}
		return
	}
	verb, known := framework.verbs[name]
	if !known || len(call.Args) < 2 {
		return
	}
	path, ok := constantString(info, call.Args[0])
	if !ok {
		return
	}
	if framework.label == "net/http" || framework.label == "chi" && verb == "" {
		if method, rest, found := strings.Cut(path, " "); found && standardVerbs[method] != "" {
			verb, path = method, strings.TrimSpace(rest)
		}
	}
	if framework.label == "gorilla/mux" {
		verb = muxMethods(info, call, stack)
	}
	if !strings.HasPrefix(path, "/") {
		return
	}
	handlerIndex := framework.handler
	if handlerIndex < 0 || handlerIndex >= len(call.Args) {
		handlerIndex = len(call.Args) - 1
	}
	entry := ArchEntry{Kind: "http", Name: strings.TrimSpace(verb + " " + scope.prefix[receiver] + path), Detail: framework.label, Package: file.pkg.PkgPath, Function: function, Site: a.site(call.Pos())}
	entry.Middleware = append(entry.Middleware, scope.middleware[receiver]...)
	for index, argument := range call.Args[1:] {
		position := index + 1
		inline := position != handlerIndex && (position > handlerIndex) == framework.middlewareAfter
		if inline {
			if handler := a.resolveHandler(info, argument); handler.name != "" {
				entry.Middleware = append(entry.Middleware, handler.name)
			}
		}
	}
	handler := a.resolveHandler(info, call.Args[handlerIndex])
	entry.Middleware = append(entry.Middleware, handler.wrappers...)
	entry.Handler = handler.name
	if handler.site != nil {
		site := *handler.site
		entry.HandlerSite = &site
	}
	if body := handler.body; body != nil {
		entry.Request, entry.Response = a.handlerBodies(handler.info, body, handler.name)
	}
	a.addEntry(entry)
}

// muxMethods legge .Methods("POST", …) concatenato alla HandleFunc di gorilla/mux.
func muxMethods(info *types.Info, call *ast.CallExpr, stack []ast.Node) string {
	for index := len(stack) - 1; index >= 1; index-- {
		selector, ok := stack[index].(*ast.SelectorExpr)
		if !ok || selector.Sel.Name != "Methods" {
			continue
		}
		if outer, ok := stack[index-1].(*ast.CallExpr); ok && len(outer.Args) > 0 {
			var verbs []string
			for _, argument := range outer.Args {
				if verb, ok := constantString(info, argument); ok {
					verbs = append(verbs, strings.ToUpper(verb))
				}
			}
			return strings.Join(verbs, ",")
		}
	}
	return ""
}

type resolvedHandler struct {
	name     string
	site     *ArchSite
	body     *ast.BlockStmt
	info     *types.Info
	wrappers []string
}

// resolveHandler segue l'espressione dell'handler: funzione, metodo, closure, conversione a
// http.HandlerFunc, wrapper (middleware) e factory che restituiscono una closure.
func (a *architecture) resolveHandler(info *types.Info, expression ast.Expr) resolvedHandler {
	expression = ast.Unparen(expression)
	switch node := expression.(type) {
	case *ast.FuncLit:
		site := a.site(node.Pos())
		return resolvedHandler{name: "func literal", site: &site, body: node.Body, info: info}
	case *ast.Ident, *ast.SelectorExpr:
		var object types.Object
		if selector, ok := node.(*ast.SelectorExpr); ok {
			if selection := info.Selections[selector]; selection != nil {
				object = selection.Obj()
			} else {
				object = info.Uses[selector.Sel]
			}
		} else {
			object = info.Uses[node.(*ast.Ident)]
		}
		if function, ok := object.(*types.Func); ok {
			return a.handlerForFunc(function)
		}
		if object != nil {
			return resolvedHandler{name: object.Name()}
		}
	case *ast.CallExpr:
		if tv, ok := info.Types[node.Fun]; ok && tv.IsType() && len(node.Args) == 1 {
			return a.resolveHandler(info, node.Args[0]) // http.HandlerFunc(h)
		}
		callee, _ := typeutil.Callee(info, node).(*types.Func)
		for _, argument := range node.Args {
			if isHandlerLike(info.Types[argument].Type) {
				inner := a.resolveHandler(info, argument)
				if callee != nil {
					inner.wrappers = append([]string{callee.Name()}, inner.wrappers...)
				}
				return inner
			}
		}
		if callee != nil {
			return a.handlerFactory(callee)
		}
	}
	return resolvedHandler{}
}

func isHandlerLike(t types.Type) bool {
	if t == nil {
		return false
	}
	if _, ok := t.Underlying().(*types.Signature); ok {
		return true
	}
	if named, ok := t.(*types.Named); ok && named.Obj().Pkg() != nil && named.Obj().Pkg().Path() == "net/http" && named.Obj().Name() == "Handler" {
		return true
	}
	if types.IsInterface(t) {
		method, _, _ := types.LookupFieldOrMethod(t, true, nil, "ServeHTTP")
		return method != nil
	}
	return false
}

func (a *architecture) handlerForFunc(function *types.Func) resolvedHandler {
	result := resolvedHandler{name: function.Name(), info: nil}
	if signature, ok := function.Type().(*types.Signature); ok && signature.Recv() != nil {
		if named, ok := pointerElem(signature.Recv().Type()).(*types.Named); ok {
			result.name = named.Obj().Name() + "." + function.Name()
		}
	}
	if declaration, ok := a.decls[function]; ok {
		site := a.site(declaration.decl.Name.Pos())
		result.site = &site
		result.body, result.info = declaration.decl.Body, declaration.file.pkg.TypesInfo
	}
	return result
}

// handlerFactory: s.createOrder() che restituisce func(w, r) { … } → il corpo è la closure restituita.
func (a *architecture) handlerFactory(function *types.Func) resolvedHandler {
	result := a.handlerForFunc(function)
	if result.body == nil {
		return result
	}
	ast.Inspect(result.body, func(node ast.Node) bool {
		if ret, ok := node.(*ast.ReturnStmt); ok && len(ret.Results) == 1 {
			if literal, ok := ast.Unparen(ret.Results[0]).(*ast.FuncLit); ok {
				result.body = literal.Body
				return false
			}
		}
		return true
	})
	return result
}

func (a *architecture) addMiddleware(file typedFile, handler resolvedHandler, framework string) {
	key := framework + ":" + handler.name
	if a.middlewareSeen[key] {
		return
	}
	a.middlewareSeen[key] = true
	entry := ArchEntry{Kind: "middleware", Name: handler.name, Detail: framework, Package: file.pkg.PkgPath}
	if handler.site != nil {
		entry.Site = *handler.site
	}
	a.addEntry(entry)
}

var (
	requestMethods  = map[string]bool{"ShouldBindJSON": true, "BindJSON": true, "ShouldBind": true, "Bind": true, "ShouldBindXML": true, "BodyParser": true, "ShouldBindQuery": true}
	responseMethods = map[string]bool{"JSON": true, "IndentedJSON": true, "PureJSON": true, "SecureJSON": true, "JSONPretty": true, "XML": true}
	responseHelper  = regexp.MustCompile(`(?i)json|respond|render|reply`)
)

// handlerBodies cerca nel corpo dell'handler il tipo decodificato dalla richiesta e quello scritto nella risposta.
func (a *architecture) handlerBodies(info *types.Info, body *ast.BlockStmt, handler string) (*ArchBody, *ArchBody) {
	if info == nil {
		return nil, nil
	}
	var request, response *ArchBody
	ast.Inspect(body, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		callee, _ := typeutil.Callee(info, call).(*types.Func)
		if callee == nil || len(call.Args) == 0 {
			return true
		}
		full, name := callee.FullName(), callee.Name()
		switch {
		case request == nil && (full == "(*encoding/json.Decoder).Decode" || full == "(*encoding/xml.Decoder).Decode" || requestMethods[name] && len(call.Args) == 1):
			request = a.body(info.Types[call.Args[0]].Type, handler+"Request")
		case request == nil && full == "encoding/json.Unmarshal" && len(call.Args) == 2:
			request = a.body(info.Types[call.Args[1]].Type, handler+"Request")
		case response == nil && (full == "(*encoding/json.Encoder).Encode" || responseMethods[name] || callee.Pkg() != nil && a.project[callee.Pkg().Path()] && responseHelper.MatchString(name)):
			last := call.Args[len(call.Args)-1]
			if candidate := a.body(info.Types[last].Type, handler+"Response"); candidate != nil {
				response = candidate
			}
		}
		return true
	})
	return request, response
}

// body descrive un tipo come corpo JSON; nil per tipi che non sono DTO (errori, stringhe, byte…).
func (a *architecture) body(t types.Type, fallback string) *ArchBody {
	if t == nil {
		return nil
	}
	t = pointerElem(t)
	array := false
	if slice, ok := t.Underlying().(*types.Slice); ok {
		if basic, ok := slice.Elem().Underlying().(*types.Basic); ok && basic.Kind() == types.Byte {
			return nil
		}
		t, array = pointerElem(slice.Elem()), true
	}
	if implementsError(t) {
		return nil
	}
	switch underlying := t.Underlying().(type) {
	case *types.Struct:
		name := fallback
		if named, ok := t.(*types.Named); ok {
			name = named.Obj().Name()
		}
		ref := a.schema(t, name, 0)
		return &ArchBody{Type: typeLabel(t), Ref: ref, Array: array}
	case *types.Map:
		return &ArchBody{Type: typeLabel(t), Array: array}
	case *types.Interface:
		if underlying.Empty() {
			return &ArchBody{Type: "any", Array: array}
		}
	}
	return nil
}

func typeLabel(t types.Type) string {
	return types.TypeString(t, func(pkg *types.Package) string { return pkg.Name() })
}

// schema registra lo struct (e quelli annidati, fino a 4 livelli) e ne restituisce il nome.
func (a *architecture) schema(t types.Type, name string, depth int) string {
	if existing, ok := a.schemaNames[t.String()]; ok {
		return existing
	}
	structure, ok := t.Underlying().(*types.Struct)
	if !ok || depth > 4 {
		return ""
	}
	unique := name
	for suffix := 2; a.schemaTaken[unique]; suffix++ {
		unique = name + strconv.Itoa(suffix)
	}
	a.schemaTaken[unique] = true
	a.schemaNames[t.String()] = unique
	result := ArchSchema{Name: unique, Fields: []ArchField{}}
	if named, ok := t.(*types.Named); ok {
		result.Package = named.Obj().Pkg().Path()
		result.Site = a.site(named.Obj().Pos())
	}
	for index := 0; index < structure.NumFields(); index++ {
		field := structure.Field(index)
		if !field.Exported() {
			continue
		}
		jsonName, omitEmpty, skip := jsonTag(structure.Tag(index), field.Name())
		if skip {
			continue
		}
		item := ArchField{Name: jsonName, GoName: field.Name(), Required: !omitEmpty && !isPointer(field.Type())}
		a.fieldType(&item, field.Type(), depth)
		result.Fields = append(result.Fields, item)
	}
	a.report.Schemas = append(a.report.Schemas, result)
	return unique
}

func isPointer(t types.Type) bool {
	_, ok := t.(*types.Pointer)
	return ok
}

func jsonTag(tag, fallback string) (string, bool, bool) {
	value, ok := reflect.StructTag(tag).Lookup("json")
	if !ok {
		return fallback, false, false
	}
	name, options, _ := strings.Cut(value, ",")
	if name == "-" && options == "" {
		return "", false, true
	}
	if name == "" {
		name = fallback
	}
	return name, strings.Contains(options, "omitempty"), false
}

// fieldType traduce un tipo Go nel tipo JSON Schema usato da OpenAPI.
func (a *architecture) fieldType(field *ArchField, t types.Type, depth int) {
	t = pointerElem(t)
	if named, ok := t.(*types.Named); ok && named.Obj().Pkg() != nil && named.Obj().Pkg().Path() == "time" && named.Obj().Name() == "Time" {
		field.Type, field.Format = "string", "date-time"
		return
	}
	switch underlying := t.Underlying().(type) {
	case *types.Basic:
		field.Type, field.Format = basicJSON(underlying)
	case *types.Slice, *types.Array:
		var element types.Type
		if slice, ok := underlying.(*types.Slice); ok {
			element = slice.Elem()
		} else {
			element = underlying.(*types.Array).Elem()
		}
		if basic, ok := element.Underlying().(*types.Basic); ok && basic.Kind() == types.Byte {
			field.Type, field.Format = "string", "byte"
			return
		}
		field.Type = "array"
		var inner ArchField
		a.fieldType(&inner, element, depth)
		field.Items, field.Ref = inner.Type, inner.Ref
	case *types.Map, *types.Interface:
		field.Type = "object"
	case *types.Struct:
		field.Type = "object"
		name := "Inline"
		if named, ok := t.(*types.Named); ok {
			name = named.Obj().Name()
		}
		field.Ref = a.schema(t, name, depth+1)
	default:
		field.Type = "string"
	}
}

func basicJSON(basic *types.Basic) (string, string) {
	info := basic.Info()
	switch {
	case info&types.IsBoolean != 0:
		return "boolean", ""
	case info&types.IsInteger != 0:
		if basic.Kind() == types.Int64 || basic.Kind() == types.Uint64 {
			return "integer", "int64"
		}
		return "integer", ""
	case info&types.IsFloat != 0:
		return "number", ""
	}
	return "string", ""
}

func sortSchemas(schemas []ArchSchema) {
	sort.Slice(schemas, func(i, j int) bool { return schemas[i].Name < schemas[j].Name })
}
