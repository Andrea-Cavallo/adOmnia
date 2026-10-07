package devcontext

import (
	"go/ast"
	"go/token"
	"path"
	"reflect"
	"regexp"
	"strconv"
	"strings"
)

var (
	sqlMethods = map[string]bool{
		"Query": true, "QueryRow": true, "QueryContext": true, "QueryRowContext": true,
		"Exec": true, "ExecContext": true, "Get": true, "GetContext": true, "Select": true, "SelectContext": true,
		"NamedExec": true, "NamedExecContext": true, "NamedQuery": true,
		"Queryx": true, "QueryRowx": true, "QueryxContext": true, "QueryRowxContext": true,
	}
	sqlStart     = regexp.MustCompile(`(?is)^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b`)
	sqlTable     = regexp.MustCompile(`(?i)\b(FROM|JOIN|INTO|UPDATE)\s+("?[A-Za-z_]\w*"?(?:\."?[A-Za-z_]\w*"?)?)(\s*\()?`)
	sqlNotTables = map[string]bool{"SET": true, "SELECT": true, "LATERAL": true, "ONLY": true}

	topicLibs = map[string]string{
		"github.com/IBM/sarama": "kafka", "github.com/Shopify/sarama": "kafka",
		"github.com/twmb/franz-go/pkg/kgo": "kafka", "github.com/segmentio/kafka-go": "kafka",
		"github.com/rabbitmq/amqp091-go": "amqp", "github.com/streadway/amqp": "amqp",
		"github.com/nats-io/nats.go": "nats",
	}
	knownImportNames = map[string]string{
		"github.com/segmentio/kafka-go": "kafka", "github.com/rabbitmq/amqp091-go": "amqp", "github.com/nats-io/nats.go": "nats",
	}
	kafkaTopicTypes = map[string]bool{"ProducerMessage": true, "Record": true, "Writer": true, "ReaderConfig": true, "Message": true}
	natsCalls       = map[string]bool{"Publish": true, "Subscribe": true, "QueueSubscribe": true, "Request": true, "SubscribeSync": true, "ChanSubscribe": true}
)

type literalWalker struct {
	rel     string
	fset    *token.FileSet
	imports map[string]string // local package name -> broker
	hasOS   bool
	consts  map[string]string
	out     []Entity
}

// detectLiterals finds env var names, SQL tables and broker topics written
// as string literals. Dynamic strings are ignored on purpose.
func detectLiterals(rel string, fset *token.FileSet, file *ast.File) []Entity {
	w := &literalWalker{rel: rel, fset: fset, imports: map[string]string{}, consts: map[string]string{}}
	for _, imp := range file.Imports {
		p, _ := strconv.Unquote(imp.Path.Value)
		name := knownImportNames[p]
		if name == "" {
			name = path.Base(p)
		}
		if imp.Name != nil {
			name = imp.Name.Name
		}
		if p == "os" && name == "os" {
			w.hasOS = true
		}
		if broker, ok := topicLibs[p]; ok {
			w.imports[name] = broker
		}
	}
	ast.Inspect(file, func(n ast.Node) bool {
		if spec, ok := n.(*ast.ValueSpec); ok {
			for i, name := range spec.Names {
				if i < len(spec.Values) {
					if s, ok := stringLit(spec.Values[i]); ok {
						w.consts[name.Name] = s
					}
				}
			}
		}
		return true
	})
	ast.Inspect(file, func(n ast.Node) bool {
		switch node := n.(type) {
		case *ast.Field:
			w.structTag(node)
		case *ast.CallExpr:
			w.call(node)
		case *ast.CompositeLit:
			w.composite(node)
		}
		return true
	})
	return w.out
}

func (w *literalWalker) add(kind, name string, attrs map[string]string, at token.Pos) {
	w.out = append(w.out, entity(kind, name, name, ConfidenceInferred, attrs,
		Source{"goliterals", w.rel, w.fset.Position(at).Line}))
}

func (w *literalWalker) structTag(field *ast.Field) {
	if field.Tag == nil {
		return
	}
	tag, err := strconv.Unquote(field.Tag.Value)
	if err != nil {
		return
	}
	for _, key := range []string{"env", "envconfig"} {
		name, _, _ := strings.Cut(reflect.StructTag(tag).Get(key), ",")
		if name != "" && name != "-" {
			w.add("envvar", name, nil, field.Pos())
		}
	}
}

