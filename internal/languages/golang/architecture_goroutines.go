package golang

import (
	"go/ast"
	"go/token"
	"go/types"
	goversion "go/version"
	"sort"
	"strings"

	"golang.org/x/tools/go/types/typeutil"
)

// ArchGoroutine è un punto del codice che avvia lavoro concorrente: `go`, errgroup.Go, sync.WaitGroup.Go,
// time.AfterFunc e context.AfterFunc. Le regole di Risks sono indizi dall'analisi statica, non prove.
type ArchGoroutine struct {
	Kind  string `json:"kind"`  // go | errgroup | waitgroup-go | afterfunc
	Shape string `json:"shape"` // literal | named | method | dynamic
	// Launches è la funzione avviata (vuota per un letterale); LaunchesID è l'ID in Functions quando è del progetto.
	Launches   string   `json:"launches,omitempty"`
	LaunchesID string   `json:"launchesId,omitempty"`
	Package    string   `json:"package"`
	Function   string   `json:"function"` // dove si avvia; "(package var)" per un initializer
	Site       ArchSite `json:"site"`
	// Spawner è l'ID in Functions della funzione che avvia (vuoto per gli initializer).
	Spawner     string `json:"spawner,omitempty"`
	InLoop      bool   `json:"inLoop,omitempty"`
	LoopKind    string `json:"loopKind,omitempty"` // for | range
	Bounded     bool   `json:"bounded,omitempty"`  // numero di avvii limitato: ciclo con tetto costante, SetLimit o semaforo
	Ctx         bool   `json:"ctx,omitempty"`      // usa un context.Context
	Cancellable bool   `json:"cancellable,omitempty"`
	WaitGroup   bool   `json:"waitGroup,omitempty"`
	ErrGroup    bool   `json:"errGroup,omitempty"`
	Channels    int    `json:"channels,omitempty"` // operazioni su canali nel corpo o canali passati
	Recover     bool   `json:"recover,omitempty"`
	// Entries: gli entry point (HTTP, job, main…) da cui lo spawner è raggiungibile.
	Entries  []string `json:"entries,omitempty"`
	Risks    []string `json:"risks"`
	Severity string   `json:"severity"` // none | low | medium | high

	// Stato interno per le regole che dipendono dagli entry (calcolate in linkGoroutines).
	hasBody, infinite, stopChannel, loopVarCapture, handlerFunc bool
}

const (
	maxArchGoroutines   = 5000
	goroutineReachDepth = 8
	maxGoroutineEntries = 6
)

// collectGoroutines cerca gli avvii di goroutine nelle funzioni e negli initializer `var` di package.
func (a *architecture) collectGoroutines() {
	for _, file := range a.files {
		if strings.HasSuffix(file.path, "_test.go") {
			continue
		}
		for _, decl := range file.file.Decls {
			switch decl := decl.(type) {
			case *ast.GenDecl:
				if decl.Tok == token.VAR {
					a.goroutinesIn(file, decl, nil)
				}
			case *ast.FuncDecl:
				if decl.Body != nil {
					a.goroutinesIn(file, decl.Body, decl)
				}
			}
		}
	}
	a.linkGoroutines()
}

func (a *architecture) goroutinesIn(file typedFile, root ast.Node, fn *ast.FuncDecl) {
	info := file.pkg.TypesInfo
	if info == nil {
		return
	}
	function, spawner, handler := "(package var)", "", false
	var limited bool
	if fn != nil {
		function = funcDeclName(fn)
		if object, ok := info.Defs[fn.Name].(*types.Func); ok {
			spawner = object.FullName()
			handler = isHandlerSignature(object)
		}
		limited = callsGroupMethod(info, fn.Body, "SetLimit")
	}
	oldGo := file.pkg.Module != nil && file.pkg.Module.GoVersion != "" && goversion.Compare("go"+file.pkg.Module.GoVersion, "go1.22") < 0
	var stack []ast.Node
	ast.Inspect(root, func(node ast.Node) bool {
		if node == nil {
			stack = stack[:len(stack)-1]
			return true
		}
		stack = append(stack, node)
		kind, target, args := launchOf(info, node)
		if target == nil {
			return true
		}
		if len(a.report.Goroutines) >= maxArchGoroutines {
			a.report.Truncated = true
			return true
		}
		g := ArchGoroutine{Kind: kind, Package: file.pkg.PkgPath, Function: function, Site: a.site(node.Pos()), Spawner: spawner, Risks: []string{}, Severity: "none", handlerFunc: handler}
		var body *ast.BlockStmt
		bodyInfo := info
		g.Shape, body, bodyInfo = a.describeLaunch(&g, info, target)
		for _, arg := range args {
			if t := info.TypeOf(arg); t != nil && isChanType(t) {
				g.Channels++
			}
		}
		g.ErrGroup = kind == "errgroup"
		g.WaitGroup = kind == "waitgroup-go"
		if body != nil {
			facts := factsOf(bodyInfo, body)
			g.hasBody, g.Ctx, g.Cancellable, g.Recover, g.infinite, g.stopChannel = true, facts.ctx, facts.cancellable, facts.recovers, facts.infinite, facts.stop
			g.Channels += facts.channels
			g.WaitGroup = g.WaitGroup || facts.done
		}
		if !g.Ctx {
			for _, arg := range args {
				g.Ctx = g.Ctx || isContext(info.TypeOf(arg))
			}
		}
		loop := enclosingLoop(stack)
		if loop != nil {
			g.InLoop, g.LoopKind = true, loopKind(loop)
			g.Bounded = limited || boundedLoop(info, loop, node.Pos())
			if oldGo && body != nil && isLiteral(target) && capturesLoopVar(info, loop, body) {
				g.loopVarCapture = true
			}
		}
		a.report.Goroutines = append(a.report.Goroutines, g)
		return true
	})
}

