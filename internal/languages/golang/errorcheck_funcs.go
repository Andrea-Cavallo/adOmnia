package golang

import (
	"fmt"
	"go/ast"
	"go/constant"
	"go/token"
	"go/types"
	"strings"
	"unicode"

	"golang.org/x/tools/go/types/typeutil"
)

// errorFunc è il contesto di una funzione analizzata (dichiarata o letterale).
type errorFunc struct {
	file      errorFile
	name      string
	decl      *ast.FuncDecl
	signature *types.Signature
	body      *ast.BlockStmt
	start     token.Pos // inizio della funzione: le variabili dichiarate prima appartengono a chi la racchiude
	deferred  bool      // letterale chiamato direttamente da defer: recover() funziona solo qui
	writes    map[*types.Var][]errorWrite
	reads     map[*types.Var][]token.Pos
	escaped   map[*types.Var]bool // letto da una closure: il controllo può avvenire altrove
}

type errorWrite struct {
	ident *ast.Ident
	stmt  ast.Stmt
	value ast.Expr // espressione assegnata (la chiamata, per le tuple)
	loop  ast.Node
	block ast.Node // blocco (o case) che contiene l'assegnazione
}

func (a *errorAnalysis) analyzeFile(file errorFile) {
	info := file.pkg.TypesInfo
	deferred := map[*ast.FuncLit]bool{}
	ast.Inspect(file.file, func(node ast.Node) bool {
		if statement, ok := node.(*ast.DeferStmt); ok {
			if literal, ok := statement.Call.Fun.(*ast.FuncLit); ok {
				deferred[literal] = true
			}
		}
		return true
	})
	for _, decl := range file.file.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Body == nil {
			continue
		}
		object, _ := info.Defs[fn.Name].(*types.Func)
		if object == nil {
			continue
		}
		signature, _ := object.Type().(*types.Signature)
		a.analyzeFunc(&errorFunc{file: file, name: funcDeclName(fn), decl: fn, signature: signature, body: fn.Body, start: fn.Pos()}, deferred)
	}
}

func funcDeclName(fn *ast.FuncDecl) string {
	if fn.Recv == nil || len(fn.Recv.List) == 0 {
		return fn.Name.Name
	}
	receiver := fn.Recv.List[0].Type
	if index, ok := receiver.(*ast.IndexExpr); ok {
		receiver = index.X
	}
	if star, ok := receiver.(*ast.StarExpr); ok {
		if ident, ok := star.X.(*ast.Ident); ok {
			return "(*" + ident.Name + ")." + fn.Name.Name
		}
	}
	if ident, ok := receiver.(*ast.Ident); ok {
		return ident.Name + "." + fn.Name.Name
	}
	return fn.Name.Name
}

func (a *errorAnalysis) analyzeFunc(fn *errorFunc, deferred map[*ast.FuncLit]bool) {
	fn.writes, fn.reads, fn.escaped = map[*types.Var][]errorWrite{}, map[*types.Var][]token.Pos{}, map[*types.Var]bool{}
	a.collectFlow(fn)
	var path *ErrorPath
	if fn.decl != nil && returnsError(fn.signature) {
		path = &ErrorPath{Function: fn.name, Path: fn.file.path, Offset: a.offset(fn.decl.Name.Pos()), Returns: []ErrorReturn{}}
	}
	inspectWithStack(fn.body, func(node ast.Node, stack []ast.Node) bool {
		switch node := node.(type) {
		case *ast.FuncLit:
			signature, _ := fn.file.pkg.TypesInfo.Types[node].Type.(*types.Signature)
			a.analyzeFunc(&errorFunc{file: fn.file, name: fn.name + ".func", signature: signature, body: node.Body, start: node.Pos(), deferred: deferred[node]}, deferred)
			return false
		case *ast.ExprStmt:
			a.checkIgnored(fn, node)
		case *ast.AssignStmt:
			a.checkDiscarded(fn, node)
		case *ast.CallExpr:
			a.checkCall(fn, node)
		case *ast.BinaryExpr:
			a.checkSentinelCompare(fn, node)
		case *ast.TypeAssertExpr:
			a.checkTypeAssert(fn, node)
		case *ast.TypeSwitchStmt:
			a.checkTypeSwitch(fn, node)
		case *ast.ReturnStmt:
			a.checkReturn(fn, node, path)
		case *ast.Ident:
			a.recordRef(fn, node, stack)
		}
		return true
	})
	a.checkUnhandled(fn)
	if path != nil && len(path.Returns) > 0 && len(a.paths) < maxErrorPaths {
		a.paths = append(a.paths, *path)
	}
}

