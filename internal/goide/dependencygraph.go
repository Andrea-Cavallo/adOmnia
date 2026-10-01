package goide

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	dependencyGraphTimeout  = 30 * time.Second
	dependencyUpdateTimeout = 60 * time.Second
	dependencyVulnTimeout   = 180 * time.Second
	maxModuleGraphBytes     = 8 * 1024 * 1024
	maxLicenseBytes         = 4096
	maxWeightFiles          = 20000
	maxDependencyNodes      = 2000
)

// DependencyGraphNode è un modulo del grafo alla versione selezionata (MVS).
type DependencyGraphNode struct {
	Path         string `json:"path"`
	Version      string `json:"version"`
	Indirect     bool   `json:"indirect"`
	Main         bool   `json:"main"`
	Depth        int    `json:"depth"`
	License      string `json:"license,omitempty"`
	Dir          string `json:"dir,omitempty"`
	WeightBytes  int64  `json:"weightBytes,omitempty"`
	Unused       bool   `json:"unused,omitempty"`
	PackageCount int    `json:"packageCount,omitempty"`
}

// DependencyEdge è un arco del grafo dei moduli: from richiede to.
type DependencyEdge struct {
	From        string `json:"from"`
	FromVersion string `json:"fromVersion"`
	To          string `json:"to"`
	ToVersion   string `json:"toVersion"`
}

// DependencyVersionUse dice chi richiede una specifica versione di un modulo.
type DependencyVersionUse struct {
	Version    string   `json:"version"`
	RequiredBy []string `json:"requiredBy"`
	Chain      []string `json:"chain,omitempty"`
}

// DuplicateDependency è un modulo richiesto in più versioni da parti diverse del grafo.
type DuplicateDependency struct {
	Path     string                 `json:"path"`
	Versions []DependencyVersionUse `json:"versions"`
}

// DependencyUpdate riporta l'ultima versione disponibile di un modulo (go list -m -u).
type DependencyUpdate struct {
	Path    string `json:"path"`
	Version string `json:"version"`
	Latest  string `json:"latest,omitempty"`
}

// DependencyVulnerability è una segnalazione di govulncheck per un modulo.
type DependencyVulnerability struct {
	ID       string `json:"id,omitempty"`
	Module   string `json:"module"`
	Version  string `json:"version,omitempty"`
	Package  string `json:"package,omitempty"`
	Symbol   string `json:"symbol,omitempty"`
	Severity string `json:"severity,omitempty"`
	Summary  string `json:"summary,omitempty"`
}

// DependencyGraphReport è il risultato completo dell'analisi offline del grafo delle dipendenze.
type DependencyGraphReport struct {
	ModulePath       string                `json:"modulePath"`
	ModuleDirectory  string                `json:"moduleDirectory"`
	Nodes            []DependencyGraphNode `json:"nodes"`
	Edges            []DependencyEdge      `json:"edges"`
	Duplicates       []DuplicateDependency `json:"duplicates"`
	DirectCount      int                   `json:"directCount"`
	TotalCount       int                   `json:"totalCount"`
	TotalWeightBytes int64                 `json:"totalWeightBytes"`
	Error            string                `json:"error,omitempty"`
}

type moduleJSON struct {
	Path     string                `json:"Path"`
	Version  string                `json:"Version"`
	Dir      string                `json:"Dir"`
	GoMod    string                `json:"GoMod"`
	Indirect bool                  `json:"Indirect"`
	Main     bool                  `json:"Main"`
	Update   *moduleJSON           `json:"Update"`
	Error    *struct{ Err string } `json:"Error"`
}

