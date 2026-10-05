package golang

import (
	"go/ast"
	"go/types"
	"regexp"
	"sort"
	"strings"
	"unicode"

	"golang.org/x/tools/go/types/typeutil"
)

// Accesso ai dati: ogni chiamata a database/sql, sqlx, pgx o GORM con il testo SQL (quando è
// costante), le tabelle, se avviene in transazione o su uno statement preparato. Una libreria
// nuova è una riga in dbLibraries.

const maxArchQueries = 5000

// ArchQuery è un accesso al database trovato nel codice.
type ArchQuery struct {
	Library     string   `json:"library"`
	Operation   string   `json:"operation"` // query, exec, prepare, begin, orm
	Method      string   `json:"method"`
	SQL         string   `json:"sql,omitempty"`
	Dynamic     bool     `json:"dynamic,omitempty"` // SQL costruito a runtime (Sprintf, concatenazioni)
	Tables      []string `json:"tables"`
	Model       string   `json:"model,omitempty"`      // GORM: tipo del modello
	TableGuess  bool     `json:"tableGuess,omitempty"` // tabella dedotta dalla convenzione di GORM
	Function    string   `json:"function"`
	Package     string   `json:"package"`
	Transaction bool     `json:"transaction,omitempty"`
	Prepared    bool     `json:"prepared,omitempty"`
	Site        ArchSite `json:"site"`
}

type dbLibrary struct {
	label    string
	pkg      string
	sqlArg   map[string]int  // metodo → indice dell'argomento SQL
	writes   map[string]bool // metodi che scrivono (exec)
	begin    map[string]bool
	prepare  map[string]bool
	txFunc   map[string]bool // metodi che passano una transazione a una closure
	txTypes  []string        // tipi del ricevitore che sono transazioni
	stmtType []string        // tipi del ricevitore che sono statement preparati
	orm      map[string]bool // operazioni ORM terminali (GORM)
}

func methodSet(names ...string) map[string]bool {
	set := map[string]bool{}
	for _, name := range names {
		set[name] = true
	}
	return set
}

var dbLibraries = []dbLibrary{
	{label: "database/sql", pkg: "database/sql",
		sqlArg: map[string]int{"Query": 0, "QueryContext": 1, "QueryRow": 0, "QueryRowContext": 1, "Exec": 0, "ExecContext": 1, "Prepare": 0, "PrepareContext": 1},
		writes: methodSet("Exec", "ExecContext"), begin: methodSet("Begin", "BeginTx"), prepare: methodSet("Prepare", "PrepareContext"),
		txTypes: []string{"Tx"}, stmtType: []string{"Stmt"}},
	{label: "sqlx", pkg: "jmoiron/sqlx",
		sqlArg: map[string]int{"Queryx": 0, "QueryRowx": 0, "Select": 1, "Get": 1, "NamedExec": 0, "NamedQuery": 0, "MustExec": 0, "QueryxContext": 1, "QueryRowxContext": 1, "SelectContext": 2, "GetContext": 2, "NamedExecContext": 1, "MustExecContext": 1, "Preparex": 0, "PrepareNamed": 0, "PreparexContext": 1, "PrepareNamedContext": 1},
		writes: methodSet("NamedExec", "MustExec", "NamedExecContext", "MustExecContext"), begin: methodSet("Beginx", "MustBegin", "BeginTxx", "MustBeginTx"),
		prepare: methodSet("Preparex", "PrepareNamed", "PreparexContext", "PrepareNamedContext"), txTypes: []string{"Tx"}, stmtType: []string{"Stmt", "NamedStmt"}},
	{label: "pgx", pkg: "jackc/pgx",
		sqlArg: map[string]int{"Query": 1, "QueryRow": 1, "Exec": 1, "Prepare": 2},
		writes: methodSet("Exec"), begin: methodSet("Begin", "BeginTx"), prepare: methodSet("Prepare"), txFunc: methodSet("BeginFunc", "BeginTxFunc"),
		txTypes: []string{"Tx"}},
	{label: "GORM", pkg: "gorm.io/gorm",
		sqlArg: map[string]int{"Raw": 0, "Exec": 0},
		writes: methodSet("Exec", "Create", "Save", "Delete", "Update", "Updates", "UpdateColumn", "UpdateColumns"), begin: methodSet("Begin"), txFunc: methodSet("Transaction"),
		orm: methodSet("Find", "First", "Take", "Last", "Create", "Save", "Delete", "Update", "Updates", "UpdateColumn", "UpdateColumns", "Count", "Pluck", "Scan", "FirstOrCreate", "FirstOrInit")},
}

