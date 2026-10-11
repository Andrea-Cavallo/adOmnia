package golang

import "testing"

func TestGoplsResourceSettingsPreserveDefaultScope(t *testing.T) {
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
	if config["expandWorkspaceToModule"] != false || config["diagnosticsTrigger"] != "Save" || config["completeUnimported"] != true || config["hoverKind"] != "FullDocumentation" {
		t.Fatalf("configuration: %+v", config)
	}
}
