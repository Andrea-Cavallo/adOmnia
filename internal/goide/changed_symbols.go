package goide

import (
	"go/ast"
	"go/parser"
	"go/token"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"adomnia/internal/git"
)

const maxChangedSymbolFiles = 200

// Stati di un simbolo rispetto a HEAD.
const (
	SymbolAdded    = "added"
	SymbolModified = "modified"
	SymbolRemoved  = "removed"
)

// VCSChangedSymbol è una dichiarazione Go di primo livello toccata dalle modifiche locali.
type VCSChangedSymbol struct {
	RelativePath string `json:"relativePath"`
	// Name è "Func", "T.Method", "(*T).Method" o il nome di tipo, costante o variabile.
	Name     string `json:"name"`
	Kind     string `json:"kind"`
	Change   string `json:"change"`
	Line     int    `json:"line"`
	Exported bool   `json:"exported"`
	// Test vale per Test*, Benchmark*, Fuzz* ed Example* nei file _test.go.
	Test bool `json:"test"`
	// Touches dice cosa tocca la dichiarazione, dedotto dal sorgente: "http", "grpc", "db", "broker".
	Touches []string `json:"touches,omitempty"`
}

// Indizi dal sorgente: firme di handler e chiamate tipiche dei client. Sono euristiche, non analisi dei tipi.
var symbolTouches = []struct {
	tag     string
	pattern *regexp.Regexp
}{
	{"http", regexp.MustCompile(`http\.ResponseWriter|\*gin\.Context|echo\.Context|\*fiber\.Ctx|\.HandleFunc\(|http\.Handle\(|\.(GET|POST|PUT|PATCH|DELETE)\("/`)},
	{"grpc", regexp.MustCompile(`grpc\.|Unimplemented\w+Server|\.Register\w+Server\(`)},
	{"db", regexp.MustCompile(`\b(sql|sqlx|pgx|pgxpool|gorm|mongo|bson|redis)\.|\.(QueryRow|Query|Exec|QueryRowContext|QueryContext|ExecContext|BeginTx|Prepare|PrepareContext)\(`)},
	{"broker", regexp.MustCompile(`\b(kafka|sarama|kgo|nats|jetstream|amqp|amqp091|pubsub|sqs|sns|kinesis|eventhub)\.|\.(Publish|PublishMsg|Produce|ProduceSync|WriteMessages|SendMessage|ReadMessage|Subscribe|QueueSubscribe|Consume)\(`)},
}

func touchesOf(source string) []string {
	tags := []string{}
	for _, item := range symbolTouches {
		if item.pattern.MatchString(source) {
			tags = append(tags, item.tag)
		}
	}
	return tags
}

type goDeclaration struct {
	name, kind     string
	start, end     int
	exported, test bool
	touches        []string
}

// VCSChangedSymbols elenca funzioni, metodi, tipi, costanti e variabili aggiunti, modificati
// o rimossi nei file Go modificati rispetto a HEAD; legge il disco, non i buffer non salvati.
func (s *Service) VCSChangedSymbols(sessionID string) ([]VCSChangedSymbol, error) {
	_, paths, err := s.vcsPaths(sessionID)
	if err != nil {
		return nil, err
	}
	status, err := s.VCSStatus(sessionID)
	if err != nil {
		return nil, err
	}
	symbols := []VCSChangedSymbol{}
	files := 0
	for _, change := range status.Changes {
		relative := filepath.ToSlash(change.RelativePath)
		if !strings.HasSuffix(relative, ".go") || change.Conflicted {
			continue
		}
		if files++; files > maxChangedSymbolFiles {
			break
		}
		repoPath, err := paths.toRepo(relative)
		if err != nil {
			continue
		}
		symbols = append(symbols, changedSymbolsInFile(paths, relative, repoPath, change)...)
	}
	sort.SliceStable(symbols, func(left, right int) bool {
		if symbols[left].RelativePath != symbols[right].RelativePath {
			return symbols[left].RelativePath < symbols[right].RelativePath
		}
		return symbols[left].Line < symbols[right].Line
	})
	return symbols, nil
}

func changedSymbolsInFile(paths vcsPaths, relative, repoPath string, change VCSFileChange) []VCSChangedSymbol {
	isTestFile := strings.HasSuffix(relative, "_test.go")
	current := []goDeclaration{}
	if !strings.Contains(change.Status, "D") {
		text, _, _, err := readTextFile(filepath.Join(paths.projectRoot, filepath.FromSlash(relative)))
		if err != nil {
			return nil
		}
		current = goDeclarations(text, isTestFile)
	}
	previous := []goDeclaration{}
	if !change.Untracked {
		if text, err := git.FileAtCommit(paths.repoRoot, "HEAD", repoPath); err == nil {
			previous = goDeclarations(text, isTestFile)
		}
	}
	var ranges []git.LineRange
	if len(previous) > 0 && len(current) > 0 {
		ranges, _ = git.ChangedLines(paths.repoRoot, repoPath)
	}
	return diffDeclarations(relative, previous, current, ranges)
}