func libraryFor(packagePath string) *dbLibrary {
	for index := range dbLibraries {
		if strings.Contains(packagePath, dbLibraries[index].pkg) {
			return &dbLibraries[index]
		}
	}
	return nil
}

var (
	sqlIdent     = `(?:"[^"]+"|` + "`[^`]+`" + `|\[[^\]]+\]|[A-Za-z_][\w$]*)`
	sqlTable     = regexp.MustCompile(`(?i)\b(?:from|join|into|update|table)\s+(?:only\s+)?(` + sqlIdent + `(?:\.` + sqlIdent + `)*)`)
	sqlNotTables = map[string]bool{"select": true, "where": true, "set": true, "values": true, "lateral": true, "unnest": true}
	sprintfVerb  = regexp.MustCompile(`%[-+# 0-9.]*[a-zA-Z]`)
)

// SQLTables estrae le tabelle citate da un'istruzione SQL (FROM, JOIN, INTO, UPDATE, TABLE).
func SQLTables(sql string) []string {
	seen := map[string]bool{}
	tables := []string{}
	for _, match := range sqlTable.FindAllStringSubmatch(sql, -1) {
		parts := strings.Split(match[1], ".")
		for index := range parts {
			parts[index] = strings.Trim(parts[index], "`\"[]")
		}
		name := strings.Join(parts, ".")
		if name == "" || sqlNotTables[strings.ToLower(name)] || seen[name] {
			continue
		}
		seen[name] = true
		tables = append(tables, name)
	}
	return tables
}

// gormTable applica la convenzione di GORM: snake_case al plurale (Order → orders, OrderItem → order_items).
func gormTable(name string) string {
	var builder strings.Builder
	runes := []rune(name)
	for index, r := range runes {
		if unicode.IsUpper(r) && index > 0 && (unicode.IsLower(runes[index-1]) || index+1 < len(runes) && unicode.IsLower(runes[index+1])) {
			builder.WriteByte('_')
		}
		builder.WriteRune(unicode.ToLower(r))
	}
	snake := builder.String()
	switch {
	case strings.HasSuffix(snake, "y") && !strings.HasSuffix(snake, "ay") && !strings.HasSuffix(snake, "ey") && !strings.HasSuffix(snake, "oy"):
		return snake[:len(snake)-1] + "ies"
	case strings.HasSuffix(snake, "s") || strings.HasSuffix(snake, "x") || strings.HasSuffix(snake, "ch") || strings.HasSuffix(snake, "sh"):
		return snake + "es"
	}
	return snake + "s"
}

func (a *architecture) addQuery(query ArchQuery) {
	if len(a.report.Queries) >= maxArchQueries {
		a.report.Truncated = true
		return
	}
	if query.Tables == nil {
		query.Tables = []string{}
	}
	a.report.Queries = append(a.report.Queries, query)
}

func receiverTypeName(callee *types.Func) string {
	signature, ok := callee.Type().(*types.Signature)
	if !ok || signature.Recv() == nil {
		return ""
	}
	if named, ok := pointerElem(signature.Recv().Type()).(*types.Named); ok {
		return named.Obj().Name()
	}
	return ""
}