// inspectWithStack visita l'albero passando gli antenati del nodo (il genitore è l'ultimo).
func inspectWithStack(root ast.Node, visit func(ast.Node, []ast.Node) bool) {
	var stack []ast.Node
	ast.Inspect(root, func(node ast.Node) bool {
		if node == nil {
			stack = stack[:len(stack)-1]
			return true
		}
		if !visit(node, stack) {
			return false
		}
		stack = append(stack, node)
		return true
	})
}

func returnsError(signature *types.Signature) bool {
	return signature != nil && signature.Results().Len() > 0 && isError(signature.Results().At(signature.Results().Len()-1).Type())
}

// collectFlow registra scritture e letture delle variabili error locali, anche nelle closure.
func (a *errorAnalysis) collectFlow(fn *errorFunc) {
	info := fn.file.pkg.TypesInfo
	writes := map[*ast.Ident]errorWrite{}
	var loops []ast.Node
	inspectWithStack(fn.body, func(node ast.Node, stack []ast.Node) bool {
		switch node := node.(type) {
		case *ast.ForStmt, *ast.RangeStmt:
			loops = append(loops, node)
		case *ast.AssignStmt:
			for index, lhs := range node.Lhs {
				ident, ok := ast.Unparen(lhs).(*ast.Ident)
				if !ok {
					continue
				}
				value := ast.Expr(nil)
				if len(node.Rhs) == len(node.Lhs) {
					value = node.Rhs[index]
				} else if len(node.Rhs) == 1 {
					value = node.Rhs[0]
				}
				writes[ident] = errorWrite{ident: ident, stmt: node, value: value, loop: innermostLoop(loops, node), block: enclosingBlock(stack)}
			}
		case *ast.ReturnStmt:
			// Un return senza valori legge i risultati con nome.
			if len(node.Results) == 0 && fn.signature != nil {
				for index := 0; index < fn.signature.Results().Len(); index++ {
					result := fn.signature.Results().At(index)
					fn.reads[result] = append(fn.reads[result], node.Pos())
				}
			}
		case *ast.Ident:
			variable, ok := identVar(info, node)
			if !ok || !isError(variable.Type()) || variable.Parent() == nil || variable.Parent() == variable.Pkg().Scope() || variable.Pos() < fn.start {
				return true
			}
			// Le closure sono analizzate a parte: qui contano solo per sapere se catturano la variabile.
			if literal := firstFuncLitPos(stack); literal != token.NoPos {
				if variable.Pos() < literal {
					fn.escaped[variable] = true
				}
				return true
			}
			if write, isWrite := writes[node]; isWrite {
				fn.writes[variable] = append(fn.writes[variable], write)
				return true
			}
			fn.reads[variable] = append(fn.reads[variable], node.Pos())
		}
		return true
	})
}

func identVar(info *types.Info, ident *ast.Ident) (*types.Var, bool) {
	if object, ok := info.Defs[ident].(*types.Var); ok {
		return object, true
	}
	object, ok := info.Uses[ident].(*types.Var)
	return object, ok
}

func innermostLoop(loops []ast.Node, node ast.Node) ast.Node {
	for index := len(loops) - 1; index >= 0; index-- {
		if loops[index].Pos() <= node.Pos() && node.End() <= loops[index].End() {
			return loops[index]
		}
	}
	return nil
}

func firstFuncLitPos(stack []ast.Node) token.Pos {
	for _, node := range stack {
		if literal, ok := node.(*ast.FuncLit); ok {
			return literal.Pos()
		}
	}
	return token.NoPos
}