// DependencyGraph costruisce il grafo delle dipendenze del modulo senza contattare la rete:
// `go list -m -json all` per la build list selezionata e `go mod graph` per gli archi reali.
func (s *Service) DependencyGraph(sessionID, moduleDirectory string) (DependencyGraphReport, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return DependencyGraphReport{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return DependencyGraphReport{}, fmt.Errorf("autorizza esplicitamente gli strumenti per questo progetto")
	}
	directory, err := s.documents.resolveDirectory(session.Project, moduleDirectory)
	if err != nil {
		return DependencyGraphReport{}, err
	}
	modulePath := readModulePath(filepath.Join(directory, "go.mod"))
	if modulePath == "" {
		return DependencyGraphReport{}, fmt.Errorf("go.mod non valido: direttiva module assente")
	}

	listOutput, err := s.runModuleCommand(session.ID, directory, dependencyGraphTimeout, "list", "-m", "-json", "all")
	if err != nil {
		return DependencyGraphReport{}, err
	}
	graphOutput, err := s.runModuleCommand(session.ID, directory, dependencyGraphTimeout, "mod", "graph")
	if err != nil {
		return DependencyGraphReport{}, err
	}
	// Best effort: l'uso effettivo dei pacchetti serve a distinguere dipendenze inutilizzate
	// e a contare i pacchetti che ogni modulo porta nel build. Senza file .go non c'è nulla da contare.
	depsOutput, _ := s.runModuleCommand(session.ID, directory, dependencyGraphTimeout, "list", "-deps", "-f", "{{if not .Standard}}{{.Module.Path}}{{end}}", "./...")

	return buildDependencyGraph(modulePath, directory, listOutput, graphOutput, depsOutput)
}

// DependencyUpdates legge le versioni più recenti disponibili per i moduli del grafo (richiede rete).
func (s *Service) DependencyUpdates(sessionID, moduleDirectory string) ([]DependencyUpdate, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return nil, fmt.Errorf("autorizza esplicitamente gli strumenti per questo progetto")
	}
	directory, err := s.documents.resolveDirectory(session.Project, moduleDirectory)
	if err != nil {
		return nil, err
	}
	output, err := s.runModuleCommand(session.ID, directory, dependencyUpdateTimeout, "list", "-m", "-u", "-json", "all")
	if err != nil {
		return nil, err
	}
	return parseDependencyUpdates(output), nil
}

// DependencyVulnerabilities esegue govulncheck (se installato) e restituisce le segnalazioni per modulo.
// È esplicitamente on-demand: il database delle vulnerabilità richiede rete.
func (s *Service) DependencyVulnerabilities(sessionID, moduleDirectory string) ([]DependencyVulnerability, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return nil, fmt.Errorf("autorizza esplicitamente gli strumenti per questo progetto")
	}
	directory, err := s.documents.resolveDirectory(session.Project, moduleDirectory)
	if err != nil {
		return nil, err
	}
	tool, err := s.DetectGoTool(sessionID, "govulncheck")
	if err != nil {
		return nil, err
	}
	if !tool.Available {
		return nil, fmt.Errorf("govulncheck non installato: installalo da Go → Toolchains o con go install golang.org/x/vuln/cmd/govulncheck@latest")
	}
	return runGovulncheck(directory, tool.Path)
}

// runModuleCommand esegue il binario go della sessione in modo sincrono, con output limitato.
func (s *Service) runModuleCommand(sessionID SessionID, workingDirectory string, timeout time.Duration, arguments ...string) (string, error) {
	binary, err := s.toolchain.GoBinary(sessionID)
	if err != nil {
		return "", errors.New("go non disponibile: rileva o configura la toolchain prima di analizzare le dipendenze")
	}
	environment, err := s.toolchain.Environment(sessionID, nil)
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	command := exec.CommandContext(ctx, binary, arguments...)
	command.Dir = workingDirectory
	command.Env = environment
	configureProcess(command, false)
	output, err := command.CombinedOutput()
	if len(output) > maxModuleGraphBytes {
		output = output[:maxModuleGraphBytes]
	}
	if ctx.Err() != nil {
		return "", fmt.Errorf("analisi dipendenze scaduta (go %s)", strings.Join(arguments, " "))
	}
	if err != nil {
		message := strings.TrimSpace(string(output))
		if message == "" {
			message = err.Error()
		}
		return "", fmt.Errorf("go %s: %s", strings.Join(arguments, " "), message)
	}
	return string(output), nil
}

