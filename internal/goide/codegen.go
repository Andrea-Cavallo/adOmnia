package goide

import (
	"errors"
	"fmt"
	"go/ast"
	"go/format"
	"go/parser"
	"go/token"
	"go/types"
	"strings"
	"unicode"
)

// Generatori di codice di Go Studio: costruttore, getter/setter, interfaccia estratta,
// benchmark e fuzz test. Lavorano sul testo dell'editor (anche non salvato) con go/ast;
// solo lo snippet generato passa da go/format, il resto del file resta identico.

// CodeGenRequest descrive cosa generare e dove.
type CodeGenRequest struct {
	// Kind: constructor, getters, setters, interface, benchmark, fuzz.
	Kind string `json:"kind"`
	Text string `json:"text"`
	// Line (1-based) seleziona la struct o la funzione che contiene il cursore.
	Line int `json:"line"`
	// TestText è il contenuto attuale del file _test.go ("" se non esiste).
	TestText string `json:"testText"`
}

// CodeGenResult contiene il file sorgente o il file di test aggiornati (vuoto se invariato).
type CodeGenResult struct {
	Text     string `json:"text,omitempty"`
	TestText string `json:"testText,omitempty"`
	// Symbol è il nome generato, da mostrare e su cui posizionare il cursore.
	Symbol string `json:"symbol"`
}

const maxCodeGenSource = 4 << 20

// GenerateGoCode esegue il generatore richiesto; gli errori spiegano cosa serve al cursore.
func GenerateGoCode(request CodeGenRequest) (CodeGenResult, error) {
	if len(request.Text) > maxCodeGenSource || len(request.TestText) > maxCodeGenSource {
		return CodeGenResult{}, errors.New("file troppo grande per il generatore")
	}
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "", request.Text, parser.ParseComments|parser.SkipObjectResolution)
	if err != nil {
		return CodeGenResult{}, fmt.Errorf("il file non si analizza: correggi prima gli errori di sintassi (%v)", err)
	}
	switch request.Kind {
	case "constructor", "getters", "setters", "interface":
		spec, structType, end, err := structAtLine(fset, file, request.Line)
		if err != nil {
			return CodeGenResult{}, err
		}
		code, symbol, err := structCode(request.Kind, file, spec, structType)
		if err != nil {
			return CodeGenResult{}, err
		}
		return insertAfter(request.Text, fset.Position(end).Offset, code, symbol)
	case "benchmark", "fuzz":
		function, err := funcAtLine(fset, file, request.Line)
		if err != nil {
			return CodeGenResult{}, err
		}
		code, symbol, err := testCode(request.Kind, function)
		if err != nil {
			return CodeGenResult{}, err
		}
		if strings.Contains(request.TestText, "func "+symbol+"(") {
			return CodeGenResult{}, fmt.Errorf("%s esiste già nel file di test", symbol)
		}
		testText, err := appendToTestFile(request.TestText, file.Name.Name, code)
		if err != nil {
			return CodeGenResult{}, err
		}
		return CodeGenResult{TestText: testText, Symbol: symbol}, nil
	default:
		return CodeGenResult{}, fmt.Errorf("generatore sconosciuto: %q", request.Kind)
	}
}

func structAtLine(fset *token.FileSet, file *ast.File, line int) (*ast.TypeSpec, *ast.StructType, token.Pos, error) {
	for _, decl := range file.Decls {
		gen, ok := decl.(*ast.GenDecl)
		if !ok || gen.Tok != token.TYPE || !containsLine(fset, gen, line) {
			continue
		}
		for _, spec := range gen.Specs {
			typeSpec := spec.(*ast.TypeSpec)
			structType, isStruct := typeSpec.Type.(*ast.StructType)
			if isStruct && (len(gen.Specs) == 1 || containsLine(fset, typeSpec, line)) {
				return typeSpec, structType, gen.End(), nil
			}
		}
	}
	return nil, nil, token.NoPos, errors.New("metti il cursore su una struct")
}

func funcAtLine(fset *token.FileSet, file *ast.File, line int) (*ast.FuncDecl, error) {
	for _, decl := range file.Decls {
		if function, ok := decl.(*ast.FuncDecl); ok && containsLine(fset, function, line) {
			return function, nil
		}
	}
	return nil, errors.New("metti il cursore su una funzione o un metodo")
}