// checkUnhandled: un errore assegnato da una chiamata e mai letto prima della scrittura successiva.
func (a *errorAnalysis) checkUnhandled(fn *errorFunc) {
	info := fn.file.pkg.TypesInfo
	for variable, writes := range fn.writes {
		if fn.escaped[variable] || variable.Name() == "_" {
			continue
		}
		for index, write := range writes {
			if write.value == nil || !isCall(write.value) {
				continue
			}
			limit := fn.body.End()
			for _, later := range writes[index+1:] {
				// Solo una riscrittura che avviene sicuramente dopo (stesso blocco o uno che lo contiene)
				// rende inutile il valore: quella nel ramo else di un if no.
				if contains(later.block, write.stmt) {
					limit = later.ident.Pos()
					break
				}
			}
			if readBetween(fn.reads[variable], write.stmt.End(), limit) || (write.loop != nil && readBetween(fn.reads[variable], write.loop.Pos(), write.loop.End())) {
				continue
			}
			a.add(fn.file, ErrorFinding{
				Kind: "unhandled", Severity: "warning", Function: fn.name,
				Message: fmt.Sprintf("%s from %s is assigned but never checked", variable.Name(), calleeLabel(info, write.value)),
				Offset:  a.offset(write.ident.Pos()), End: a.offset(write.ident.End()),
			})
		}
		a.checkShadow(fn, variable)
	}
}

func isCall(expression ast.Expr) bool {
	_, ok := ast.Unparen(expression).(*ast.CallExpr)
	return ok
}

func firstAfter(positions []token.Pos, after token.Pos) token.Pos {
	first := token.NoPos
	for _, position := range positions {
		if position > after && (first == token.NoPos || position < first) {
			first = position
		}
	}
	return first
}

func contains(outer, inner ast.Node) bool {
	return outer != nil && outer.Pos() <= inner.Pos() && inner.End() <= outer.End()
}

// enclosingBlock è il blocco di istruzioni più interno nello stack (corpo, ramo, case).
func enclosingBlock(stack []ast.Node) ast.Node {
	for index := len(stack) - 1; index >= 0; index-- {
		switch stack[index].(type) {
		case *ast.BlockStmt, *ast.CaseClause, *ast.CommClause:
			return stack[index]
		}
	}
	return nil
}

func readBetween(reads []token.Pos, from, to token.Pos) bool {
	for _, read := range reads {
		if read > from && read < to {
			return true
		}
	}
	return false
}

// checkShadow: `err :=` in un blocco interno nasconde un err esterno che viene letto dopo il blocco.
func (a *errorAnalysis) checkShadow(fn *errorFunc, inner *types.Var) {
	scope := inner.Parent()
	if scope == nil || scope.Parent() == nil {
		return
	}
	_, outerObject := scope.Parent().LookupParent(inner.Name(), inner.Pos())
	outer, ok := outerObject.(*types.Var)
	if !ok || outer == inner || !isError(outer.Type()) || outer.Parent() == outer.Pkg().Scope() {
		return
	}
	// Idiomatico `if err := f(); err != nil {}`: conta solo se dopo il blocco l'err esterno viene letto
	// prima di essere riassegnato.
	firstRead := firstAfter(fn.reads[outer], scope.End())
	if firstRead == token.NoPos {
		return
	}
	for _, write := range fn.writes[outer] {
		if write.ident.Pos() > scope.End() && write.ident.Pos() < firstRead {
			return
		}
	}
	position := a.fset.Position(outer.Pos())
	a.add(fn.file, ErrorFinding{
		Kind: "shadow", Severity: "warning", Function: fn.name,
		Message: fmt.Sprintf("%s shadows the %s declared at line %d, which is still read after this block: its value is not updated", inner.Name(), outer.Name(), position.Line),
		Offset:  a.offset(inner.Pos()), End: a.offset(inner.Pos()) + len(inner.Name()),
	})
}

