package codestudio

import (
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/language"
	"github.com/Andrea-Cavallo/adOmnia/internal/languages/java"
)

func symbol(kind, line int, name string, children ...SymbolNode) SymbolNode {
	return SymbolNode{Name: name, Kind: kind, SelectionRange: EditorRange{StartLine: line, StartColumn: 1}, Children: children}
}

func targetNames(targets []implementationTarget) []string {
	names := make([]string, 0, len(targets))
	for _, target := range targets {
		names = append(names, target.node.Name+":"+target.direction)
	}
	return names
}

// JDT LS risponde a textDocument/implementation sempre "in basso": il marcatore dice quanti
// sottotipi o override esistono, anche per i metodi dentro una classe.
func TestImplementationTargetsFollowTheLanguageSemantics(t *testing.T) {
	semantics, ok := any(java.New()).(language.ImplementationMarkers)
	if !ok {
		t.Fatal("the Java adapter must declare its implementation semantics")
	}
	symbols := []SymbolNode{
		symbol(symbolKindClass, 1, "OrderService",
			symbol(symbolKindMethod, 3, "run"),
			symbol(symbolKindMethod, 4, "stop"),
			symbol(8, 5, "field"),
		),
		symbol(symbolKindInterface, 8, "Shape",
			symbol(symbolKindMethod, 9, "area"),
		),
	}
	got := targetNames(implementationTargets(symbols, semantics))
	want := []string{"OrderService:implementedBy", "run:implementedBy", "stop:implementedBy", "Shape:implementedBy", "area:implementedBy"}
	if len(got) != len(want) {
		t.Fatalf("targets = %v, want %v", got, want)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("targets = %v, want %v", got, want)
		}
	}
}

// Senza capability resta la semantica di Go: le interfacce sono implementate, i tipi implementano.
func TestImplementationTargetsKeepGoSemanticsWithoutACapability(t *testing.T) {
	symbols := []SymbolNode{
		symbol(symbolKindInterface, 1, "Shape", symbol(symbolKindMethod, 2, "area")),
		symbol(symbolKindStruct, 5, "Circle"),
		symbol(symbolKindMethod, 6, "area"),
	}
	got := targetNames(implementationTargets(symbols, nil))
	want := []string{"Shape:implementedBy", "area:implementedBy", "Circle:implements", "area:implements"}
	if len(got) != len(want) {
		t.Fatalf("targets = %v, want %v", got, want)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("targets = %v, want %v", got, want)
		}
	}
}

func TestImplementationTargetsStayWithinTheLimit(t *testing.T) {
	semantics, _ := any(java.New()).(language.ImplementationMarkers)
	var symbols []SymbolNode
	for index := range maxImplementationTargets + 25 {
		symbols = append(symbols, symbol(symbolKindMethod, index+1, "m"))
	}
	if got := implementationTargets(symbols, semantics); len(got) != maxImplementationTargets {
		t.Fatalf("targets = %d, want %d", len(got), maxImplementationTargets)
	}
}
