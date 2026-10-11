package graph

import (
	"path"
	"sort"
)

// PackageMetric misura l'accoppiamento di un package del progetto nel grafo statico.
type PackageMetric struct {
	Package     string `json:"package"`
	Module      string `json:"module,omitempty"`
	FanIn       int    `json:"fanIn"`       // package del progetto che lo importano
	FanOut      int    `json:"fanOut"`      // package del progetto che importa
	BlastRadius int    `json:"blastRadius"` // package che ne dipendono, anche indirettamente
	Functions   int    `json:"functions"`
	// Dir: cartella del package relativa al progetto (per legarlo ai file dei profili).
	Dir string `json:"dir,omitempty"`
}

// PackageMetrics restituisce le metriche di ogni package e gli import fra package del progetto.
func (x *Index) PackageMetrics() ([]PackageMetric, [][2]string) {
	var packages []string
	for _, node := range x.graph.Nodes {
		if node.Kind == KindPackage {
			packages = append(packages, node.ID)
		}
	}
	sort.Strings(packages)
	importers := map[string][]string{}
	var imports [][2]string
	metrics := map[string]*PackageMetric{}
	for _, id := range packages {
		node := x.byID[id]
		metrics[id] = &PackageMetric{Package: node.Label, Module: node.Attrs["module"], Dir: path.Dir(node.File)}
	}
	for _, id := range packages {
		for _, edge := range x.out[id] {
			if edge.Kind != EdgeImports || metrics[edge.To] == nil {
				continue
			}
			metrics[id].FanOut++
			metrics[edge.To].FanIn++
			importers[edge.To] = append(importers[edge.To], id)
			imports = append(imports, [2]string{x.byID[id].Label, x.byID[edge.To].Label})
		}
	}
	for _, node := range x.graph.Nodes {
		if isCode(node.Kind) && node.Kind != KindTest {
			if metric := metrics["pkg:"+node.Package]; metric != nil {
				metric.Functions++
			}
		}
	}
	out := make([]PackageMetric, 0, len(packages))
	for _, id := range packages {
		seen := map[string]bool{id: true}
		queue := []string{id}
		for len(queue) > 0 {
			current := queue[0]
			queue = queue[1:]
			for _, importer := range importers[current] {
				if !seen[importer] {
					seen[importer] = true
					queue = append(queue, importer)
				}
			}
		}
		metrics[id].BlastRadius = len(seen) - 1
		out = append(out, *metrics[id])
	}
	return out, imports
}
