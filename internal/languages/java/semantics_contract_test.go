package java

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"strings"
	"testing"
)

// ownershipMarker è il contratto di possesso di JS-6: chi decide localmente "cos'è una main"
// lanciabile è un fallback marcato. Quando JDT LS è ready la semantica è sua (vscode.java.resolveMainClass),
// le regex locali esistono solo senza server.
const ownershipMarker = "fallback: JDT decide quando è ready"

// TestLocalJavaSemanticsAreMarkedFallback è il check di CI del contratto: una nuova regola locale di
// semantica Java (una regex o una funzione che scopre main/classi lanciabili) senza il marker fa
// fallire la build. Le regex non tornano a essere la fonte di verità.
func TestLocalJavaSemanticsAreMarkedFallback(t *testing.T) {
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	semanticRules := map[string]bool{"findMainClasses": true, "readMainClass": true, "ScanMainClasses": true}
	checked := 0
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		file, err := parser.ParseFile(token.NewFileSet(), name, nil, parser.ParseComments)
		if err != nil {
			t.Fatalf("parse %s: %v", name, err)
		}
		for _, declaration := range file.Decls {
			function, ok := declaration.(*ast.FuncDecl)
			if !ok || function.Body == nil {
				continue
			}
			decides := semanticRules[function.Name.Name]
			ast.Inspect(function.Body, func(node ast.Node) bool {
				if identifier, ok := node.(*ast.Ident); ok && identifier.Name == "mainMethod" {
					decides = true
				}
				return true
			})
			if !decides {
				continue
			}
			checked++
			if function.Doc == nil || !strings.Contains(function.Doc.Text(), ownershipMarker) {
				t.Errorf("%s: %s decide la semantica Java locale senza il marker %q: aggiungere il commento (e la nota che è fallback) oppure passare da JDT LS", name, function.Name.Name, ownershipMarker)
			}
		}
	}
	if checked < 3 {
		t.Fatalf("il contratto non ha trovato abbastanza regole da controllare (%d): è cambiato il codice?", checked)
	}
}