// collectQueries registra gli accessi al database della funzione.
func (a *architecture) collectQueries(file typedFile, fn *ast.FuncDecl, function string) {
	info := file.pkg.TypesInfo
	txVars := map[types.Object]bool{}
	txLiterals := map[*ast.FuncLit]bool{}
	inspectWithStack(fn.Body, func(node ast.Node, stack []ast.Node) bool {
		switch node := node.(type) {
		case *ast.AssignStmt:
			// tx, err := db.Begin(): le chiamate su tx sono in transazione.
			if len(node.Rhs) == 1 {
				if call, ok := ast.Unparen(node.Rhs[0]).(*ast.CallExpr); ok {
					if callee, _ := typeutil.Callee(info, call).(*types.Func); callee != nil && callee.Pkg() != nil {
						if library := libraryFor(callee.Pkg().Path()); library != nil && library.begin[callee.Name()] {
							if ident, ok := node.Lhs[0].(*ast.Ident); ok {
								txVars[info.ObjectOf(ident)] = true
							}
						}
					}
				}
			}
		case *ast.CallExpr:
			callee, _ := typeutil.Callee(info, node).(*types.Func)
			if callee == nil || callee.Pkg() == nil {
				return true
			}
			library := libraryFor(callee.Pkg().Path())
			if library == nil {
				return true
			}
			name := callee.Name()
			if library.txFunc[name] {
				for _, argument := range node.Args {
					if literal, ok := argument.(*ast.FuncLit); ok {
						txLiterals[literal] = true
					}
				}
			}
			skipSQL := false
			inTransaction := slicesContainsString(library.txTypes, receiverTypeName(callee)) || txVars[receiverObject(info, node)] || insideLiteral(stack, txLiterals) || chainedOnTransaction(info, node, txVars)
			query := ArchQuery{Library: library.label, Method: name, Function: function, Package: file.pkg.PkgPath, Transaction: inTransaction, Site: a.site(node.Pos())}
			switch {
			case library.begin[name] || library.txFunc[name]:
				query.Operation = "begin"
			case library.prepare[name]:
				query.Operation, query.Prepared = "prepare", true
			case slicesContainsString(library.stmtType, receiverTypeName(callee)) && (strings.HasPrefix(name, "Query") || strings.HasPrefix(name, "Exec") || name == "Select" || name == "Get"):
				query.Operation, query.Prepared, skipSQL = operationFor(library, name), true, true
			case library.orm[name]:
				query.Operation = "orm"
				a.gormModel(info, node, &query)
			default:
				index, ok := library.sqlArg[name]
				if !ok || index >= len(node.Args) {
					return true
				}
				query.Operation = operationFor(library, name)
			}
			if index, ok := library.sqlArg[name]; ok && index < len(node.Args) && !skipSQL {
				query.SQL, query.Dynamic = sqlText(info, node.Args[index])
				query.Tables = SQLTables(query.SQL)
			}
			a.addQuery(query)
		}
		return true
	})
}

func slicesContainsString(values []string, value string) bool {
	for _, item := range values {
		if item == value && value != "" {
			return true
		}
	}
	return false
}

func operationFor(library *dbLibrary, name string) string {
	if library.writes[name] || strings.HasPrefix(name, "Exec") || strings.HasPrefix(name, "MustExec") {
		return "exec"
	}
	return "query"
}

func insideLiteral(stack []ast.Node, literals map[*ast.FuncLit]bool) bool {
	for _, node := range stack {
		if literal, ok := node.(*ast.FuncLit); ok && literals[literal] {
			return true
		}
	}
	return false
}

// chainedOnTransaction: tx.Where(…).Find(…) con tx da Begin.
func chainedOnTransaction(info *types.Info, call *ast.CallExpr, txVars map[types.Object]bool) bool {
	expression := ast.Expr(call)
	for {
		current, ok := ast.Unparen(expression).(*ast.CallExpr)
		if !ok {
			break
		}
		selector, ok := ast.Unparen(current.Fun).(*ast.SelectorExpr)
		if !ok {
			return false
		}
		expression = selector.X
	}
	if ident, ok := ast.Unparen(expression).(*ast.Ident); ok {
		return txVars[info.ObjectOf(ident)]
	}
	return false
}