// buildDependencyGraph assembla il report a partire dagli output dei comandi go. È pura e testabile.
func buildDependencyGraph(modulePath, directory, listOutput, graphOutput, depsOutput string) (DependencyGraphReport, error) {
	modules, err := parseModuleList(listOutput)
	if err != nil {
		return DependencyGraphReport{}, fmt.Errorf("go list -m -json non interpretabile: %w", err)
	}
	if len(modules) > maxDependencyNodes {
		return DependencyGraphReport{}, fmt.Errorf("grafo delle dipendenze troppo grande: %d moduli", len(modules))
	}
	edges, edgeLookup := parseModuleGraph(graphOutput)

	report := DependencyGraphReport{
		ModulePath:      modulePath,
		ModuleDirectory: directory,
		Nodes:           make([]DependencyGraphNode, 0, len(modules)),
		Edges:           edges,
	}

	// Mappa versione selezionata (MVS) per percorso modulo, inclusa la radice.
	selected := map[string]string{modulePath: ""}
	for _, module := range modules {
		if module.Main {
			continue
		}
		selected[module.Path] = module.Version
	}

	// Profondità calcolata sul grafo potato alle versioni selezionate (BFS dalla radice).
	depth := map[string]int{modulePath: 0}
	queue := []string{modulePath}
	seen := map[string]bool{modulePath: true}
	for len(queue) > 0 {
		from := queue[0]
		queue = queue[1:]
		fromKey := from + "@" + selected[from]
		for _, toKey := range edgeLookup[fromKey] {
			to := modulePathFromKey(toKey)
			if seen[to] {
				continue
			}
			seen[to] = true
			depth[to] = depth[from] + 1
			queue = append(queue, to)
		}
	}

	directSet := map[string]bool{}
	for _, module := range modules {
		if module.Main || module.Indirect {
			continue
		}
		directSet[module.Path] = true
	}

	used, packageCounts := parseUsedModules(depsOutput, modulePath)

	for _, module := range modules {
		node := DependencyGraphNode{
			Path: module.Path, Version: module.Version, Indirect: module.Indirect, Main: module.Main,
			Depth: depth[module.Path], Dir: module.Dir, PackageCount: packageCounts[module.Path],
		}
		node.License = detectLicense(module.Dir)
		node.WeightBytes = estimateModuleWeight(module.Dir)
		node.Unused = !module.Main && directSet[module.Path] && !used[module.Path]
		report.Nodes = append(report.Nodes, node)
		report.TotalWeightBytes += node.WeightBytes
		if module.Main {
			continue
		}
		report.TotalCount++
		if !module.Indirect {
			report.DirectCount++
		}
	}

	report.Duplicates = findDuplicates(graphOutput)
	fillVersionChains(report.Duplicates, edgeLookup, modulePath+"@")
	sort.Slice(report.Nodes, func(left, right int) bool {
		if report.Nodes[left].Depth != report.Nodes[right].Depth {
			return report.Nodes[left].Depth < report.Nodes[right].Depth
		}
		return report.Nodes[left].Path < report.Nodes[right].Path
	})
	return report, nil
}

// fillVersionChains annota per ogni versione duplicata il percorso più corto dalla radice (BFS sul grafo completo).
func fillVersionChains(duplicates []DuplicateDependency, edgeLookup map[string][]string, rootKey string) {
	parent := map[string]string{rootKey: ""}
	queue := []string{rootKey}
	for len(queue) > 0 {
		from := queue[0]
		queue = queue[1:]
		for _, to := range edgeLookup[from] {
			if _, ok := parent[to]; ok {
				continue
			}
			parent[to] = from
			queue = append(queue, to)
		}
	}
	for index := range duplicates {
		for versionIndex := range duplicates[index].Versions {
			use := &duplicates[index].Versions[versionIndex]
			key := duplicates[index].Path + "@" + use.Version
			if _, ok := parent[key]; !ok {
				continue
			}
			chain := []string{}
			for current := key; current != ""; current = parent[current] {
				chain = append([]string{strings.TrimSuffix(current, "@")}, chain...)
			}
			use.Chain = chain
		}
	}
}

// parseUsedModules restituisce l'insieme dei moduli effettivamente importati e il numero di pacchetti per modulo.
func parseUsedModules(depsOutput, modulePath string) (map[string]bool, map[string]int) {
	used := map[string]bool{}
	counts := map[string]int{}
	for _, line := range strings.Split(strings.ReplaceAll(depsOutput, "\r\n", "\n"), "\n") {
		path := strings.TrimSpace(line)
		if path == "" || path == modulePath {
			continue
		}
		counts[path]++
		used[path] = true
	}
	return used, counts
}