// diffDeclarations confronta i nomi (aggiunti/rimossi) e, per quelli presenti in entrambe le
// versioni, segna modificati quelli che contengono una riga cambiata.
func diffDeclarations(relative string, previous, current []goDeclaration, ranges []git.LineRange) []VCSChangedSymbol {
	before := map[string]bool{}
	for _, declaration := range previous {
		before[declaration.kind+" "+declaration.name] = true
	}
	symbol := func(declaration goDeclaration, change string, line int) VCSChangedSymbol {
		return VCSChangedSymbol{RelativePath: relative, Name: declaration.name, Kind: declaration.kind, Change: change, Line: line, Exported: declaration.exported, Test: declaration.test, Touches: declaration.touches}
	}
	result := []VCSChangedSymbol{}
	now := map[string]bool{}
	for _, declaration := range current {
		key := declaration.kind + " " + declaration.name
		now[key] = true
		switch {
		case !before[key]:
			result = append(result, symbol(declaration, SymbolAdded, declaration.start))
		case touches(declaration, ranges):
			result = append(result, symbol(declaration, SymbolModified, declaration.start))
		}
	}
	for _, declaration := range previous {
		if !now[declaration.kind+" "+declaration.name] {
			// La riga si riferisce a HEAD: nel file attuale la dichiarazione non c'è più.
			result = append(result, symbol(declaration, SymbolRemoved, 0))
		}
	}
	return result
}

func touches(declaration goDeclaration, ranges []git.LineRange) bool {
	for _, changed := range ranges {
		if changed.Deletion {
			// Una cancellazione conta solo se cade dentro la dichiarazione, non al suo confine.
			if changed.Start >= declaration.start && changed.End <= declaration.end {
				return true
			}
			continue
		}
		if changed.Start <= declaration.end && changed.End >= declaration.start {
			return true
		}
	}
	return false
}

// goDeclarations elenca le dichiarazioni di primo livello con le righe che occupano (commento incluso).
func goDeclarations(text string, isTestFile bool) []goDeclaration {
	fileSet := token.NewFileSet()
	parsed, err := parser.ParseFile(fileSet, "", text, parser.SkipObjectResolution|parser.ParseComments)
	if err != nil {
		return []goDeclaration{}
	}
	lines := func(node ast.Node, doc *ast.CommentGroup) (int, int) {
		start := node.Pos()
		if doc != nil {
			start = doc.Pos()
		}
		return fileSet.Position(start).Line, fileSet.Position(node.End()).Line
	}
	declarations := []goDeclaration{}
	for _, declaration := range parsed.Decls {
		switch value := declaration.(type) {
		case *ast.FuncDecl:
			start, end := lines(value, value.Doc)
			kind := "func"
			if value.Recv != nil {
				kind = "method"
			}
			name := value.Name.Name
			test := isTestFile && value.Recv == nil && isTestFunctionName(name)
			// Solo firma e corpo, non il commento: un handler si riconosce da ciò che fa.
			source := text[fileSet.Position(value.Pos()).Offset:fileSet.Position(value.End()).Offset]
			declarations = append(declarations, goDeclaration{name: functionName(value), kind: kind, start: start, end: end, exported: ast.IsExported(name), test: test, touches: touchesOf(source)})
		case *ast.GenDecl:
			kind := map[token.Token]string{token.TYPE: "type", token.CONST: "const", token.VAR: "var"}[value.Tok]
			if kind == "" {
				continue
			}
			for _, spec := range value.Specs {
				start, end := lines(spec, nil)
				if len(value.Specs) == 1 {
					start, end = lines(value, value.Doc)
				}
				for _, name := range specNames(spec) {
					declarations = append(declarations, goDeclaration{name: name, kind: kind, start: start, end: end, exported: ast.IsExported(name)})
				}
			}
		}
	}
	return declarations
}

func specNames(spec ast.Spec) []string {
	switch value := spec.(type) {
	case *ast.TypeSpec:
		return []string{value.Name.Name}
	case *ast.ValueSpec:
		names := []string{}
		for _, name := range value.Names {
			if name.Name != "_" {
				names = append(names, name.Name)
			}
		}
		return names
	}
	return nil
}

func isTestFunctionName(name string) bool {
	for _, prefix := range []string{"Test", "Benchmark", "Fuzz", "Example"} {
		if strings.HasPrefix(name, prefix) {
			return true
		}
	}
	return false
}
