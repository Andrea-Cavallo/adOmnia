package golang

import (
	"fmt"
	"go/ast"
	"go/constant"
	"go/token"
	"go/types"
	"slices"
	"sort"
	"strings"

	"golang.org/x/tools/go/types/typeutil"
)

// ArchEntry è un punto d'ingresso o un servizio rilevato nel codice.
// Kind: main, init, http, middleware, grpc, kafka-producer, kafka-consumer, repository, job, cli.
type ArchEntry struct {
	Kind     string   `json:"kind"`
	Name     string   `json:"name"`
	Detail   string   `json:"detail,omitempty"`
	Package  string   `json:"package"`
	Function string   `json:"function,omitempty"`
	Topics   []string `json:"topics,omitempty"`
	Site     ArchSite `json:"site"`
	// Solo per le route HTTP: handler, middleware e corpi di richiesta e risposta riconosciuti.
	Handler     string    `json:"handler,omitempty"`
	HandlerSite *ArchSite `json:"handlerSite,omitempty"`
	Middleware  []string  `json:"middleware,omitempty"`
	Request     *ArchBody `json:"request,omitempty"`
	Response    *ArchBody `json:"response,omitempty"`
}

// Librerie Kafka: package → metodi che producono o consumano.
var kafkaLibraries = []struct {
	path, label      string
	produce, consume []string
}{
	{"github.com/IBM/sarama", "sarama", []string{"SendMessage", "SendMessages", "Input"}, []string{"Consume", "ConsumePartition"}},
	{"github.com/Shopify/sarama", "sarama", []string{"SendMessage", "SendMessages", "Input"}, []string{"Consume", "ConsumePartition"}},
	{"github.com/segmentio/kafka-go", "kafka-go", []string{"WriteMessages"}, []string{"ReadMessage", "FetchMessage"}},
	{"github.com/confluentinc/confluent-kafka-go", "confluent-kafka-go", []string{"Produce"}, []string{"ReadMessage", "Poll", "Subscribe", "SubscribeTopics"}},
	{"github.com/twmb/franz-go", "franz-go", []string{"Produce", "ProduceSync", "TryProduce"}, []string{"PollFetches", "PollRecords"}},
}

// Handle di database riconosciuti nei campi di uno struct (package, tipo) → etichetta.
var databaseHandles = []struct{ pkg, name, label string }{
	{"database/sql", "DB", "database/sql"}, {"database/sql", "Tx", "database/sql"},
	{"github.com/jmoiron/sqlx", "DB", "sqlx"}, {"github.com/jmoiron/sqlx", "Tx", "sqlx"},
	{"gorm.io/gorm", "DB", "GORM"},
	{"github.com/jackc/pgx/v5/pgxpool", "Pool", "pgx"}, {"github.com/jackc/pgx/v4/pgxpool", "Pool", "pgx"},
	{"github.com/jackc/pgx/v5", "Conn", "pgx"}, {"github.com/jackc/pgx/v4", "Conn", "pgx"},
	{"go.mongodb.org/mongo-driver/mongo", "Collection", "MongoDB"}, {"go.mongodb.org/mongo-driver/mongo", "Database", "MongoDB"}, {"go.mongodb.org/mongo-driver/mongo", "Client", "MongoDB"},
	{"go.mongodb.org/mongo-driver/v2/mongo", "Collection", "MongoDB"}, {"go.mongodb.org/mongo-driver/v2/mongo", "Database", "MongoDB"},
	{"github.com/redis/go-redis/v9", "Client", "Redis"},
}

func (a *architecture) addEntry(entry ArchEntry) {
	if len(a.report.Entries) >= maxArchEntries {
		a.report.Truncated = true
		return
	}
	a.report.Entries = append(a.report.Entries, entry)
}