// launchOf riconosce un avvio concorrente: il tipo, l'espressione della funzione avviata e gli argomenti passati subito.
func launchOf(info *types.Info, node ast.Node) (string, ast.Expr, []ast.Expr) {
	switch node := node.(type) {
	case *ast.GoStmt:
		return "go", node.Call.Fun, node.Call.Args
	case *ast.CallExpr:
		callee, _ := typeutil.Callee(info, node).(*types.Func)
		if callee == nil {
			return "", nil, nil
		}
		full := callee.FullName()
		switch {
		case strings.HasSuffix(full, "errgroup.Group).Go") || strings.HasSuffix(full, "errgroup.Group).TryGo"):
			if len(node.Args) == 1 {
				return "errgroup", node.Args[0], nil
			}
		case full == "(*sync.WaitGroup).Go":
			if len(node.Args) == 1 {
				return "waitgroup-go", node.Args[0], nil
			}
		case full == "time.AfterFunc" || full == "context.AfterFunc":
			if len(node.Args) == 2 {
				return "afterfunc", node.Args[1], nil
			}
		}
	}
	return "", nil, nil
}

// describeLaunch dice che forma ha la funzione avviata e, quando il corpo è noto, lo restituisce con le sue info di tipo.
func (a *architecture) describeLaunch(g *ArchGoroutine, info *types.Info, target ast.Expr) (string, *ast.BlockStmt, *types.Info) {
	target = ast.Unparen(target)
	if literal, ok := target.(*ast.FuncLit); ok {
		return "literal", literal.Body, info
	}
	var object types.Object
	switch target := target.(type) {
	case *ast.Ident:
		object = info.Uses[target]
	case *ast.SelectorExpr:
		object = info.Uses[target.Sel]
		if selection := info.Selections[target]; selection != nil {
			object = selection.Obj()
		}
	}
	callee, _ := object.(*types.Func)
	if callee == nil {
		return "dynamic", nil, info
	}
	g.Launches = callee.FullName()
	if known, ok := a.functions[callee.FullName()]; ok {
		g.Launches, g.LaunchesID = known.Name, known.ID
	}
	shape := "named"
	if signature, ok := callee.Type().(*types.Signature); ok && signature.Recv() != nil {
		shape = "method"
	}
	if decl, ok := a.decls[callee]; ok {
		return shape, decl.decl.Body, decl.file.pkg.TypesInfo
	}
	return shape, nil, info
}

func isLiteral(expression ast.Expr) bool {
	_, ok := ast.Unparen(expression).(*ast.FuncLit)
	return ok
}

// enclosingLoop è il ciclo più vicino che contiene l'avvio senza attraversare il confine di una funzione.
func enclosingLoop(stack []ast.Node) ast.Node {
	for index := len(stack) - 2; index >= 0; index-- {
		switch stack[index].(type) {
		case *ast.ForStmt, *ast.RangeStmt:
			return stack[index]
		case *ast.FuncLit, *ast.FuncDecl:
			return nil
		}
	}
	return nil
}

func loopKind(loop ast.Node) string {
	if _, ok := loop.(*ast.RangeStmt); ok {
		return "range"
	}
	return "for"
}