func containsLine(fset *token.FileSet, node ast.Node, line int) bool {
	return fset.Position(node.Pos()).Line <= line && line <= fset.Position(node.End()).Line
}

type structField struct {
	name     string
	typeText string
	exported bool
}

func fieldsOf(structType *ast.StructType) []structField {
	var fields []structField
	for _, field := range structType.Fields.List {
		typeText := types.ExprString(field.Type)
		if len(field.Names) == 0 {
			// Campo incorporato: il nome è quello del tipo, senza puntatore né package.
			name := strings.TrimPrefix(typeText, "*")
			name = name[strings.LastIndex(name, ".")+1:]
			fields = append(fields, structField{name: name, typeText: typeText, exported: ast.IsExported(name)})
			continue
		}
		for _, name := range field.Names {
			if name.Name != "_" {
				fields = append(fields, structField{name: name.Name, typeText: typeText, exported: name.IsExported()})
			}
		}
	}
	return fields
}

// methodsOf elenca i metodi del tipo dichiarati nel file (ricevitore valore o puntatore).
func methodsOf(file *ast.File, typeName string) []*ast.FuncDecl {
	var methods []*ast.FuncDecl
	for _, decl := range file.Decls {
		function, ok := decl.(*ast.FuncDecl)
		if !ok || function.Recv == nil || len(function.Recv.List) == 0 {
			continue
		}
		receiver := strings.TrimPrefix(types.ExprString(function.Recv.List[0].Type), "*")
		if index := strings.Index(receiver, "["); index >= 0 {
			receiver = receiver[:index]
		}
		if receiver == typeName {
			methods = append(methods, function)
		}
	}
	return methods
}

func declaredFunc(file *ast.File, name string) bool {
	for _, decl := range file.Decls {
		if function, ok := decl.(*ast.FuncDecl); ok && function.Recv == nil && function.Name.Name == name {
			return true
		}
	}
	return false
}

func structCode(kind string, file *ast.File, spec *ast.TypeSpec, structType *ast.StructType) (string, string, error) {
	if spec.TypeParams != nil && spec.TypeParams.NumFields() > 0 {
		return "", "", errors.New("le struct generiche non sono ancora supportate dal generatore")
	}
	typeName := spec.Name.Name
	fields := fieldsOf(structType)
	receiver := receiverName(typeName)
	existing := map[string]bool{}
	for _, method := range methodsOf(file, typeName) {
		existing[method.Name.Name] = true
	}
	var code strings.Builder
	switch kind {
	case "constructor":
		name := "New" + upperFirst(typeName)
		if declaredFunc(file, name) {
			return "", "", fmt.Errorf("%s esiste già", name)
		}
		params := make([]string, 0, len(fields))
		assignments := make([]string, 0, len(fields))
		for _, field := range fields {
			param := parameterName(field.name)
			params = append(params, param+" "+field.typeText)
			assignments = append(assignments, field.name+": "+param+",")
		}
		fmt.Fprintf(&code, "// %s crea un %s.\nfunc %s(%s) *%s {\n\treturn &%s{\n%s\n\t}\n}\n", name, typeName, name, strings.Join(params, ", "), typeName, typeName, strings.Join(assignments, "\n"))
		return code.String(), name, nil
	case "getters", "setters":
		first := ""
		for _, field := range fields {
			if field.exported {
				continue
			}
			method := upperFirst(field.name)
			if kind == "setters" {
				method = "Set" + method
			}
			if existing[method] {
				continue
			}
			if first == "" {
				first = method
			}
			if kind == "getters" {
				fmt.Fprintf(&code, "// %s restituisce %s.\nfunc (%s *%s) %s() %s {\n\treturn %s.%s\n}\n\n", method, field.name, receiver, typeName, method, field.typeText, receiver, field.name)
			} else {
				fmt.Fprintf(&code, "// %s imposta %s.\nfunc (%s *%s) %s(%s %s) {\n\t%s.%s = %s\n}\n\n", method, field.name, receiver, typeName, method, parameterName(field.name), field.typeText, receiver, field.name, parameterName(field.name))
			}
		}
		if first == "" {
			return "", "", errors.New("nessun campo non esportato senza accessor: i campi esportati si usano direttamente")
		}
		return code.String(), first, nil
	default: // interface
		name := typeName + "Interface"
		var methods []string
		for _, method := range methodsOf(file, typeName) {
			if !method.Name.IsExported() {
				continue
			}
			signature := strings.TrimPrefix(types.ExprString(method.Type), "func")
			methods = append(methods, "\t"+method.Name.Name+signature)
		}
		if len(methods) == 0 {
			return "", "", fmt.Errorf("%s non ha metodi esportati in questo file", typeName)
		}
		fmt.Fprintf(&code, "// %s descrive il comportamento di %s.\ntype %s interface {\n%s\n}\n", name, typeName, name, strings.Join(methods, "\n"))
		return code.String(), name, nil
	}
}