func calleeLabel(info *types.Info, expression ast.Expr) string {
	call, ok := ast.Unparen(expression).(*ast.CallExpr)
	if !ok {
		return "an expression"
	}
	if callee := typeutil.Callee(info, call); callee != nil {
		if callee.Pkg() != nil {
			if function, ok := callee.(*types.Func); ok && function.Type().(*types.Signature).Recv() != nil {
				return function.Name()
			}
			return callee.Pkg().Name() + "." + callee.Name()
		}
		return callee.Name()
	}
	return "a call"
}

func (a *errorAnalysis) checkIgnored(fn *errorFunc, statement *ast.ExprStmt) {
	call, ok := ast.Unparen(statement.X).(*ast.CallExpr)
	if !ok {
		return
	}
	info := fn.file.pkg.TypesInfo
	if builtinName(info, call) == "recover" {
		a.add(fn.file, ErrorFinding{Kind: "recover-swallow", Severity: "warning", Function: fn.name, Message: "recover() result is discarded: the panic is swallowed silently. Log it or convert it to an error", Offset: a.offset(call.Pos()), End: a.offset(call.End())})
		return
	}
	if !lastResultIsError(info.Types[call].Type) {
		return
	}
	if callee := typeutil.Callee(info, call); callee != nil && ignorableErrorCalls[fullName(callee)] {
		return
	}
	a.add(fn.file, ErrorFinding{Kind: "ignored", Severity: "warning", Function: fn.name, Message: fmt.Sprintf("The error returned by %s is ignored", calleeLabel(info, call)), Offset: a.offset(call.Pos()), End: a.offset(call.End())})
}

func lastResultIsError(t types.Type) bool {
	if tuple, ok := t.(*types.Tuple); ok {
		return tuple.Len() > 0 && isError(tuple.At(tuple.Len()-1).Type())
	}
	return isError(t)
}

func builtinName(info *types.Info, call *ast.CallExpr) string {
	if ident, ok := ast.Unparen(call.Fun).(*ast.Ident); ok {
		if builtin, ok := info.Uses[ident].(*types.Builtin); ok {
			return builtin.Name()
		}
	}
	return ""
}

func (a *errorAnalysis) checkDiscarded(fn *errorFunc, statement *ast.AssignStmt) {
	if strings.HasSuffix(fn.file.path, "_test.go") {
		return
	}
	info := fn.file.pkg.TypesInfo
	report := func(lhs ast.Expr, value ast.Expr) {
		a.add(fn.file, ErrorFinding{Kind: "discarded", Severity: "info", Function: fn.name, Message: fmt.Sprintf("The error from %s is discarded with _", calleeLabel(info, value)), Offset: a.offset(lhs.Pos()), End: a.offset(lhs.End())})
	}
	if len(statement.Rhs) == 1 && len(statement.Lhs) > 1 {
		tuple, ok := info.Types[statement.Rhs[0]].Type.(*types.Tuple)
		if !ok || !isCall(statement.Rhs[0]) {
			return
		}
		for index, lhs := range statement.Lhs {
			if isBlank(lhs) && index < tuple.Len() && isError(tuple.At(index).Type()) {
				report(lhs, statement.Rhs[0])
			}
		}
		return
	}
	for index, lhs := range statement.Lhs {
		if index < len(statement.Rhs) && isBlank(lhs) && isCall(statement.Rhs[index]) && isError(info.Types[statement.Rhs[index]].Type) {
			report(lhs, statement.Rhs[index])
		}
	}
}

func isBlank(expression ast.Expr) bool {
	ident, ok := expression.(*ast.Ident)
	return ok && ident.Name == "_"
}