func (w *literalWalker) call(call *ast.CallExpr) {
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		return
	}
	name, args := sel.Sel.Name, call.Args
	pkg, _ := sel.X.(*ast.Ident)
	switch {
	case w.hasOS && pkg != nil && pkg.Name == "os" && (name == "Getenv" || name == "LookupEnv") && len(args) == 1:
		if s, ok := stringLit(args[0]); ok && s != "" {
			w.add("envvar", s, nil, call.Pos())
		}
	case sqlMethods[name]:
		w.sql(args)
	}
	if pkg != nil && w.imports[pkg.Name] == "kafka" && name == "ConsumeTopics" {
		for _, arg := range args {
			if s, ok := stringLit(arg); ok {
				w.add("topic", s, map[string]string{"broker": "kafka", "consumer": "true"}, arg.Pos())
			}
		}
	}
	if w.importsBroker("amqp") {
		offset := -1
		switch {
		case name == "Publish" && len(args) >= 5: // amqp arity; nats Publish has 2 args
			offset = 0
		case name == "PublishWithContext" && len(args) >= 6:
			offset = 1
		case name == "QueueDeclare" || name == "Consume":
			if len(args) > 0 {
				if s, ok := stringLit(args[0]); ok && s != "" {
					w.add("topic", s, map[string]string{"broker": "amqp"}, call.Pos())
				}
			}
		}
		if offset >= 0 && len(args) > offset+1 {
			exchange, _ := stringLit(args[offset])
			key, _ := stringLit(args[offset+1])
			if topic := firstNonEmpty(key, exchange); topic != "" {
				w.add("topic", topic, map[string]string{"broker": "amqp"}, call.Pos())
			}
		}
	}
	if w.importsBroker("nats") && natsCalls[name] && len(args) > 0 {
		if s, ok := stringLit(args[0]); ok && s != "" {
			w.add("topic", s, map[string]string{"broker": "nats"}, call.Pos())
		}
	}
}

func (w *literalWalker) importsBroker(broker string) bool {
	for _, b := range w.imports {
		if b == broker {
			return true
		}
	}
	return false
}

func (w *literalWalker) sql(args []ast.Expr) {
	for i, arg := range args {
		if i > 1 {
			return
		}
		query, ok := stringLit(arg)
		if !ok {
			if id, isIdent := arg.(*ast.Ident); isIdent {
				query, ok = w.consts[id.Name]
			}
		}
		if !ok || !sqlStart.MatchString(query) {
			continue
		}
		for _, m := range sqlTable.FindAllStringSubmatch(query, -1) {
			table := strings.ReplaceAll(m[2], `"`, "")
			isCall := m[3] != "" && !strings.EqualFold(m[1], "INTO") // FROM unnest(…) is a function; INTO t (cols) is a table
			if isCall || sqlNotTables[strings.ToUpper(table)] {
				continue
			}
			w.add("table", table, nil, arg.Pos())
		}
		return
	}
}

func (w *literalWalker) composite(lit *ast.CompositeLit) {
	sel, ok := lit.Type.(*ast.SelectorExpr)
	if !ok {
		return
	}
	pkg, ok := sel.X.(*ast.Ident)
	if !ok || w.imports[pkg.Name] != "kafka" || !kafkaTopicTypes[sel.Sel.Name] {
		return
	}
	for _, elt := range lit.Elts {
		kv, ok := elt.(*ast.KeyValueExpr)
		if !ok {
			continue
		}
		if key, ok := kv.Key.(*ast.Ident); ok && key.Name == "Topic" {
			if s, ok := stringLit(kv.Value); ok && s != "" {
				attrs := map[string]string{"broker": "kafka"}
				// Separate flags survive entity merging when a topic is used in
				// both directions. Record and Message are ambiguous: both can
				// represent received data, so their type alone proves no role.
				switch sel.Sel.Name {
				case "ProducerMessage", "Writer":
					attrs["producer"] = "true"
				case "ReaderConfig":
					attrs["consumer"] = "true"
				}
				w.add("topic", s, attrs, kv.Pos())
			}
		}
	}
}
