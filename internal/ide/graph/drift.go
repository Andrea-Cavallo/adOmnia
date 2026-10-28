package graph

import (
	"encoding/json/v2"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
)

// RulesFile è il file, condivisibile via Git, con l'architettura desiderata del progetto.
const RulesFile = ".adomnia/architecture.json"

// ArchitectureRules descrive l'architettura desiderata. I pattern sono percorsi di package
// relativi al modulo ("internal/domain/..." = la cartella e le sottocartelle; "*" = un segmento).
type ArchitectureRules struct {
	// Layers: nome → pattern dei package che ne fanno parte.
	Layers map[string][]string `json:"layers,omitempty"`
	// Allow: layer → layer che può importare. Un layer assente da Allow non ha vincoli.
	Allow map[string][]string `json:"allow,omitempty"`
	// Forbidden: import vietati, anche della libreria standard o di moduli esterni.
	Forbidden []ForbiddenImport `json:"forbidden,omitempty"`
	// Domains: bounded context che non si importano a vicenda (salvo Shared).
	Domains map[string][]string `json:"domains,omitempty"`
	Shared  []string            `json:"shared,omitempty"`
	// Services: servizi (di solito moduli) indicati con pattern sul percorso completo del package,
	// es. "example.com/billing/...": un servizio non importa i package di un altro.
	Services map[string][]string `json:"services,omitempty"`
	// DatabaseLayers: solo questi layer interrogano tabelle (query SQL/ORM). Vuoto = nessun vincolo.
	DatabaseLayers []string `json:"databaseLayers,omitempty"`
	// BrokerLayers: solo questi layer producono o consumano messaggi. Vuoto = nessun vincolo.
	BrokerLayers []string `json:"brokerLayers,omitempty"`
	// NoCycles vieta i cicli di import fra package del progetto (default true).
	NoCycles *bool `json:"noCycles,omitempty"`
}

// ForbiddenImport vieta a From (pattern di package o layer "layer:domain") di importare Import.
type ForbiddenImport struct {
	From   string `json:"from"`
	Import string `json:"import"`
	Reason string `json:"reason,omitempty"`
}

// Violation è una regola non rispettata, con il punto del codice da cui partire.
type Violation struct {
	Rule    string `json:"rule"` // layer | forbidden-import | domain | database | broker | cycle
	Message string `json:"message"`
	From    string `json:"from"`
	To      string `json:"to,omitempty"`
	File    string `json:"file,omitempty"`
	Line    int    `json:"line,omitzero"`
}

// DriftReport è il confronto fra l'architettura desiderata e il codice.
type DriftReport struct {
	RulesFound bool           `json:"rulesFound"`
	Violations []Violation    `json:"violations"`
	Packages   int            `json:"packages"`
	Layers     map[string]int `json:"layers"`
	Unassigned []string       `json:"unassigned,omitempty"`
}

// LoadRules legge .adomnia/architecture.json; assente = nessuna regola (ma i cicli si cercano).
func LoadRules(root string) (ArchitectureRules, bool, error) {
	data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(RulesFile)))
	if errors.Is(err, os.ErrNotExist) {
		return ArchitectureRules{}, false, nil
	}
	if err != nil {
		return ArchitectureRules{}, false, err
	}
	var rules ArchitectureRules
	if err := json.Unmarshal(data, &rules); err != nil {
		return ArchitectureRules{}, false, fmt.Errorf("%s: %w", RulesFile, err)
	}
	return rules, true, nil
}

// relativePackage toglie il modulo dal percorso del package: "example.com/shop/internal/x" → "internal/x".
func relativePackage(pkg Node) string {
	module := pkg.Attrs["module"]
	if module != "" && strings.HasPrefix(pkg.Label, module) {
		rest := strings.TrimPrefix(strings.TrimPrefix(pkg.Label, module), "/")
		if rest == "" {
			return "."
		}
		return rest
	}
	return pkg.Label
}

// matchPattern: "a/b/..." = a/b e sotto; "*" = un segmento qualunque; altrimenti uguaglianza
// (anche come suffisso del percorso completo, per import esterni o della libreria standard).
func matchPattern(pattern, path string) bool {
	pattern = strings.Trim(strings.TrimSpace(pattern), "/")
	if pattern == "" {
		return false
	}
	if prefix, ok := strings.CutSuffix(pattern, "/..."); ok {
		return matchSegments(prefix, path, true)
	}
	if pattern == "..." {
		return true
	}
	return matchSegments(pattern, path, false)
}

func matchSegments(pattern, path string, prefix bool) bool {
	want, got := strings.Split(pattern, "/"), strings.Split(path, "/")
	if len(got) < len(want) || (!prefix && len(got) != len(want)) {
		return false
	}
	for i, segment := range want {
		if segment != "*" && segment != got[i] {
			return false
		}
	}
	return true
}

func (r ArchitectureRules) layerOf(path string) string {
	names := make([]string, 0, len(r.Layers))
	for name := range r.Layers {
		names = append(names, name)
	}
	sort.Strings(names) // risultato stabile se un package sta in due layer
	best, bestLength := "", -1
	for _, name := range names {
		for _, pattern := range r.Layers[name] {
			if matchPattern(pattern, path) && len(pattern) > bestLength {
				best, bestLength = name, len(pattern)
			}
		}
	}
	return best
}