// checkCall: fmt.Errorf (verbi e %w), errors.As, err.Error() che perde la catena, panic e recover.
func (a *errorAnalysis) checkCall(fn *errorFunc, call *ast.CallExpr) {
	info := fn.file.pkg.TypesInfo
	switch builtinName(info, call) {
	case "panic":
		if fn.file.pkg.Name != "main" && !strings.HasSuffix(fn.file.path, "_test.go") && !isInitOrMust(fn) {
			a.add(fn.file, ErrorFinding{Kind: "panic", Severity: "info", Function: fn.name, Message: "panic in library code: callers cannot handle it. Return an error, or name the function Must… if panicking is intended", Offset: a.offset(call.Pos()), End: a.offset(call.End())})
		}
		return
	case "recover":
		if fn.decl == nil && !fn.deferred {
			a.add(fn.file, ErrorFinding{Kind: "recover-noop", Severity: "warning", Function: fn.name, Message: "recover() has no effect here: it only stops a panic when called directly by a deferred function", Offset: a.offset(call.Pos()), End: a.offset(call.End())})
		}
		return
	}
	callee := typeutil.Callee(info, call)
	if callee == nil {
		return
	}
	switch fullName(callee) {
	case "fmt.Errorf":
		a.checkErrorf(fn, call)
	case "errors.New":
		if len(call.Args) == 1 {
			a.checkErrorText(fn, call.Args[0])
		}
	case "errors.As":
		if len(call.Args) == 2 {
			a.checkErrorsAs(fn, call)
		}
	}
}

func isInitOrMust(fn *errorFunc) bool {
	if fn.decl == nil {
		return false
	}
	name := fn.decl.Name.Name
	return name == "init" || name == "main" || strings.HasPrefix(strings.ToLower(name), "must")
}

// checkErrorText segnala err.Error() passato a un costruttore: il testo resta, la catena si perde.
func (a *errorAnalysis) checkErrorText(fn *errorFunc, argument ast.Expr) bool {
	info := fn.file.pkg.TypesInfo
	call, ok := ast.Unparen(argument).(*ast.CallExpr)
	if !ok || len(call.Args) != 0 {
		return false
	}
	selector, ok := call.Fun.(*ast.SelectorExpr)
	if !ok || selector.Sel.Name != "Error" || !implementsError(info.Types[selector.X].Type) {
		return false
	}
	a.add(fn.file, ErrorFinding{Kind: "lost-chain", Severity: "warning", Function: fn.name, Message: "err.Error() keeps only the text: errors.Is and errors.As can no longer see the cause. Wrap the error itself with %w", Offset: a.offset(call.Pos()), End: a.offset(call.End())})
	return true
}

type formatVerb struct {
	start, end int // nel testo del formato, end esclusa
	verb       rune
}

// parseFormatVerbs restituisce i verbi nell'ordine degli argomenti; false se il formato usa * o [n].
func parseFormatVerbs(format string) ([]formatVerb, bool) {
	var verbs []formatVerb
	for index := 0; index < len(format); index++ {
		if format[index] != '%' {
			continue
		}
		start := index
		index++
		for index < len(format) && strings.ContainsRune("+-# 0", rune(format[index])) {
			index++
		}
		for index < len(format) && (format[index] >= '0' && format[index] <= '9' || format[index] == '.') {
			index++
		}
		if index >= len(format) {
			return verbs, true
		}
		if format[index] == '*' || format[index] == '[' {
			return nil, false
		}
		if format[index] == '%' {
			continue
		}
		verbs = append(verbs, formatVerb{start: start, end: index + 1, verb: rune(format[index])})
	}
	return verbs, true
}

