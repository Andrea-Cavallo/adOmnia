package goide

import (
	"context"
	"strings"
	"testing"
)

func TestEditorFeaturesWithRealGopls(t *testing.T) {
	gopls := findGoplsForTest(t)
	root := copyFixture(t, "editorfeatures")
	recorder := &eventRecorder{}
	service := NewService(&memoryStore{}, recorder.record)
	t.Cleanup(service.Shutdown)
	session := startLanguageServerForTest(t, service, recorder, root, gopls)
	sessionID := string(session.ID)
	ctx := context.Background()

	status, err := service.LanguageServerStatus(sessionID)
	if err != nil || status.Features == nil {
		t.Fatalf("capacità gopls non registrate: %v %+v", err, status)
	}
	features := *status.Features
	if !features.SemanticTokens || !features.InlayHints || !features.DocumentHighlight || !features.CallHierarchy || len(features.TokenTypes) == 0 {
		t.Fatalf("funzioni gopls attese non annunciate: %+v", features)
	}

	document, err := service.OpenDocument(sessionID, "main.go")
	if err != nil {
		t.Fatal(err)
	}
	documentID := string(document.Document.ID)
	text := document.Content

	tokens, err := service.SemanticTokens(ctx, sessionID, documentID)
	if err != nil || len(tokens.Data) == 0 || len(tokens.Data)%5 != 0 {
		t.Fatalf("semantic tokens inattesi: %v %d", err, len(tokens.Data))
	}

	hints, err := service.InlayHints(ctx, sessionID, documentID, EditorRange{StartLine: 1, StartColumn: 1, EndLine: 26, EndColumn: 1})
	if err != nil || !hasInlayHint(hints, "n:") {
		t.Fatalf("inlay hint del parametro n mancante: %v %+v", err, hints)
	}

	line, column := positionOf(t, text, `return "yes"`, 0)
	exits, err := service.DocumentHighlights(ctx, sessionID, documentID, line, column)
	if err != nil || len(exits.Highlights) < 2 {
		t.Fatalf("punti di uscita inattesi: %v %+v", err, exits)
	}

	recursive, err := service.RecursiveCalls(ctx, sessionID, documentID)
	if err != nil || len(recursive.Calls) != 1 || recursive.Calls[0].Function != "Fact" || recursive.Calls[0].Range.StartLine != 10 {
		t.Fatalf("chiamate ricorsive inattese: %v %+v", err, recursive)
	}

	line, column = positionOf(t, text, "Fact(5)", 1)
	quick, err := service.QuickDefinition(ctx, sessionID, documentID, line, column)
	if err != nil || !quick.Found || quick.StartLine != 5 || !strings.HasPrefix(quick.Code, "// Fact calcola") || !strings.HasSuffix(quick.Code, "}") {
		t.Fatalf("quick definition inattesa: %v %+v", err, quick)
	}

	line, column = positionOf(t, text, "total := 0", 1)
	usages, err := service.Locations(ctx, sessionID, documentID, "references", line, column)
	if err != nil {
		t.Fatal(err)
	}
	kinds := make([]string, 0, len(usages))
	for _, usage := range usages {
		kinds = append(kinds, usage.Usage)
	}
	if strings.Join(kinds, ",") != "declaration,write,write,read" {
		t.Fatalf("tipi di utilizzo inattesi: %v", kinds)
	}
}

func hasInlayHint(result InlayHintsResult, label string) bool {
	for _, hint := range result.Hints {
		if strings.TrimSpace(hint.Label) == label {
			return true
		}
	}
	return false
}

func TestEditorSettingsProduceNoGoplsWarnings(t *testing.T) {
	gopls := findGoplsForTest(t)
	root := copyFixture(t, "editorfeatures")
	recorder := &eventRecorder{}
	service := NewService(&memoryStore{}, recorder.record)
	t.Cleanup(service.Shutdown)
	session := startLanguageServerForTest(t, service, recorder, root, gopls)
	document, err := service.OpenDocument(string(session.ID), "main.go")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SemanticTokens(context.Background(), string(session.ID), string(document.Document.ID)); err != nil {
		t.Fatal(err)
	}
	for _, event := range recorder.all() {
		if message, ok := event.Payload.(LanguageServerMessage); ok && strings.Contains(message.Message, "setting") {
			t.Fatalf("gopls segnala impostazioni non valide: %s", message.Message)
		}
	}
}
