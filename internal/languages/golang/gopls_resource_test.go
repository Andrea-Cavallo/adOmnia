package golang

import "testing"

func TestGoplsResourceSettingsPreserveDefaultScope(t *testing.T) {
	spec := GoplsServerSpec(GoplsInfo{}, nil, GoplsSettings{})
	budget := false
	for _, entry := range spec.Environment {
		budget = budget || entry == "GOMEMLIMIT=768MiB"
	}
	if !budget {
		t.Fatal("missing default memory budget")
	}
	defaultConfig := goplsConfiguration(GoplsSettings{})
	if _, ok := defaultConfig["expandWorkspaceToModule"]; ok {
		t.Fatal("default scope narrowed")
	}
	if _, ok := defaultConfig["directoryFilters"]; ok {
		t.Fatal("default filters changed")
	}
	if defaultConfig["diagnosticsDelay"] != "1s" {
		t.Fatal("no typing debounce")
	}
	narrow := false
	config := goplsConfiguration(GoplsSettings{DirectoryFilters: []string{"-**/node_modules"}, ExpandWorkspaceToModule: &narrow, DiagnosticsOnSave: true})
	if config["expandWorkspaceToModule"] != false || config["diagnosticsTrigger"] != "Save" || config["completeUnimported"] != true {
		t.Fatalf("configuration: %+v", config)
	}
	// L'hover è una scelta dell'utente: il dovuto è synopsis, FullDocumentation solo su richiesta.
	if defaultConfig["hoverKind"] != "SynopsisDocumentation" {
		t.Fatalf("default hoverKind = %v", defaultConfig["hoverKind"])
	}
	if config["hoverKind"] != "SynopsisDocumentation" {
		t.Fatalf("hoverKind must not change when the user did not ask: %v", config["hoverKind"])
	}
	if full := goplsConfiguration(GoplsSettings{HoverKind: HoverFull}); full["hoverKind"] != "FullDocumentation" {
		t.Fatalf("explicit full hover = %v", full["hoverKind"])
	}
}
