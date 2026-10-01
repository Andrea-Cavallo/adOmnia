package goide

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSplitModuleVersion(t *testing.T) {
	cases := map[string][2]string{
		"example.com/a@v1.2.3":  {"example.com/a", "v1.2.3"},
		"example.com/a":          {"example.com/a", ""},
		"example.com/a/b@latest": {"example.com/a/b", "latest"},
	}
	for input, want := range cases {
		path, version := splitModuleVersion(input)
		if path != want[0] || version != want[1] {
			t.Fatalf("splitModuleVersion(%q) = %q, %q; atteso %q, %q", input, path, version, want[0], want[1])
		}
	}
}

func TestFindDuplicatesDetectsDiamond(t *testing.T) {
	graph := strings.Join([]string{
		"example.com/app example.com/left@v1.0.0",
		"example.com/app example.com/right@v1.0.0",
		"example.com/left@v1.0.0 example.com/shared@v1.0.0",
		"example.com/right@v1.0.0 example.com/shared@v2.0.0",
	}, "\n")
	duplicates := findDuplicates(graph)
	if len(duplicates) != 1 || duplicates[0].Path != "example.com/shared" {
		t.Fatalf("duplicati inattesi: %+v", duplicates)
	}
	if len(duplicates[0].Versions) != 2 {
		t.Fatalf("attese due versioni duplicate: %+v", duplicates[0])
	}
	_, lookup := parseModuleGraph(graph)
	fillVersionChains(duplicates, lookup, "example.com/app@")
	if got := strings.Join(duplicates[0].Versions[1].Chain, " > "); got != "example.com/app > example.com/right@v1.0.0 > example.com/shared@v2.0.0" {
		t.Fatalf("catena inattesa: %q", got)
	}
}

func TestClassifyLicense(t *testing.T) {
	cases := map[string]string{
		"Copyright 2020\n\nLicensed under the Apache License, Version 2.0 (the \"License\");": "Apache-2.0",
		"MIT License\n\nPermission is hereby granted, free of charge, to any person":            "MIT",
		"The MIT License (MIT)\n\nTHE SOFTWARE IS PROVIDED \"AS IS\"":                            "MIT",
		"GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007":                                   "GPL-3.0",
		"Mozilla Public License Version 2.0":                                                    "MPL-2.0",
		"Copyright (c) 2020. Redistribution and use in source and binary forms":                 "BSD",
	}
	for text, want := range cases {
		if got := classifyLicense(text); got != want {
			t.Fatalf("classifyLicense(%q) = %q; atteso %q", text, got, want)
		}
	}
}

func TestDetectLicenseFromDir(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "LICENSE"), []byte("MIT License\n\nPermission is hereby granted, free of charge"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := detectLicense(dir); got != "MIT" {
		t.Fatalf("detectLicense = %q; atteso MIT", got)
	}
}

func TestParseUsedModules(t *testing.T) {
	deps := strings.Join([]string{"", "example.com/left", "example.com/shared", "example.com/shared", ""}, "\n")
	used, counts := parseUsedModules(deps, "example.com/app")
	if !used["example.com/left"] || !used["example.com/shared"] {
		t.Fatalf("moduli usati non rilevati: %v", used)
	}
	if counts["example.com/shared"] != 2 {
		t.Fatalf("conteggio pacchetti inatteso: %d", counts["example.com/shared"])
	}
}