// boundedLoop: il numero di iterazioni ha un tetto noto (condizione con costante, range su costante o array)
// o il corpo prende un posto da un semaforo (invio su canale) prima di avviare.
func boundedLoop(info *types.Info, loop ast.Node, launch token.Pos) bool {
	var body *ast.BlockStmt
	switch loop := loop.(type) {
	case *ast.ForStmt:
		body = loop.Body
		if condition, ok := loop.Cond.(*ast.BinaryExpr); ok && (info.Types[condition.X].Value != nil || info.Types[condition.Y].Value != nil) {
			return true
		}
	case *ast.RangeStmt:
		body = loop.Body
		if info.Types[loop.X].Value != nil {
			return true
		}
		switch underlyingOf(info.TypeOf(loop.X)).(type) {
		case *types.Array:
			return true
		}
	}
	semaphore := false
	ast.Inspect(body, func(node ast.Node) bool {
		if send, ok := node.(*ast.SendStmt); ok && send.Pos() < launch {
			semaphore = true
		}
		return !semaphore
	})
	return semaphore
}

// capturesLoopVar: il letterale usa la variabile del ciclo dichiarata dal ciclo stesso (comportamento Go < 1.22).
func capturesLoopVar(info *types.Info, loop ast.Node, body *ast.BlockStmt) bool {
	vars := map[types.Object]bool{}
	add := func(expression ast.Expr) {
		if ident, ok := expression.(*ast.Ident); ok {
			if object := info.Defs[ident]; object != nil {
				vars[object] = true
			}
		}
	}
	switch loop := loop.(type) {
	case *ast.ForStmt:
		if init, ok := loop.Init.(*ast.AssignStmt); ok && init.Tok == token.DEFINE {
			for _, left := range init.Lhs {
				add(left)
			}
		}
	case *ast.RangeStmt:
		if loop.Tok == token.DEFINE {
			add(loop.Key)
			add(loop.Value)
		}
	}
	found := false
	ast.Inspect(body, func(node ast.Node) bool {
		if ident, ok := node.(*ast.Ident); ok && vars[info.Uses[ident]] {
			found = true
		}
		return !found
	})
	return found
}

func isContext(t types.Type) bool { return t != nil && types.TypeString(t, nil) == "context.Context" }

// callsGroupMethod: la funzione chiama un metodo di errgroup.Group o sync.WaitGroup con quel nome.
func callsGroupMethod(info *types.Info, body *ast.BlockStmt, name string) bool {
	found := false
	ast.Inspect(body, func(node ast.Node) bool {
		if call, ok := node.(*ast.CallExpr); ok {
			if callee, _ := typeutil.Callee(info, call).(*types.Func); callee != nil && callee.Name() == name {
				full := callee.FullName()
				found = found || strings.Contains(full, "errgroup.Group") || strings.HasPrefix(full, "(*sync.WaitGroup).")
			}
		}
		return !found
	})
	return found
}

// isHandlerSignature riconosce un gestore di richieste dal tipo dei parametri (net/http, gin, echo, fiber).
func isHandlerSignature(object *types.Func) bool {
	signature, ok := object.Type().(*types.Signature)
	if !ok {
		return false
	}
	for index := 0; index < signature.Params().Len(); index++ {
		text := types.TypeString(signature.Params().At(index).Type(), nil)
		for _, marker := range []string{"net/http.ResponseWriter", "net/http.Request", "gin.Context", "echo.Context", "fiber.Ctx"} {
			if strings.Contains(text, marker) {
				return true
			}
		}
	}
	return false
}

type bodyFacts struct {
	ctx, cancellable, done, recovers, infinite, stop bool
	channels                                         int
}

// factsOf osserva il corpo di una goroutine: contesto, annullamento, Done, recover, cicli infiniti e canali.
func factsOf(info *types.Info, body *ast.BlockStmt) bodyFacts {
	var facts bodyFacts
	isChan := func(expression ast.Expr) bool {
		if t := info.TypeOf(expression); t != nil {
			_, ok := t.Underlying().(*types.Chan)
			return ok
		}
		return false
	}
	ast.Inspect(body, func(node ast.Node) bool {
		switch node := node.(type) {
		case *ast.Ident:
			facts.ctx = facts.ctx || isContext(info.TypeOf(node))
		case *ast.SendStmt:
			facts.channels++
		case *ast.UnaryExpr:
			if node.Op == token.ARROW && isChan(node.X) {
				facts.channels++
			}
		case *ast.RangeStmt:
			if isChan(node.X) {
				facts.channels++
			}
		case *ast.ForStmt:
			facts.infinite = facts.infinite || node.Cond == nil
		case *ast.CommClause:
			if node.Comm != nil && !isSend(node.Comm) {
				facts.stop = true
			}
		case *ast.CallExpr:
			if ident, ok := node.Fun.(*ast.Ident); ok {
				switch info.Uses[ident].(type) {
				case *types.Builtin:
					facts.recovers = facts.recovers || ident.Name == "recover"
					if ident.Name == "close" && len(node.Args) == 1 && isChan(node.Args[0]) {
						facts.channels++
					}
				}
			}
			if callee, _ := typeutil.Callee(info, node).(*types.Func); callee != nil {
				switch full := callee.FullName(); {
				case full == "(context.Context).Done" || full == "(context.Context).Err":
					facts.cancellable = true
				case full == "(*sync.WaitGroup).Done":
					facts.done = true
				}
			}
		}
		return true
	})
	return facts
}