func insertAfter(text string, offset int, code, symbol string) (CodeGenResult, error) {
	formatted, err := format.Source([]byte(code))
	if err != nil {
		return CodeGenResult{}, fmt.Errorf("codice generato non valido: %w", err)
	}
	return CodeGenResult{Text: text[:offset] + "\n\n" + strings.TrimRight(string(formatted), "\n") + text[offset:], Symbol: symbol}, nil
}

var fuzzableTypes = map[string]bool{
	"string": true, "[]byte": true, "bool": true, "byte": true, "rune": true, "float32": true, "float64": true,
	"int": true, "int8": true, "int16": true, "int32": true, "int64": true,
	"uint": true, "uint8": true, "uint16": true, "uint32": true, "uint64": true,
}

type callParameter struct {
	name     string
	typeText string
	variadic bool
}

func parametersOf(function *ast.FuncDecl) []callParameter {
	var params []callParameter
	index := 0
	for _, field := range function.Type.Params.List {
		typeExpr := field.Type
		variadic := false
		if ellipsis, ok := typeExpr.(*ast.Ellipsis); ok {
			typeExpr, variadic = ellipsis.Elt, true
		}
		typeText := types.ExprString(typeExpr)
		names := field.Names
		if len(names) == 0 {
			names = []*ast.Ident{{Name: "_"}}
		}
		for _, name := range names {
			param := name.Name
			if param == "_" {
				param = fmt.Sprintf("arg%d", index)
			}
			if variadic {
				typeText = "[]" + typeText
			}
			params = append(params, callParameter{name: param, typeText: typeText, variadic: variadic})
			index++
		}
	}
	return params
}

func testCode(kind string, function *ast.FuncDecl) (string, string, error) {
	if function.Type.TypeParams != nil && function.Type.TypeParams.NumFields() > 0 {
		return "", "", errors.New("le funzioni generiche non sono ancora supportate dal generatore")
	}
	params := parametersOf(function)
	target := function.Name.Name
	suffix := upperFirst(target)
	call := target
	receiverDecl := ""
	if function.Recv != nil && len(function.Recv.List) > 0 {
		receiverType := strings.TrimPrefix(types.ExprString(function.Recv.List[0].Type), "*")
		suffix = upperFirst(receiverType) + "_" + upperFirst(target)
		receiverDecl = "var receiver " + receiverType
		call = "receiver." + target
	}
	arguments := make([]string, 0, len(params))
	for _, param := range params {
		argument := param.name
		if param.variadic {
			argument += "..."
		}
		arguments = append(arguments, argument)
	}
	callText := fmt.Sprintf("%s(%s)", call, strings.Join(arguments, ", "))
	var code strings.Builder
	if kind == "benchmark" {
		name := "Benchmark" + suffix
		fmt.Fprintf(&code, "func %s(b *testing.B) {\n", name)
		if receiverDecl != "" {
			code.WriteString("\t" + receiverDecl + "\n")
		}
		for _, param := range params {
			fmt.Fprintf(&code, "\tvar %s %s // TODO: realistic input\n", param.name, param.typeText)
		}
		fmt.Fprintf(&code, "\tb.ReportAllocs()\n\tfor i := 0; i < b.N; i++ {\n\t\t%s\n\t}\n}\n", callText)
		return code.String(), name, nil
	}
	name := "Fuzz" + suffix
	var fuzzParams, seeds []string
	for _, param := range params {
		if !fuzzableTypes[param.typeText] || param.variadic {
			return "", "", fmt.Errorf("i fuzz test accettano solo string, []byte, bool e tipi numerici: %s è %s", param.name, param.typeText)
		}
		fuzzParams = append(fuzzParams, param.name+" "+param.typeText)
		seeds = append(seeds, zeroLiteral(param.typeText))
	}
	if len(params) == 0 {
		return "", "", errors.New("un fuzz test serve a una funzione con parametri")
	}
	fmt.Fprintf(&code, "func %s(f *testing.F) {\n\tf.Add(%s) // TODO: add seed inputs\n\tf.Fuzz(func(t *testing.T, %s) {\n", name, strings.Join(seeds, ", "), strings.Join(fuzzParams, ", "))
	if receiverDecl != "" {
		code.WriteString("\t\t" + receiverDecl + "\n")
	}
	fmt.Fprintf(&code, "\t\t%s\n\t})\n}\n", callText)
	return code.String(), name, nil
}