func parseModuleList(output string) ([]moduleJSON, error) {
	decoder := json.NewDecoder(strings.NewReader(output))
	modules := make([]moduleJSON, 0, 128)
	for decoder.More() {
		var module moduleJSON
		if err := decoder.Decode(&module); err != nil {
			return modules, err
		}
		modules = append(modules, module)
	}
	return modules, nil
}

func parseModuleGraph(output string) ([]DependencyEdge, map[string][]string) {
	edges := make([]DependencyEdge, 0, 256)
	lookup := map[string][]string{}
	for _, line := range strings.Split(strings.ReplaceAll(output, "\r\n", "\n"), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) != 2 {
			continue
		}
		fromPath, fromVersion := splitModuleVersion(parts[0])
		toPath, toVersion := splitModuleVersion(parts[1])
		edges = append(edges, DependencyEdge{From: fromPath, FromVersion: fromVersion, To: toPath, ToVersion: toVersion})
		lookup[fromPath+"@"+fromVersion] = append(lookup[fromPath+"@"+fromVersion], toPath+"@"+toVersion)
	}
	return edges, lookup
}

func findDuplicates(graphOutput string) []DuplicateDependency {
	byPath := map[string]map[string]map[string]bool{}
	for _, line := range strings.Split(strings.ReplaceAll(graphOutput, "\r\n", "\n"), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) != 2 {
			continue
		}
		fromPath, fromVersion := splitModuleVersion(parts[0])
		toPath, toVersion := splitModuleVersion(parts[1])
		if byPath[toPath] == nil {
			byPath[toPath] = map[string]map[string]bool{}
		}
		if byPath[toPath][toVersion] == nil {
			byPath[toPath][toVersion] = map[string]bool{}
		}
		byPath[toPath][toVersion][fromPath+"@"+fromVersion] = true
	}

	duplicates := make([]DuplicateDependency, 0)
	for path, versions := range byPath {
		if len(versions) <= 1 {
			continue
		}
		duplicate := DuplicateDependency{Path: path}
		for version, requirers := range versions {
			use := DependencyVersionUse{Version: version}
			for requirer := range requirers {
				use.RequiredBy = append(use.RequiredBy, requirer)
			}
			sort.Strings(use.RequiredBy)
			duplicate.Versions = append(duplicate.Versions, use)
		}
		sort.Slice(duplicate.Versions, func(left, right int) bool { return duplicate.Versions[left].Version < duplicate.Versions[right].Version })
		duplicates = append(duplicates, duplicate)
	}
	sort.Slice(duplicates, func(left, right int) bool { return duplicates[left].Path < duplicates[right].Path })
	return duplicates
}

func parseDependencyUpdates(output string) []DependencyUpdate {
	decoder := json.NewDecoder(strings.NewReader(output))
	updates := make([]DependencyUpdate, 0, 128)
	for decoder.More() {
		var module moduleJSON
		if err := decoder.Decode(&module); err != nil {
			break
		}
		if module.Main || module.Update == nil {
			continue
		}
		updates = append(updates, DependencyUpdate{Path: module.Path, Version: module.Version, Latest: module.Update.Version})
	}
	sort.Slice(updates, func(left, right int) bool { return updates[left].Path < updates[right].Path })
	return updates
}

// splitModuleVersion divide "path@versione" nel percorso modulo e nella versione.
func splitModuleVersion(token string) (string, string) {
	if index := strings.LastIndex(token, "@"); index >= 0 {
		return token[:index], token[index+1:]
	}
	return token, ""
}

func modulePathFromKey(key string) string {
	path, _ := splitModuleVersion(key)
	return path
}

var licenseFilePrefixes = []string{"license", "copying", "copyright", "notice", "unlicense", "licence"}

func detectLicense(directory string) string {
	if directory == "" {
		return ""
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		return ""
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		lower := strings.ToLower(entry.Name())
		matched := false
		for _, prefix := range licenseFilePrefixes {
			if strings.HasPrefix(lower, prefix) {
				matched = true
				break
			}
		}
		if !matched {
			continue
		}
		data, err := os.ReadFile(filepath.Join(directory, entry.Name()))
		if err != nil || len(data) == 0 {
			return entry.Name()
		}
		if len(data) > maxLicenseBytes {
			data = data[:maxLicenseBytes]
		}
		if license := classifyLicense(string(data)); license != "" {
			return license
		}
		return entry.Name()
	}
	return ""
}