func isSend(statement ast.Stmt) bool {
	_, ok := statement.(*ast.SendStmt)
	return ok
}

// linkGoroutines collega ogni avvio agli entry da cui è raggiungibile (chiamate statiche, profondità limitata)
// e calcola i rischi che dipendono dall'entry.
func (a *architecture) linkGoroutines() {
	if len(a.report.Goroutines) == 0 {
		return
	}
	last := func(name string) string { return name[strings.LastIndex(name, ".")+1:] }
	byName := map[[2]string][]string{}
	for id, function := range a.functions {
		key := [2]string{function.Package, last(function.Name)}
		byName[key] = append(byName[key], id)
	}
	roots := map[string][]ArchEntry{}
	for _, entry := range a.report.Entries {
		for _, name := range []string{entry.Function, entry.Handler} {
			if name == "" {
				continue
			}
			for _, id := range byName[[2]string{entry.Package, last(strings.TrimRight(name, ")"))}] {
				roots[id] = append(roots[id], entry)
			}
		}
	}
	callers := map[string][]string{}
	for edge := range a.calls {
		callers[edge[1]] = append(callers[edge[1]], edge[0])
	}
	for index := range a.report.Goroutines {
		g := &a.report.Goroutines[index]
		kinds := map[string]bool{}
		if g.Spawner != "" {
			seen := map[string]bool{g.Spawner: true}
			frontier := []string{g.Spawner}
			for depth := 0; depth <= goroutineReachDepth && len(frontier) > 0; depth++ {
				var next []string
				for _, id := range frontier {
					for _, entry := range roots[id] {
						label := entry.Kind + " " + entry.Name
						if len(g.Entries) < maxGoroutineEntries && !hasString(g.Entries, label) {
							g.Entries = append(g.Entries, label)
						}
						kinds[entry.Kind] = true
					}
					for _, caller := range callers[id] {
						if !seen[caller] {
							seen[caller] = true
							next = append(next, caller)
						}
					}
				}
				frontier = next
			}
		}
		sort.Strings(g.Entries)
		a.rateGoroutine(g, kinds["http"] || g.handlerFunc, kinds["http"] || kinds["job"] || g.handlerFunc)
	}
}

func hasString(items []string, value string) bool {
	for _, item := range items {
		if item == value {
			return true
		}
	}
	return false
}

// rateGoroutine applica le regole di rischio. Sono indizi: ognuna dice cosa guardare, non che c'è un bug.
func (a *architecture) rateGoroutine(g *ArchGoroutine, inHandler, inRequestOrJob bool) {
	add := func(risk string) { g.Risks = append(g.Risks, risk) }
	if g.InLoop && !g.Bounded {
		add("unbounded-loop-spawn")
	}
	if g.loopVarCapture {
		add("loop-var-capture")
	}
	if g.Kind == "go" && !g.WaitGroup && !g.ErrGroup && g.Channels == 0 {
		if inHandler {
			add("fire-and-forget-in-handler")
		} else {
			add("no-wait")
		}
	}
	if g.hasBody && g.infinite && !g.Cancellable && !g.stopChannel {
		add("no-ctx-cancel")
	}
	if g.Kind == "go" && g.hasBody && !g.Recover && inRequestOrJob {
		add("no-recover")
	}
	g.Severity = "none"
	for _, risk := range g.Risks {
		switch risk {
		case "loop-var-capture":
			g.Severity = "high"
		case "unbounded-loop-spawn", "fire-and-forget-in-handler", "no-ctx-cancel":
			if g.Severity != "high" {
				g.Severity = "medium"
			}
		default:
			if g.Severity == "none" {
				g.Severity = "low"
			}
		}
	}
}

func sortGoroutines(items []ArchGoroutine) {
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].Package != items[j].Package {
			return items[i].Package < items[j].Package
		}
		if items[i].Site.Path != items[j].Site.Path {
			return items[i].Site.Path < items[j].Site.Path
		}
		return items[i].Site.Offset < items[j].Site.Offset
	})
}

func isChanType(t types.Type) bool {
	_, ok := t.Underlying().(*types.Chan)
	return ok
}

func underlyingOf(t types.Type) types.Type {
	if t == nil {
		return nil
	}
	return t.Underlying()
}
