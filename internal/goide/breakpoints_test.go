package goide

import (
	"encoding/json"
	"reflect"
	"testing"
)

func lineBreakpoints(lines ...int) []Breakpoint {
	breakpoints := make([]Breakpoint, 0, len(lines))
	for _, line := range lines {
		breakpoints = append(breakpoints, Breakpoint{Line: line})
	}
	return breakpoints
}

func TestSessionViewReadsLegacyLineBreakpoints(t *testing.T) {
	var view SessionView
	legacy := `{"breakpoints":{"main.go":[3,12]},"structureOpen":false,"bottomOpen":false,"terminalPanelOpen":false,"showIgnoredEntries":false}`
	if err := json.Unmarshal([]byte(legacy), &view); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(view.Breakpoints["main.go"], lineBreakpoints(3, 12)) {
		t.Fatalf("breakpoint del vecchio formato persi: %+v", view.Breakpoints)
	}
	var current SessionView
	if err := json.Unmarshal([]byte(`{"breakpoints":{"main.go":[{"line":4,"condition":"i > 2","disabled":true}]}}`), &current); err != nil {
		t.Fatal(err)
	}
	if got := current.Breakpoints["main.go"][0]; got != (Breakpoint{Line: 4, Condition: "i > 2", Disabled: true}) {
		t.Fatalf("breakpoint con opzioni letto male: %+v", got)
	}
}

func TestNormalizeBreakpoints(t *testing.T) {
	normalized, err := normalizeBreakpoints([]Breakpoint{{Line: 9}, {Line: 0}, {Line: 4, Condition: "  x > 1 "}, {Line: 9, HitCondition: ">= 3"}})
	if err != nil {
		t.Fatal(err)
	}
	want := []Breakpoint{{Line: 4, Condition: "x > 1"}, {Line: 9, HitCondition: ">= 3"}}
	if !reflect.DeepEqual(normalized, want) {
		t.Fatalf("normalizzazione inattesa: %+v", normalized)
	}
	for _, hit := range []string{"3", "% 2", "==4", "!= 1", "<5"} {
		if _, err := normalizeBreakpoints([]Breakpoint{{Line: 1, HitCondition: hit}}); err != nil {
			t.Fatalf("hit count %q deve essere valido: %v", hit, err)
		}
	}
	for _, hit := range []string{"abc", ">= x", "3 times"} {
		if _, err := normalizeBreakpoints([]Breakpoint{{Line: 1, HitCondition: hit}}); err == nil {
			t.Fatalf("hit count %q deve essere rifiutato", hit)
		}
	}
	if _, err := normalizeFunctionBreakpoints(FunctionBreakpointSettings{Functions: []FunctionBreakpoint{{Name: "main.a\nmain.b"}}}); err == nil {
		t.Fatal("un nome di funzione su più righe deve essere rifiutato")
	}
	functions, err := normalizeFunctionBreakpoints(FunctionBreakpointSettings{Functions: []FunctionBreakpoint{{Name: " main.run "}, {Name: "main.run"}, {Name: ""}}})
	if err != nil || len(functions.Functions) != 1 || functions.Functions[0].Name != "main.run" {
		t.Fatalf("breakpoint di funzione normalizzati male: %v %+v", err, functions)
	}
}

func TestDapSourceBreakpoints(t *testing.T) {
	breakpoints := []Breakpoint{{Line: 3}, {Line: 5, Disabled: true}, {Line: 7, Condition: "i == 2", LogMessage: "i={i}"}}
	requested, indexes := dapSourceBreakpoints(breakpoints, 0)
	want := []map[string]any{{"line": 3}, {"line": 7, "condition": "i == 2", "logMessage": "i={i}"}}
	if !reflect.DeepEqual(requested, want) || !reflect.DeepEqual(indexes, []int{0, 2}) {
		t.Fatalf("richiesta DAP inattesa: %+v %v", requested, indexes)
	}
	// Run to Cursor su una riga libera aggiunge la fermata temporanea.
	if requested, indexes = dapSourceBreakpoints(breakpoints, 10); requested[len(requested)-1]["line"] != 10 || indexes[len(indexes)-1] != -1 {
		t.Fatalf("riga di Run to Cursor mancante: %+v %v", requested, indexes)
	}
	// Su un breakpoint semplice non serve niente in più.
	if requested, _ = dapSourceBreakpoints(breakpoints, 3); len(requested) != 2 {
		t.Fatalf("riga di Run to Cursor duplicata: %+v", requested)
	}
	// Su un logpoint la fermata certa prende il suo posto: Delve tiene un solo breakpoint per riga.
	requested, indexes = dapSourceBreakpoints(breakpoints, 7)
	if !reflect.DeepEqual(requested, []map[string]any{{"line": 3}, {"line": 7}}) || !reflect.DeepEqual(indexes, []int{0, -1}) {
		t.Fatalf("Run to Cursor su un logpoint: %+v %v", requested, indexes)
	}
}

func TestDapFunctionBreakpoints(t *testing.T) {
	settings := FunctionBreakpointSettings{Functions: []FunctionBreakpoint{{Name: "main.run", HitCondition: "2"}, {Name: "main.off", Disabled: true}}, StopOnPanic: true}
	requested, indexes := dapFunctionBreakpoints(settings)
	want := []map[string]any{{"name": "main.run", "hitCondition": "2"}, {"name": panicFunction}}
	if !reflect.DeepEqual(requested, want) || !reflect.DeepEqual(indexes, []int{0, -1}) {
		t.Fatalf("richiesta DAP inattesa: %+v %v", requested, indexes)
	}
}