func groupOf(groups map[string][]string, path string) string {
	for name, patterns := range groups {
		for _, pattern := range patterns {
			if matchPattern(pattern, path) {
				return name
			}
		}
	}
	return ""
}

func contains(list []string, value string) bool {
	return slices.Contains(list, value)
}

// CheckDrift confronta il grafo con le regole: import fra layer non consentiti, import vietati,
// domini che si toccano, query e messaggi fuori dai layer ammessi, cicli di import.
func (x *Index) CheckDrift(rules ArchitectureRules, found bool) DriftReport {
	report := DriftReport{RulesFound: found, Violations: []Violation{}, Layers: map[string]int{}}
	relative := x.countPackages(rules, &report) // id package → percorso relativo
	add := func(v Violation) { report.Violations = append(report.Violations, v) }
	for id, path := range relative {
		x.checkPackageImports(rules, relative, id, path, add)
	}
	x.checkCodeEdges(rules, add)
	if rules.NoCycles == nil || *rules.NoCycles {
		x.checkCycles(add)
	}
	sort.SliceStable(report.Violations, func(i, j int) bool {
		if report.Violations[i].Rule != report.Violations[j].Rule {
			return report.Violations[i].Rule < report.Violations[j].Rule
		}
		return report.Violations[i].Message < report.Violations[j].Message
	})
	return report
}

// countPackages riempie i contatori del report (package, layer, non assegnati) e restituisce
// il percorso relativo di ogni package.
func (x *Index) countPackages(rules ArchitectureRules, report *DriftReport) map[string]string {
	relative := map[string]string{}
	for _, node := range x.graph.Nodes {
		if node.Kind != KindPackage {
			continue
		}
		path := relativePackage(node)
		relative[node.ID] = path
		report.Packages++
		if layer := rules.layerOf(path); layer != "" {
			report.Layers[layer]++
		} else if len(rules.Layers) > 0 {
			report.Unassigned = append(report.Unassigned, node.Label)
		}
	}
	sort.Strings(report.Unassigned)
	return relative
}

// checkPackageImports applica le regole sugli import in uscita da un package.
func (x *Index) checkPackageImports(rules ArchitectureRules, relative map[string]string, id, path string, add func(Violation)) {
	pkg := x.byID[id]
	fromLayer := rules.layerOf(path)
	fromDomain := groupOf(rules.Domains, path)
	for _, edge := range x.out[id] {
		if edge.Kind != EdgeImports {
			continue
		}
		target := x.byID[edge.To]
		importPath := target.Label
		if edge.Detail != "" {
			importPath = edge.Detail // import di un modulo esterno: il package esatto
		}
		checkForbiddenImports(rules, relative, pkg, target, path, fromLayer, importPath, add)
		if target.Kind != KindPackage {
			continue
		}
		checkInternalImport(rules, pkg, target, relative[target.ID], fromLayer, fromDomain, add)
	}
}

// checkForbiddenImports segnala gli import che una regola "forbidden" vieta a questo package.
func checkForbiddenImports(rules ArchitectureRules, relative map[string]string, pkg, target Node, path, fromLayer, importPath string, add func(Violation)) {
	for _, forbidden := range rules.Forbidden {
		from := strings.TrimSpace(forbidden.From)
		applies := matchPattern(from, path)
		if layer, ok := strings.CutPrefix(from, "layer:"); ok {
			applies = layer == fromLayer
		}
		hit := matchPattern(forbidden.Import, importPath)
		if target.Kind == KindPackage {
			hit = hit || matchPattern(forbidden.Import, relative[target.ID])
		}
		if applies && hit {
			message := fmt.Sprintf("%s imports %s", pkg.Label, importPath)
			if forbidden.Reason != "" {
				message += ": " + forbidden.Reason
			}
			add(Violation{Rule: "forbidden-import", Message: message, From: pkg.Label, To: importPath, File: pkg.File, Line: pkg.Line})
		}
	}
}

// checkInternalImport applica le regole fra package del progetto: layer, servizi e domini.
func checkInternalImport(rules ArchitectureRules, pkg, target Node, toPath, fromLayer, fromDomain string, add func(Violation)) {
	toLayer := rules.layerOf(toPath)
	if allowed, constrained := rules.Allow[fromLayer]; constrained && fromLayer != "" && toLayer != "" && toLayer != fromLayer && !contains(allowed, toLayer) {
		add(Violation{Rule: "layer", Message: fmt.Sprintf("layer %s must not depend on layer %s (%s imports %s)", fromLayer, toLayer, pkg.Label, target.Label), From: pkg.Label, To: target.Label, File: pkg.File, Line: pkg.Line})
	}
	toDomain := groupOf(rules.Domains, toPath)
	shared := false
	for _, pattern := range rules.Shared {
		shared = shared || matchPattern(pattern, toPath)
	}
	if fromService, toService := groupOf(rules.Services, pkg.Label), groupOf(rules.Services, target.Label); fromService != "" && toService != "" && fromService != toService {
		add(Violation{Rule: "service", Message: fmt.Sprintf("service %s imports code of service %s (%s imports %s): call its API instead", fromService, toService, pkg.Label, target.Label), From: pkg.Label, To: target.Label, File: pkg.File, Line: pkg.Line})
	}
	if fromDomain != "" && toDomain != "" && fromDomain != toDomain && !shared {
		add(Violation{Rule: "domain", Message: fmt.Sprintf("domain %s reaches into domain %s (%s imports %s)", fromDomain, toDomain, pkg.Label, target.Label), From: pkg.Label, To: target.Label, File: pkg.File, Line: pkg.Line})
	}
}

