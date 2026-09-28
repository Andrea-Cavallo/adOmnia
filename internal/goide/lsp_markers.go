package goide

import (
	"context"
	"time"
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

// implementationTargets sceglie i simboli da interrogare: interfacce e loro metodi, tipi e metodi concreti.
func implementationTargets(symbols []SymbolNode) []implementationTarget {
	targets := make([]implementationTarget, 0, len(symbols))
	for _, node := range symbols {
		switch node.Kind {
		case symbolKindInterface:
			targets = append(targets, implementationTarget{node, "implementedBy"})
			for _, child := range node.Children {
				if child.Kind == symbolKindMethod {
					targets = append(targets, implementationTarget{child, "implementedBy"})
				}
			}
		case symbolKindStruct, symbolKindClass, symbolKindMethod:
			targets = append(targets, implementationTarget{node, "implements"})
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

// ImplementationMarkers calcola in un solo passaggio i marcatori del gutter del documento, come le icone I↑ e I↓ di GoLand.
func (s *Service) ImplementationMarkers(ctx context.Context, sessionID, documentID string) ([]ImplementationMarker, error) {
	ctx, cancel := context.WithTimeout(ctx, implementationMarkersTTL)
	defer cancel()
	symbols, _, err := s.lsp.DocumentSymbols(ctx, SessionID(sessionID), DocumentID(documentID))
	if err != nil {
		return nil, err
	}
	relativePath := ""
	if document, ok := s.documents.Get(SessionID(sessionID), DocumentID(documentID)); ok {
		relativePath = document.RelativePath
	}
	markers := make([]ImplementationMarker, 0)
	for _, target := range implementationTargets(symbols) {
		if ctx.Err() != nil {
			break
		}
		locations, err := s.lsp.Locations(ctx, SessionID(sessionID), DocumentID(documentID), "implementation", target.node.SelectionRange.StartLine, target.node.SelectionRange.StartColumn)
		if err != nil {
			continue
		}
		others := make([]EditorLocation, 0, len(locations))
		for _, location := range locations {
			if !sameLocation(location, relativePath, target.node) {
				others = append(others, location)
			}
		}
		if len(others) == 0 {
			continue
		}
		markers = append(markers, ImplementationMarker{
			Line: target.node.SelectionRange.StartLine, Column: target.node.SelectionRange.StartColumn,
			Name: target.node.Name, Direction: target.direction, Locations: others,
		})
	}
	return markers, nil
}
