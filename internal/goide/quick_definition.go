package goide

import (
	"context"
	"fmt"
	"strings"
)

const maxQuickDefinitionLines = 120

// QuickDefinitionResult è il sorgente della dichiarazione da mostrare in popup, senza lasciare il file corrente.
type QuickDefinitionResult struct {
	Found     bool           `json:"found"`
	Location  EditorLocation `json:"location"`
	Code      string         `json:"code"`
	StartLine int            `json:"startLine"`
	Truncated bool           `json:"truncated"`
}

// QuickDefinition risolve la definizione con gopls e ne estrae la dichiarazione completa tramite AST.
func (m *LSPManager) QuickDefinition(ctx context.Context, sessionID SessionID, documentID DocumentID, line, column int) (QuickDefinitionResult, error) {
	locations, err := m.Locations(ctx, sessionID, documentID, "definition", line, column)
	if err != nil || len(locations) == 0 {
		return QuickDefinitionResult{}, err
	}
	state, ok := m.forDocument(sessionID, documentID)
	if !ok {
		return QuickDefinitionResult{}, fmt.Errorf("documento non sincronizzato con un language server")
	}
	location := locations[0]
	text := m.documentText(state, location.URI, location.Path)
	code, startLine, truncated := declarationSource(m.languages, location.Path, text, location.Range)
	return QuickDefinitionResult{Found: code != "", Location: location, Code: code, StartLine: startLine, Truncated: truncated}, nil
}

func clipLines(code string, startLine int) (string, int, bool) {
	lines := strings.Split(code, "\n")
	if len(lines) <= maxQuickDefinitionLines {
		return code, startLine, false
	}
	return strings.Join(lines[:maxQuickDefinitionLines], "\n"), startLine, true
}