func classifyLicense(text string) string {
	upper := strings.ToUpper(text)
	switch {
	case strings.Contains(text, "Apache License") && strings.Contains(text, "2.0"):
		return "Apache-2.0"
	case strings.Contains(upper, "MOZILLA PUBLIC LICENSE"):
		return "MPL-2.0"
	case strings.Contains(upper, "GNU AFFERO GENERAL PUBLIC LICENSE"):
		return "AGPL-3.0"
	case strings.Contains(upper, "GNU GENERAL PUBLIC LICENSE") && strings.Contains(upper, "VERSION 3"):
		return "GPL-3.0"
	case strings.Contains(upper, "GNU GENERAL PUBLIC LICENSE") && strings.Contains(upper, "VERSION 2"):
		return "GPL-2.0"
	case strings.Contains(upper, "GNU LESSER GENERAL PUBLIC LICENSE"):
		return "LGPL"
	case strings.Contains(text, "Permission is hereby granted, free of charge") || strings.Contains(upper, "THE SOFTWARE IS PROVIDED"):
		return "MIT"
	case strings.Contains(text, "Redistribution and use in source and binary forms"):
		return "BSD"
	case strings.Contains(upper, "PUBLIC DOMAIN") || strings.Contains(upper, "UNLICENSE"):
		return "Unlicense"
	}
	return ""
}

func estimateModuleWeight(directory string) int64 {
	if directory == "" {
		return 0
	}
	var total int64
	count := 0
	_ = filepath.WalkDir(directory, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if count >= maxWeightFiles {
			return filepath.SkipAll
		}
		if entry.IsDir() {
			name := entry.Name()
			if name == ".git" || name == "node_modules" || name == "vendor" {
				return filepath.SkipDir
			}
			return nil
		}
		info, err := entry.Info()
		if err == nil {
			total += info.Size()
			count++
		}
		return nil
	})
	return total
}

func runGovulncheck(directory, binary string) ([]DependencyVulnerability, error) {
	ctx, cancel := context.WithTimeout(context.Background(), dependencyVulnTimeout)
	defer cancel()
	command := exec.CommandContext(ctx, binary, "-json", "./...")
	command.Dir = directory
	configureProcess(command, false)
	output, err := command.CombinedOutput()
	if ctx.Err() != nil {
		return nil, fmt.Errorf("govulncheck scaduto")
	}
	if len(output) > maxModuleGraphBytes {
		output = output[:maxModuleGraphBytes]
	}
	findings, parseErr := parseVulnerabilities(output)
	if err != nil && parseErr != nil {
		return nil, fmt.Errorf("govulncheck: %s", strings.TrimSpace(string(output)))
	}
	return findings, nil
}

func parseVulnerabilities(output []byte) ([]DependencyVulnerability, error) {
	var result struct {
		Vulns []struct {
			OSV struct {
				ID       string `json:"id"`
				Summary  string `json:"summary"`
				Severity []struct {
					Type  string `json:"type"`
					Score string `json:"score"`
				} `json:"severity"`
			} `json:"osv"`
			Module struct {
				Path    string `json:"path"`
				Version string `json:"version"`
			} `json:"module"`
			Package struct {
				Path string `json:"path"`
			} `json:"package"`
			Symbol string `json:"symbol"`
		} `json:"vulns"`
	}
	if err := json.Unmarshal(output, &result); err != nil {
		return nil, err
	}
	findings := make([]DependencyVulnerability, 0, len(result.Vulns))
	for _, vuln := range result.Vulns {
		findings = append(findings, DependencyVulnerability{
			ID: vuln.OSV.ID, Module: vuln.Module.Path, Version: vuln.Module.Version,
			Package: vuln.Package.Path, Symbol: vuln.Symbol,
			Severity: severityLabel(vuln.OSV.Severity), Summary: vuln.OSV.Summary,
		})
	}
	return findings, nil
}

func severityLabel(severity []struct {
	Type  string `json:"type"`
	Score string `json:"score"`
}) string {
	if len(severity) == 0 {
		return ""
	}
	parts := make([]string, 0, len(severity))
	for _, entry := range severity {
		parts = append(parts, entry.Type)
	}
	sort.Strings(parts)
	return strings.Join(parts, ",")
}