func (a *architecture) collectEntries() {
	for _, file := range a.files {
		if strings.HasSuffix(file.path, "_test.go") {
			continue
		}
		a.collectRepositories(file)
		for _, decl := range file.file.Decls {
			if gen, ok := decl.(*ast.GenDecl); ok && gen.Tok == token.VAR {
				// I comandi cobra sono spesso variabili di package.
				ast.Inspect(gen, func(node ast.Node) bool {
					if literal, ok := node.(*ast.CompositeLit); ok {
						a.collectCLI(file, literal, "")
					}
					return true
				})
				continue
			}
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Body == nil {
				continue
			}
			name := funcDeclName(fn)
			if fn.Recv == nil && (fn.Name.Name == "main" && file.pkg.Name == "main" || fn.Name.Name == "init") {
				a.addEntry(ArchEntry{Kind: fn.Name.Name, Name: file.pkg.PkgPath, Package: file.pkg.PkgPath, Function: name, Site: a.site(fn.Name.Pos())})
			}
			a.collectFunctionEntries(file, fn, name)
			a.collectRoutes(file, fn, name)
		}
	}
}

func constantString(info *types.Info, expression ast.Expr) (string, bool) {
	value := info.Types[expression].Value
	if value == nil || value.Kind() != constant.String {
		return "", false
	}
	return constant.StringVal(value), true
}

func receiverPackage(callee *types.Func) string {
	if callee.Pkg() == nil {
		return ""
	}
	return callee.Pkg().Path()
}

func (a *architecture) collectFunctionEntries(file typedFile, fn *ast.FuncDecl, function string) {
	info := file.pkg.TypesInfo
	kafka := map[string]string{} // kind → libreria
	var kafkaSite token.Pos
	topics := map[string]bool{}
	ast.Inspect(fn.Body, func(node ast.Node) bool {
		switch node := node.(type) {
		case *ast.KeyValueExpr:
			if key, ok := node.Key.(*ast.Ident); ok && (key.Name == "Topic" || key.Name == "GroupTopics") {
				if topic, ok := constantString(info, node.Value); ok {
					topics[topic] = true
				}
			}
		case *ast.CompositeLit:
			a.collectCLI(file, node, function)
		case *ast.CallExpr:
			callee, _ := typeutil.Callee(info, node).(*types.Func)
			if callee == nil {
				return true
			}
			packagePath, name := receiverPackage(callee), callee.Name()
			site := a.site(node.Pos())
			base := ArchEntry{Package: file.pkg.PkgPath, Function: function, Site: site}
			switch {
			case strings.HasPrefix(name, "Register") && strings.HasSuffix(name, "Server") && len(node.Args) == 2 && strings.Contains(types.TypeString(info.Types[node.Args[0]].Type, nil), "grpc"):
				base.Kind, base.Name = "grpc", strings.TrimSuffix(strings.TrimPrefix(name, "Register"), "Server")
				base.Detail = types.TypeString(info.Types[node.Args[1]].Type, types.RelativeTo(file.pkg.Types))
				a.addEntry(base)
			case callee.FullName() == "time.NewTicker" || callee.FullName() == "time.Tick" || callee.FullName() == "time.AfterFunc" ||
				strings.Contains(packagePath, "robfig/cron") && (name == "AddFunc" || name == "AddJob") ||
				strings.Contains(packagePath, "go-co-op/gocron") && (name == "Every" || name == "Cron" || name == "NewJob"):
				base.Kind, base.Name = "job", function
				if len(node.Args) > 0 {
					base.Detail = callee.Name() + "(" + string(file.text[a.offset(node.Args[0].Pos()):a.offset(node.Args[0].End())]) + ")"
				}
				a.addEntry(base)
			case callee.FullName() == "flag.Parse" && file.pkg.Name == "main":
				base.Kind, base.Name, base.Detail = "cli", file.pkg.PkgPath, "flag"
				a.addEntry(base)
			}
			for _, library := range kafkaLibraries {
				if !strings.HasPrefix(packagePath, library.path) {
					continue
				}
				if slices.Contains(library.produce, name) {
					kafka["kafka-producer"] = library.label
					kafkaSite = node.Pos()
				}
				if slices.Contains(library.consume, name) {
					kafka["kafka-consumer"] = library.label
					kafkaSite = node.Pos()
					for _, argument := range node.Args {
						if topic, ok := constantString(info, argument); ok {
							topics[topic] = true
						}
					}
				}
			}
		}
		return true
	})
	if len(kafka) == 0 {
		return
	}
	names := make([]string, 0, len(topics))
	for topic := range topics {
		names = append(names, topic)
	}
	sort.Strings(names)
	for kind, library := range kafka {
		a.addEntry(ArchEntry{Kind: kind, Name: function, Detail: library, Package: file.pkg.PkgPath, Function: function, Topics: names, Site: a.site(kafkaSite)})
	}
}