// sqlText restituisce il testo SQL costante; per Sprintf il formato con i verbi come segnaposto.
func sqlText(info *types.Info, expression ast.Expr) (string, bool) {
	if text, ok := constantString(info, expression); ok {
		return strings.TrimSpace(text), false
	}
	if call, ok := ast.Unparen(expression).(*ast.CallExpr); ok && len(call.Args) > 0 {
		if callee, _ := typeutil.Callee(info, call).(*types.Func); callee != nil && callee.FullName() == "fmt.Sprintf" {
			if format, ok := constantString(info, call.Args[0]); ok {
				return strings.TrimSpace(sprintfVerb.ReplaceAllString(format, "?")), true
			}
		}
	}
	return "", true
}

// gormModel ricava modello e tabella di un'operazione GORM: .Table("x"), .Model(&T{}) o l'argomento.
func (a *architecture) gormModel(info *types.Info, call *ast.CallExpr, query *ArchQuery) {
	expression := ast.Expr(call)
	for {
		current, ok := ast.Unparen(expression).(*ast.CallExpr)
		if !ok {
			break
		}
		selector, ok := ast.Unparen(current.Fun).(*ast.SelectorExpr)
		if !ok {
			break
		}
		switch selector.Sel.Name {
		case "Table":
			if len(current.Args) > 0 {
				if table, ok := constantString(info, current.Args[0]); ok {
					query.Tables = []string{table}
					query.TableGuess = false
					return
				}
			}
		case "Model":
			if len(current.Args) > 0 && query.Model == "" {
				a.setGormModel(info.Types[current.Args[0]].Type, query)
			}
		}
		expression = selector.X
	}
	if query.Model == "" && len(call.Args) > 0 {
		a.setGormModel(info.Types[call.Args[0]].Type, query)
	}
}

func (a *architecture) setGormModel(t types.Type, query *ArchQuery) {
	t = pointerElem(t)
	if slice, ok := t.Underlying().(*types.Slice); ok {
		t = pointerElem(slice.Elem())
	}
	named, ok := t.(*types.Named)
	if !ok {
		return
	}
	if _, isStruct := named.Underlying().(*types.Struct); !isStruct {
		return
	}
	query.Model = named.Obj().Name()
	query.Tables = []string{gormTable(named.Obj().Name())}
	query.TableGuess = true
	// Un metodo TableName() sul modello cambia il nome: lo si legge se restituisce una costante.
	if declaration, ok := a.tableNameMethod(named); ok {
		query.Tables, query.TableGuess = []string{declaration}, false
	}
}

func (a *architecture) tableNameMethod(named *types.Named) (string, bool) {
	object, _, _ := types.LookupFieldOrMethod(types.NewPointer(named), true, named.Obj().Pkg(), "TableName")
	method, ok := object.(*types.Func)
	if !ok {
		return "", false
	}
	declaration, ok := a.decls[method]
	if !ok || declaration.decl.Body == nil || len(declaration.decl.Body.List) != 1 {
		return "", false
	}
	ret, ok := declaration.decl.Body.List[0].(*ast.ReturnStmt)
	if !ok || len(ret.Results) != 1 {
		return "", false
	}
	return constantString(declaration.file.pkg.TypesInfo, ret.Results[0])
}

func sortQueries(queries []ArchQuery) {
	sort.SliceStable(queries, func(i, j int) bool {
		if queries[i].Site.Path != queries[j].Site.Path {
			return queries[i].Site.Path < queries[j].Site.Path
		}
		return queries[i].Site.Offset < queries[j].Site.Offset
	})
}