func TestBuildDependencyGraphTreeAndDuplicates(t *testing.T) {
	list := strings.Join([]string{
		`{"Path":"example.com/app","Main":true,"Dir":"/tmp/app"}`,
		`{"Path":"example.com/left","Version":"v1.0.0","Dir":"/tmp/left"}`,
		`{"Path":"example.com/right","Version":"v1.0.0","Dir":"/tmp/right"}`,
		`{"Path":"example.com/shared","Version":"v2.0.0","Indirect":true,"Dir":"/tmp/shared"}`,
	}, "\n")
	graph := strings.Join([]string{
		"example.com/app example.com/left@v1.0.0",
		"example.com/app example.com/right@v1.0.0",
		"example.com/left@v1.0.0 example.com/shared@v1.0.0",
		"example.com/right@v1.0.0 example.com/shared@v2.0.0",
	}, "\n")
	report, err := buildDependencyGraph("example.com/app", "/tmp/app", list, graph, "")
	if err != nil {
		t.Fatal(err)
	}
	if report.DirectCount != 2 || report.TotalCount != 3 {
		t.Fatalf("conteggi inattesi: direct=%d total=%d", report.DirectCount, report.TotalCount)
	}
	depth := map[string]int{}
	for _, node := range report.Nodes {
		depth[node.Path] = node.Depth
	}
	if depth["example.com/left"] != 1 || depth["example.com/right"] != 1 || depth["example.com/shared"] != 2 {
		t.Fatalf("profondità inattese: %v", depth)
	}
	if len(report.Duplicates) != 1 || report.Duplicates[0].Path != "example.com/shared" {
		t.Fatalf("duplicato non rilevato: %+v", report.Duplicates)
	}
}

func TestParseDependencyUpdates(t *testing.T) {
	list := strings.Join([]string{
		`{"Path":"example.com/app","Main":true}`,
		`{"Path":"example.com/left","Version":"v1.0.0","Update":{"Path":"example.com/left","Version":"v1.5.0"}}`,
		`{"Path":"example.com/right","Version":"v1.0.0"}`,
	}, "\n")
	updates := parseDependencyUpdates(list)
	if len(updates) != 1 || updates[0].Path != "example.com/left" || updates[0].Latest != "v1.5.0" {
		t.Fatalf("aggiornamenti inattesi: %+v", updates)
	}
}

func TestDependencyGraphEndToEnd(t *testing.T) {
	workspace := t.TempDir()
	writeFixtureFile(t, workspace, "app/go.mod", "module example.com/app\n\ngo 1.22\n\nrequire (\n\texample.com/left v1.0.0\n\texample.com/right v1.0.0\n)\n\nreplace example.com/left => ../left\nreplace example.com/right => ../right\nreplace example.com/shared v1.0.0 => ../sharedv1\nreplace example.com/shared v1.5.0 => ../sharedv2\n")
	writeFixtureFile(t, workspace, "left/go.mod", "module example.com/left\n\ngo 1.22\n\nrequire example.com/shared v1.0.0\n")
	writeFixtureFile(t, workspace, "right/go.mod", "module example.com/right\n\ngo 1.22\n\nrequire example.com/shared v1.5.0\n")
	writeFixtureFile(t, workspace, "sharedv1/go.mod", "module example.com/shared\n\ngo 1.22\n")
	writeFixtureFile(t, workspace, "sharedv2/go.mod", "module example.com/shared\n\ngo 1.22\n")

	service := NewService(&memoryStore{}, func(EventEnvelope) {})
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(filepath.Join(workspace, "app"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetToolAuthorization(string(session.ID), true); err != nil {
		t.Fatal(err)
	}

	report, err := service.DependencyGraph(string(session.ID), "")
	if err != nil {
		t.Fatal(err)
	}
	if report.ModulePath != "example.com/app" {
		t.Fatalf("module path inatteso: %q", report.ModulePath)
	}
	if report.DirectCount != 2 {
		t.Fatalf("direct attese 2, ottenute %d", report.DirectCount)
	}
	var sharedVersion string
	for _, node := range report.Nodes {
		if node.Path == "example.com/shared" {
			sharedVersion = node.Version
		}
	}
	if sharedVersion != "v1.5.0" {
		t.Fatalf("MVS dovrebbe selezionare shared v1.5.0, ottenuta %q", sharedVersion)
	}
	if len(report.Duplicates) == 0 {
		t.Fatal("atteso un duplicato transitivo per example.com/shared")
	}
}