func (a *architecture) offset(pos token.Pos) int { return a.fset.Position(pos).Offset }

// collectCLI riconosce i comandi cobra (Use) e urfave/cli (Name) dichiarati come letterali.
func (a *architecture) collectCLI(file typedFile, literal *ast.CompositeLit, function string) {
	info := file.pkg.TypesInfo
	named, _ := pointerElem(info.Types[literal].Type).(*types.Named)
	if named == nil || named.Obj().Pkg() == nil || named.Obj().Name() != "Command" {
		return
	}
	path := named.Obj().Pkg().Path()
	field, label := "", ""
	switch {
	case strings.HasPrefix(path, "github.com/spf13/cobra"):
		field, label = "Use", "cobra"
	case strings.Contains(path, "urfave/cli"):
		field, label = "Name", "urfave/cli"
	default:
		return
	}
	for _, element := range literal.Elts {
		pair, ok := element.(*ast.KeyValueExpr)
		if !ok {
			continue
		}
		if key, ok := pair.Key.(*ast.Ident); ok && key.Name == field {
			if value, ok := constantString(info, pair.Value); ok {
				name, _, _ := strings.Cut(value, " ")
				a.addEntry(ArchEntry{Kind: "cli", Name: name, Detail: label, Package: file.pkg.PkgPath, Function: function, Site: a.site(literal.Pos())})
			}
		}
	}
}

// collectRepositories: struct con un handle di database tra i campi.
func (a *architecture) collectRepositories(file typedFile) {
	info := file.pkg.TypesInfo
	for _, decl := range file.file.Decls {
		gen, ok := decl.(*ast.GenDecl)
		if !ok || gen.Tok != token.TYPE {
			continue
		}
		for _, spec := range gen.Specs {
			typeSpec := spec.(*ast.TypeSpec)
			object, _ := info.Defs[typeSpec.Name].(*types.TypeName)
			if object == nil {
				continue
			}
			structure, ok := object.Type().Underlying().(*types.Struct)
			if !ok {
				continue
			}
			for index := 0; index < structure.NumFields(); index++ {
				if label := databaseLabel(structure.Field(index).Type()); label != "" {
					methods := types.NewMethodSet(types.NewPointer(object.Type())).Len()
					a.addEntry(ArchEntry{Kind: "repository", Name: object.Name(), Detail: label + " · " + pluralize(methods, "method"), Package: file.pkg.PkgPath, Site: a.site(typeSpec.Name.Pos())})
					break
				}
			}
		}
	}
}

func databaseLabel(t types.Type) string {
	named, _ := pointerElem(t).(*types.Named)
	if named == nil || named.Obj().Pkg() == nil {
		return ""
	}
	for _, handle := range databaseHandles {
		if named.Obj().Pkg().Path() == handle.pkg && named.Obj().Name() == handle.name {
			return handle.label
		}
	}
	return ""
}

func pluralize(count int, word string) string {
	if count == 1 {
		return "1 " + word
	}
	return fmt.Sprintf("%d %ss", count, word)
}