// checkCodeEdges: query e messaggi, dalla funzione al suo package.
func (x *Index) checkCodeEdges(rules ArchitectureRules, add func(Violation)) {
	for _, node := range x.graph.Nodes {
		if !isCode(node.Kind) || node.Package == "" {
			continue
		}
		layer := rules.layerOf(relativePackage(Node{Label: node.Package, Attrs: map[string]string{"module": node.Attrs["module"]}}))
		for _, edge := range x.out[node.ID] {
			switch {
			case edge.Kind == EdgeQueries && len(rules.DatabaseLayers) > 0 && !contains(rules.DatabaseLayers, layer):
				add(Violation{Rule: "database", Message: fmt.Sprintf("%s queries table %s outside the repository layers (%s)", node.Label, x.byID[edge.To].Label, strings.Join(rules.DatabaseLayers, ", ")), From: node.Label, To: x.byID[edge.To].Label, File: node.File, Line: node.Line})
			case (edge.Kind == EdgeProduces || edge.Kind == EdgeConsumes) && len(rules.BrokerLayers) > 0 && !contains(rules.BrokerLayers, layer):
				add(Violation{Rule: "broker", Message: fmt.Sprintf("%s %s topic %s outside the broker layers (%s)", node.Label, edge.Kind, x.byID[edge.To].Label, strings.Join(rules.BrokerLayers, ", ")), From: node.Label, To: x.byID[edge.To].Label, File: node.File, Line: node.Line})
			}
		}
	}
}

// checkCycles segnala i cicli di import fra package.
func (x *Index) checkCycles(add func(Violation)) {
	for _, cycle := range x.importCycles() {
		first := x.byID[cycle[0]]
		labels := make([]string, 0, len(cycle)+1)
		for _, id := range cycle {
			labels = append(labels, x.byID[id].Label)
		}
		labels = append(labels, first.Label)
		add(Violation{Rule: "cycle", Message: "import cycle: " + strings.Join(labels, " → "), From: first.Label, File: first.File, Line: first.Line})
	}
}

// importCycles: componenti fortemente connesse (Tarjan) con più di un package.
// Go vieta i cicli in un modulo, ma fra moduli di un workspace (o con replace) possono comparire.
func (x *Index) importCycles() [][]string {
	index, low, onStack := map[string]int{}, map[string]int{}, map[string]bool{}
	var stack []string
	var cycles [][]string
	counter := 0
	var visit func(string)
	visit = func(id string) {
		index[id], low[id] = counter, counter
		counter++
		stack = append(stack, id)
		onStack[id] = true
		for _, edge := range x.out[id] {
			if edge.Kind != EdgeImports || x.byID[edge.To].Kind != KindPackage {
				continue
			}
			if _, seen := index[edge.To]; !seen {
				visit(edge.To)
				low[id] = min(low[id], low[edge.To])
			} else if onStack[edge.To] {
				low[id] = min(low[id], index[edge.To])
			}
		}
		if low[id] != index[id] {
			return
		}
		var component []string
		for {
			top := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			onStack[top] = false
			component = append(component, top)
			if top == id {
				break
			}
		}
		if len(component) > 1 {
			sort.Strings(component)
			cycles = append(cycles, component)
		}
	}
	ids := make([]string, 0)
	for _, node := range x.graph.Nodes {
		if node.Kind == KindPackage {
			ids = append(ids, node.ID)
		}
	}
	sort.Strings(ids)
	for _, id := range ids {
		if _, seen := index[id]; !seen {
			visit(id)
		}
	}
	return cycles
}

// RulesTemplate è il punto di partenza proposto quando il progetto non ha ancora regole.
const RulesTemplate = `{
  "layers": {
    "api": ["cmd/...", "internal/http/...", "internal/api/..."],
    "service": ["internal/service/...", "internal/app/..."],
    "domain": ["internal/domain/..."],
    "repository": ["internal/store/...", "internal/repository/..."]
  },
  "allow": {
    "api": ["service", "domain"],
    "service": ["domain", "repository"],
    "repository": ["domain"],
    "domain": []
  },
  "forbidden": [
    { "from": "layer:domain", "import": "net/http", "reason": "the domain must not call HTTP" },
    { "from": "layer:domain", "import": "database/sql", "reason": "persistence belongs to the repository layer" }
  ],
  "domains": {},
  "shared": [],
  "services": {},
  "databaseLayers": ["repository"],
  "brokerLayers": [],
  "noCycles": true
}
`
