package langserver

import (
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/language"
)

const (
	maxImplementationTargets = 80
	implementationMarkersTTL = 8 * time.Second
	// Kind LSP dei simboli: 5 Class, 6 Method, 11 Interface, 23 Struct.
	symbolKindClass     = 5
	symbolKindMethod    = 6
	symbolKindInterface = 11
	symbolKindStruct    = 23
)

// ImplementationMarker è un marcatore del gutter: un'interfaccia (o un suo metodo) implementata altrove,
// oppure un tipo (o metodo) che implementa interfacce. Locations sono le destinazioni della navigazione.
type ImplementationMarker struct {
	Line      int              `json:"line"`
	Column    int              `json:"column"`
	Name      string           `json:"name"`
	Direction string           `json:"direction"` // "implementedBy" oppure "implements"
	Locations []EditorLocation `json:"locations"`
}

type implementationTarget struct {
	node      SymbolNode
	direction string
}

// implementationTargets sceglie i simboli da interrogare, ricorsivamente: un override vive dentro
// la classe che lo dichiara, non solo dentro un'interfaccia. La direzione la dichiara l'adapter del
// linguaggio; senza la capability resta la semantica storica di Go, invariata.
func implementationTargets(symbols []SymbolNode, semantics language.ImplementationMarkers) []implementationTarget {
	if semantics == nil {
		return legacyImplementationTargets(symbols)
	}
	direction := semantics.ImplementationDirection
	targets := make([]implementationTarget, 0, len(symbols))
	var visit func(nodes []SymbolNode)
	visit = func(nodes []SymbolNode) {
		for _, node := range nodes {
			if len(targets) >= maxImplementationTargets {
				return
			}
			if value := direction(node.Kind); value != "" {
				targets = append(targets, implementationTarget{node, value})
			}
			visit(node.Children)
		}
	}
	visit(symbols)
	return targets
}

// legacyImplementationTargets è la semantica di Go precedente alla capability: interfacce e loro
// metodi implementati, tipi e metodi concreti che implementano interfacce.
func legacyImplementationTargets(symbols []SymbolNode) []implementationTarget {
	targets := make([]implementationTarget, 0, len(symbols))
	for _, node := range symbols {
		switch node.Kind {
		case symbolKindInterface:
			targets = append(targets, implementationTarget{node, language.MarkerImplementedBy})
			for _, child := range node.Children {
				if child.Kind == symbolKindMethod {
					targets = append(targets, implementationTarget{child, language.MarkerImplementedBy})
				}
			}
		case symbolKindStruct, symbolKindClass, symbolKindMethod:
			targets = append(targets, implementationTarget{node, language.MarkerImplements})
		}
		if len(targets) >= maxImplementationTargets {
			return targets[:maxImplementationTargets]
		}
	}
	return targets
}

func sameLocation(location EditorLocation, relativePath string, node SymbolNode) bool {
	return location.RelativePath == relativePath && location.Range.StartLine == node.SelectionRange.StartLine
}
