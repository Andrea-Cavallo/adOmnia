package goide

import (
	"context"
	"slices"
	"strings"
	"testing"
)

func hierarchyNames(items []HierarchyItem) []string {
	names := make([]string, 0, len(items))
	for _, item := range items {
		names = append(names, item.Name)
	}
	return names
}

// Call Hierarchy e Type Hierarchy con il gopls reale: Hello è chiamata da main e da
// English.Greet; English implementa Greeter.
func TestHierarchiesWithRealGopls(t *testing.T) {
	gopls := findGoplsForTest(t)
	recorder := &eventRecorder{}
	service := NewService(&memoryStore{}, recorder.record)
	defer service.Shutdown()
	session := startLanguageServerForTest(t, service, recorder, copyFixture(t, "multipkg"), gopls)
	sessionID := string(session.ID)
	ctx := context.Background()

	greet, err := service.OpenDocument(sessionID, "greet/greet.go")
	if err != nil {
		t.Fatal(err)
	}
	documentID := string(greet.Document.ID)
	helloLine := lineOf(t, greet.Content, "func Hello(")
	roots, err := service.PrepareHierarchy(ctx, sessionID, documentID, "call", helloLine, 6)
	if err != nil || len(roots) != 1 || roots[0].Name != "Hello" {
		t.Fatalf("prepare call hierarchy: %v %v", hierarchyNames(roots), err)
	}
	callers, err := service.ExpandHierarchy(ctx, sessionID, "incoming", roots[0].Token)
	if err != nil {
		t.Fatal(err)
	}
	names := hierarchyNames(callers)
	if !slices.Contains(names, "main") || !slices.ContainsFunc(names, func(name string) bool { return strings.Contains(name, "Greet") }) {
		t.Fatalf("incoming calls of Hello = %v, want main and Greet", names)
	}
	for _, caller := range callers {
		if len(caller.CallSites) == 0 || caller.Location.RelativePath == "" {
			t.Fatalf("caller %s without call sites or location: %+v", caller.Name, caller)
		}
	}

	greeterLine := lineOf(t, greet.Content, "type Greeter interface")
	types, err := service.PrepareHierarchy(ctx, sessionID, documentID, "type", greeterLine, 6)
	if err != nil || len(types) != 1 {
		t.Fatalf("prepare type hierarchy: %v %v", hierarchyNames(types), err)
	}
	subtypes, err := service.ExpandHierarchy(ctx, sessionID, "subtypes", types[0].Token)
	if err != nil || !slices.Contains(hierarchyNames(subtypes), "English") {
		t.Fatalf("subtypes of Greeter = %v, %v", hierarchyNames(subtypes), err)
	}

	// Generate Test (Code → Generate…): gopls "Add test" scrive un test table-driven in greet_test.go.
	caret := EditorRange{StartLine: helloLine, StartColumn: 6, EndLine: helloLine, EndColumn: 6}
	actions, err := service.CodeActions(ctx, sessionID, documentID, caret, []string{"source.addTest"})
	if err != nil || len(actions) == 0 {
		t.Fatalf("gopls offers no source.addTest on Hello: %v %+v", err, actions)
	}
	change, err := service.ResolveCodeAction(ctx, sessionID, actions[0].ID)
	if err != nil || len(change.Files) != 1 || !strings.HasSuffix(change.Files[0].RelativePath, "greet_test.go") || !strings.Contains(change.Files[0].NewContent, "func TestHello(") {
		t.Fatalf("add test change: %v %+v", err, change)
	}

	if _, err := service.ExpandHierarchy(ctx, sessionID, "sideways", roots[0].Token); err == nil {
		t.Fatal("unknown direction accepted")
	}
	if _, err := service.ExpandHierarchy(ctx, sessionID, "incoming", "{}"); err == nil {
		t.Fatal("empty token accepted")
	}
}

func lineOf(t *testing.T, content, prefix string) int {
	t.Helper()
	for index, line := range strings.Split(content, "\n") {
		if strings.HasPrefix(line, prefix) {
			return index + 1
		}
	}
	t.Fatalf("%q not found", prefix)
	return 0
}