func (a *errorAnalysis) checkErrorf(fn *errorFunc, call *ast.CallExpr) {
	info := fn.file.pkg.TypesInfo
	if len(call.Args) == 0 {
		return
	}
	value := info.Types[call.Args[0]].Value
	if value == nil || value.Kind() != constant.String {
		return
	}
	verbs, ok := parseFormatVerbs(constant.StringVal(value))
	if !ok {
		return
	}
	literal, _ := ast.Unparen(call.Args[0]).(*ast.BasicLit)
	editable := literal != nil && (strings.HasPrefix(literal.Value, "`") || !strings.Contains(literal.Value, `\`))
	for index, verb := range verbs {
		if index+1 >= len(call.Args) {
			break
		}
		argument := call.Args[index+1]
		if a.checkErrorText(fn, argument) {
			continue
		}
		isErr := implementsError(info.Types[argument].Type)
		switch {
		case verb.verb == 'w' && !isErr && !info.Types[argument].IsNil():
			a.add(fn.file, ErrorFinding{Kind: "wrap-nonerror", Severity: "error", Function: fn.name, Message: "%w needs an error operand: this argument is not an error", Offset: a.offset(argument.Pos()), End: a.offset(argument.End())})
		case isErr && (verb.verb == 'v' || verb.verb == 's'):
			finding := ErrorFinding{Kind: "wrap-verb", Severity: "warning", Function: fn.name, Message: fmt.Sprintf("The error is formatted with %%%c, not wrapped: errors.Is and errors.As cannot see the cause. Use %%w", verb.verb), Offset: a.offset(argument.Pos()), End: a.offset(argument.End())}
			if editable {
				base := a.offset(literal.Pos()) + 1
				finding.Fix = &ErrorFix{Label: "Wrap with %w", Edits: []ErrorEdit{{Offset: base + verb.start, End: base + verb.end, Original: constant.StringVal(value)[verb.start:verb.end], Text: "%w"}}}
			}
			a.add(fn.file, finding)
		}
	}
}

func (a *errorAnalysis) checkErrorsAs(fn *errorFunc, call *ast.CallExpr) {
	info := fn.file.pkg.TypesInfo
	target := info.Types[call.Args[1]].Type
	pointer, ok := target.(*types.Pointer)
	valid := ok && (types.IsInterface(pointer.Elem()) || types.Implements(pointer.Elem(), errorIface))
	if !valid {
		a.add(fn.file, ErrorFinding{Kind: "as-target", Severity: "error", Function: fn.name, Message: "errors.As needs a pointer to a variable of an error type, e.g. &target", Offset: a.offset(call.Args[1].Pos()), End: a.offset(call.Args[1].End())})
		return
	}
	element := pointer.Elem()
	if inner, ok := element.(*types.Pointer); ok {
		element = inner.Elem()
	}
	if named, ok := element.(*types.Named); ok {
		if info := a.errorTypes[named.Obj()]; info != nil {
			info.Refs = appendRef(info.Refs, a.ref(fn.file, "as", call.Pos(), fn.name))
		}
	}
}

// sentinelOf restituisce la variabile di package referenziata da un'espressione (ErrX o pkg.ErrX).
func sentinelOf(info *types.Info, expression ast.Expr) *types.Var {
	var ident *ast.Ident
	switch expression := ast.Unparen(expression).(type) {
	case *ast.Ident:
		ident = expression
	case *ast.SelectorExpr:
		ident = expression.Sel
	default:
		return nil
	}
	variable, ok := info.Uses[ident].(*types.Var)
	if !ok || variable.Pkg() == nil || variable.Parent() != variable.Pkg().Scope() || !implementsError(variable.Type()) {
		return nil
	}
	return variable
}

func (a *errorAnalysis) checkSentinelCompare(fn *errorFunc, binary *ast.BinaryExpr) {
	if binary.Op != token.EQL && binary.Op != token.NEQ || fn.decl != nil && fn.decl.Name.Name == "Is" {
		return
	}
	info := fn.file.pkg.TypesInfo
	value, sentinel := binary.X, binary.Y
	if sentinelOf(info, sentinel) == nil {
		value, sentinel = binary.Y, binary.X
	}
	variable := sentinelOf(info, sentinel)
	if variable == nil || info.Types[value].IsNil() || !implementsError(info.Types[value].Type) {
		return
	}
	text := func(node ast.Node) string { return string(fn.file.text[a.offset(node.Pos()):a.offset(node.End())]) }
	replacement := fmt.Sprintf("errors.Is(%s, %s)", text(value), text(sentinel))
	if binary.Op == token.NEQ {
		replacement = "!" + replacement
	}
	edits := []ErrorEdit{{Offset: a.offset(binary.Pos()), End: a.offset(binary.End()), Original: text(binary), Text: replacement}}
	if edit, ok := a.importEdit(fn.file, "errors"); ok {
		edits = append(edits, edit)
	}
	a.add(fn.file, ErrorFinding{
		Kind: "compare", Severity: "warning", Function: fn.name,
		Message: fmt.Sprintf("Comparing with %s misses wrapped errors: use errors.Is", variable.Name()),
		Offset:  a.offset(binary.Pos()), End: a.offset(binary.End()),
		Fix: &ErrorFix{Label: "Use errors.Is", Edits: edits},
	})
}

func isErrorMethod(fn *errorFunc) bool {
	return fn.decl != nil && fn.decl.Recv != nil && (fn.decl.Name.Name == "As" || fn.decl.Name.Name == "Is" || fn.decl.Name.Name == "Unwrap")
}

func (a *errorAnalysis) checkTypeAssert(fn *errorFunc, assertion *ast.TypeAssertExpr) {
	info := fn.file.pkg.TypesInfo
	if assertion.Type == nil {
		return
	}
	asserted := info.Types[assertion.Type].Type
	if named, ok := pointerElem(asserted).(*types.Named); ok {
		if typeInfo := a.errorTypes[named.Obj()]; typeInfo != nil {
			typeInfo.Refs = appendRef(typeInfo.Refs, a.ref(fn.file, "assert", assertion.Pos(), fn.name))
		}
	}
	if isErrorMethod(fn) || !isError(info.Types[assertion.X].Type) || asserted == nil {
		return
	}
	if _, isInterface := asserted.Underlying().(*types.Interface); isInterface {
		return
	}
	a.add(fn.file, ErrorFinding{Kind: "type-assert", Severity: "info", Function: fn.name, Message: "A type assertion on an error misses wrapped errors: use errors.As", Offset: a.offset(assertion.Pos()), End: a.offset(assertion.End())})
}

func pointerElem(t types.Type) types.Type {
	if pointer, ok := t.(*types.Pointer); ok {
		return pointer.Elem()
	}
	return t
}

func (a *errorAnalysis) checkTypeSwitch(fn *errorFunc, statement *ast.TypeSwitchStmt) {
	info := fn.file.pkg.TypesInfo
	var subject ast.Expr
	switch assign := statement.Assign.(type) {
	case *ast.AssignStmt:
		if len(assign.Rhs) == 1 {
			if assertion, ok := assign.Rhs[0].(*ast.TypeAssertExpr); ok {
				subject = assertion.X
			}
		}
	case *ast.ExprStmt:
		if assertion, ok := assign.X.(*ast.TypeAssertExpr); ok {
			subject = assertion.X
		}
	}
	if subject == nil || isErrorMethod(fn) || !isError(info.Types[subject].Type) {
		return
	}
	for _, clause := range statement.Body.List {
		for _, expression := range clause.(*ast.CaseClause).List {
			t := info.Types[expression].Type
			if t == nil || info.Types[expression].IsNil() {
				continue
			}
			if _, isInterface := t.Underlying().(*types.Interface); !isInterface {
				a.add(fn.file, ErrorFinding{Kind: "type-assert", Severity: "info", Function: fn.name, Message: "A type switch on an error misses wrapped errors: use errors.As for each type", Offset: a.offset(statement.Pos()), End: a.offset(statement.Pos()) + len("switch")})
				return
			}
		}
	}
}

// importEdit aggiunge un import mancante dopo la clausola package (gofmt lo raggruppa al salvataggio).
func (a *errorAnalysis) importEdit(file errorFile, path string) (ErrorEdit, bool) {
	for _, spec := range file.file.Imports {
		if strings.Trim(spec.Path.Value, "\"`") == path && (spec.Name == nil || spec.Name.Name != "_") {
			return ErrorEdit{}, false
		}
	}
	offset := a.offset(file.file.Name.End())
	return ErrorEdit{Offset: offset, End: offset, Text: fmt.Sprintf("\n\nimport %q", path)}, true
}

// humanizeName trasforma ReadFile in "read file", per il contesto di un fmt.Errorf generato.
func humanizeName(name string) string {
	var words []string
	var current []rune
	runes := []rune(name)
	for index, r := range runes {
		boundary := index > 0 && unicode.IsUpper(r) && (unicode.IsLower(runes[index-1]) || index+1 < len(runes) && unicode.IsLower(runes[index+1]))
		if boundary && len(current) > 0 {
			words = append(words, string(current))
			current = nil
		}
		current = append(current, unicode.ToLower(r))
	}
	if len(current) > 0 {
		words = append(words, string(current))
	}
	return strings.Join(words, " ")
}