func zeroLiteral(typeText string) string {
	switch typeText {
	case "string":
		return `""`
	case "[]byte":
		return "[]byte{}"
	case "bool":
		return "false"
	case "int":
		return "0"
	default:
		// f.Add vuole esattamente i tipi del target: 0 non tipizzato sarebbe int.
		return typeText + "(0)"
	}
}

// appendToTestFile aggiunge lo snippet al file di test (o lo crea) e garantisce l'import "testing".
func appendToTestFile(testText, packageName, code string) (string, error) {
	formatted, err := format.Source([]byte(code))
	if err != nil {
		return "", fmt.Errorf("codice generato non valido: %w", err)
	}
	snippet := strings.TrimRight(string(formatted), "\n") + "\n"
	if strings.TrimSpace(testText) == "" {
		return fmt.Sprintf("package %s\n\nimport \"testing\"\n\n%s", packageName, snippet), nil
	}
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "", testText, parser.ImportsOnly)
	if err != nil {
		return "", fmt.Errorf("il file di test non si analizza: %v", err)
	}
	text := testText
	if !importsPackage(file, "testing") {
		text = addImport(fset, file, text, "testing")
	}
	return strings.TrimRight(text, "\n") + "\n\n" + snippet, nil
}

func importsPackage(file *ast.File, path string) bool {
	for _, spec := range file.Imports {
		if strings.Trim(spec.Path.Value, "\"`") == path {
			return true
		}
	}
	return false
}

// addImport inserisce un import senza riscrivere il resto del file.
func addImport(fset *token.FileSet, file *ast.File, text, path string) string {
	for _, decl := range file.Decls {
		gen, ok := decl.(*ast.GenDecl)
		if !ok || gen.Tok != token.IMPORT {
			continue
		}
		if gen.Lparen.IsValid() {
			offset := fset.Position(gen.Lparen).Offset + 1
			return text[:offset] + "\n\t\"" + path + "\"" + text[offset:]
		}
		offset := fset.Position(gen.Pos()).Offset
		return text[:offset] + "import \"" + path + "\"\n" + text[offset:]
	}
	offset := fset.Position(file.Name.End()).Offset
	return text[:offset] + "\n\nimport \"" + path + "\"" + text[offset:]
}

func receiverName(typeName string) string {
	for _, r := range typeName {
		return string(unicode.ToLower(r))
	}
	return "v"
}

func upperFirst(name string) string {
	for index, r := range name {
		return string(unicode.ToUpper(r)) + name[index+len(string(r)):]
	}
	return name
}

var goKeywords = map[string]bool{
	"break": true, "case": true, "chan": true, "const": true, "continue": true, "default": true, "defer": true, "else": true,
	"fallthrough": true, "for": true, "func": true, "go": true, "goto": true, "if": true, "import": true, "interface": true,
	"map": true, "package": true, "range": true, "return": true, "select": true, "struct": true, "switch": true, "type": true, "var": true,
}

// parameterName: il nome del campo in lowerCamelCase secondo le convenzioni Go per le
// sigle (ID → id, URLPath → urlPath), evitando le parole chiave (type → typeValue).
func parameterName(field string) string {
	runes := []rune(field)
	upper := 0
	for upper < len(runes) && unicode.IsUpper(runes[upper]) {
		upper++
	}
	// In "URLPath" la P inizia la parola successiva e resta maiuscola.
	if upper > 1 && upper < len(runes) {
		upper--
	}
	for index := 0; index < upper || (index == 0 && len(runes) > 0); index++ {
		runes[index] = unicode.ToLower(runes[index])
	}
	name := string(runes)
	if goKeywords[name] {
		return name + "Value"
	}
	return name
}
