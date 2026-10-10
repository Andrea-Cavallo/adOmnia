package graph

import (
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

const (
	KindService   = "service"    // servizio di docker compose
	EdgeRuns      = "runs"       // servizio → entry point che il suo build avvia
	EdgeDependsOn = "depends_on" // servizio → servizio (depends_on)
)

var composeFile = regexp.MustCompile(`^(docker-)?compose(\.[\w-]+)?\.ya?ml$`)

// IsComposeFile riconosce docker-compose.yml, compose.yaml, docker-compose.dev.yml…
func IsComposeFile(rel string) bool { return composeFile.MatchString(path.Base(rel)) }

type composeBuild struct {
	Context    string `yaml:"context"`
	Dockerfile string `yaml:"dockerfile"`
}

// UnmarshalYAML accetta sia `build: ./dir` sia `build: {context, dockerfile}`.
func (b *composeBuild) UnmarshalYAML(node *yaml.Node) error {
	if node.Kind == yaml.ScalarNode {
		b.Context = node.Value
		return nil
	}
	type plain composeBuild
	return node.Decode((*plain)(b))
}

// AddComposeServices aggiunge i servizi dei file compose sotto root e li collega agli entry
// point (nodi KindEntry di main) che il loro build compila: la cartella del contesto (o del
// Dockerfile) contiene il main; con più main candidati vince quello col nome del servizio.
func AddComposeServices(b *Builder, root string, files []string) {
	var mains []Node
	for _, node := range b.nodes {
		if node.Kind == KindEntry && node.Attrs["entry"] == "main" && node.File != "" {
			mains = append(mains, node)
		}
	}
	sort.Slice(mains, func(i, j int) bool { return mains[i].ID < mains[j].ID })
	for _, rel := range files {
		data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(rel)))
		if err != nil {
			continue
		}
		var document struct {
			Services map[string]struct {
				Build     *composeBuild `yaml:"build"`
				Image     string        `yaml:"image"`
				DependsOn yaml.Node     `yaml:"depends_on"`
			} `yaml:"services"`
		}
		if yaml.Unmarshal(data, &document) != nil {
			continue
		}
		var tree yaml.Node
		_ = yaml.Unmarshal(data, &tree)
		dir := path.Dir(rel)
		for name, service := range document.Services {
			id := "service:" + name
			b.Node(Node{ID: id, Kind: KindService, Label: name, File: rel, Line: serviceLine(&tree, name), Attrs: map[string]string{"image": service.Image}})
			if service.Build != nil {
				for _, entry := range builtMains(mains, buildDir(dir, service.Build), name) {
					b.Edge(id, entry.ID, EdgeRuns, "")
				}
			}
		}
		for name, service := range document.Services {
			for _, dependency := range dependsOn(&service.DependsOn) {
				b.Node(Node{ID: "service:" + dependency, Kind: KindService, Label: dependency, File: rel})
				b.Edge("service:"+name, "service:"+dependency, EdgeDependsOn, "")
			}
		}
	}
}

func buildDir(composeDir string, build *composeBuild) string {
	dir := path.Clean(path.Join(composeDir, filepath.ToSlash(build.Context)))
	if build.Dockerfile != "" {
		if sub := path.Dir(filepath.ToSlash(build.Dockerfile)); sub != "." {
			dir = path.Clean(path.Join(dir, sub))
		}
	}
	return dir
}

func builtMains(mains []Node, dir, service string) []Node {
	var inside, named []Node
	for _, main := range mains {
		if dir != "." && !strings.HasPrefix(main.File, dir+"/") {
			continue
		}
		inside = append(inside, main)
		if strings.Contains(strings.ToLower(path.Dir(main.File)), strings.ToLower(service)) {
			named = append(named, main)
		}
	}
	if len(inside) > 1 && len(named) > 0 {
		return named
	}
	return inside
}

// dependsOn accetta la lista (`[db, cache]`) e la mappa (`db: {condition: …}`).
func dependsOn(node *yaml.Node) []string {
	var out []string
	switch node.Kind {
	case yaml.SequenceNode:
		for _, item := range node.Content {
			out = append(out, item.Value)
		}
	case yaml.MappingNode:
		for i := 0; i+1 < len(node.Content); i += 2 {
			out = append(out, node.Content[i].Value)
		}
	}
	return out
}

func serviceLine(root *yaml.Node, name string) int {
	if len(root.Content) == 0 {
		return 0
	}
	document := root.Content[0]
	for i := 0; i+1 < len(document.Content); i += 2 {
		if document.Content[i].Value != "services" {
			continue
		}
		services := document.Content[i+1]
		for j := 0; j+1 < len(services.Content); j += 2 {
			if services.Content[j].Value == name {
				return services.Content[j].Line
			}
		}
	}
	return 0
}

// FindComposeFiles elenca i file compose del progetto (al massimo 3 livelli, senza vendor e simili).
func FindComposeFiles(root string) []string {
	var files []string
	_ = filepath.WalkDir(root, func(full string, entry os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		rel, _ := filepath.Rel(root, full)
		rel = filepath.ToSlash(rel)
		if entry.IsDir() {
			name := entry.Name()
			if rel != "." && (strings.HasPrefix(name, ".") || name == "vendor" || name == "node_modules" || strings.Count(rel, "/") >= 2) {
				return filepath.SkipDir
			}
			return nil
		}
		if IsComposeFile(rel) {
			files = append(files, rel)
		}
		return nil
	})
	return files
}
