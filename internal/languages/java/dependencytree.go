package java

import (
	"regexp"
	"strings"
)

// Albero delle dipendenze di Maven (`mvn dependency:tree`): ciò che il build risolve davvero, con i duplicati e
// i conflitti che Maven ha scartato. È l'unico modo di sapere "chi porta questa libreria vecchia".

// DependencyTreePlugin è la versione fissata del plugin: un build riproducibile non dipende dall'ultima release.
const DependencyTreePlugin = "org.apache.maven.plugins:maven-dependency-plugin:3.6.1"

// Stato di un nodo dell'albero.
const (
	TreeResolved         = "resolved"
	TreeOmittedDuplicate = "omittedDuplicate"
	TreeOmittedConflict  = "omittedConflict"
)

// TreeNode è una riga dell'albero, in ordine di apparizione: Depth 0 è il modulo stesso.
type TreeNode struct {
	Depth      int    `json:"depth"`
	GroupID    string `json:"groupId"`
	ArtifactID string `json:"artifactId"`
	Version    string `json:"version"`
	Scope      string `json:"scope,omitempty"`
	Type       string `json:"type,omitempty"`
	Classifier string `json:"classifier,omitempty"`
	Status     string `json:"status"`
	// ConflictWith è la versione che ha vinto sul nodo scartato per conflitto.
	ConflictWith string `json:"conflictWith,omitempty"`
	// ManagedFrom è la versione dichiarata prima che dependencyManagement la cambiasse.
	ManagedFrom string `json:"managedFrom,omitempty"`
}

// DependencyTreeArguments sono gli argomenti Maven che scrivono l'albero in un file (niente da ripulire dall'output).
func DependencyTreeArguments(outputFile string) []string {
	return []string{"-B", "-q", DependencyTreePlugin + ":tree", "-DoutputFile=" + outputFile, "-DoutputType=text", "-Dscope=runtime"}
}

var (
	treeMarker   = regexp.MustCompile(`^((?:\|  |   )*)(?:\+- |\\- )(.*)$`)
	treeOmitted  = regexp.MustCompile(`^\((.*?) - (.*)\)$`)
	treeConflict = regexp.MustCompile(`omitted for conflict with ([^\s;)]+)`)
	treeManaged  = regexp.MustCompile(`version managed from ([^\s;)]+)`)
)

// ParseDependencyTree legge l'output testuale di dependency:tree. Le righe che non sono nodi si ignorano.
func ParseDependencyTree(text string) []TreeNode {
	var nodes []TreeNode
	for index, line := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		line = strings.TrimRight(line, " \t")
		if line == "" {
			continue
		}
		if index == 0 || !strings.ContainsAny(line, "+\\") && len(nodes) == 0 {
			if node, ok := treeNode(line, 0, TreeResolved); ok && len(nodes) == 0 {
				nodes = append(nodes, node)
			}
			continue
		}
		match := treeMarker.FindStringSubmatch(line)
		if match == nil {
			continue
		}
		depth := len(match[1])/3 + 1
		body, status, conflict, managed := match[2], TreeResolved, "", ""
		if omitted := treeOmitted.FindStringSubmatch(body); omitted != nil {
			body, status = omitted[1], TreeOmittedDuplicate
			if found := treeConflict.FindStringSubmatch(omitted[2]); found != nil {
				status, conflict = TreeOmittedConflict, found[1]
			}
			if found := treeManaged.FindStringSubmatch(omitted[2]); found != nil {
				managed = found[1]
			}
		}
		if node, ok := treeNode(body, depth, status); ok {
			node.ConflictWith, node.ManagedFrom = conflict, managed
			nodes = append(nodes, node)
		}
	}
	return nodes
}

// treeNode legge `g:a:type[:classifier]:version[:scope]`.
func treeNode(coordinate string, depth int, status string) (TreeNode, bool) {
	parts := strings.Split(strings.TrimSpace(coordinate), ":")
	node := TreeNode{Depth: depth, Status: status}
	switch len(parts) {
	case 4: // modulo radice: g:a:type:version
		node.GroupID, node.ArtifactID, node.Type, node.Version = parts[0], parts[1], parts[2], parts[3]
	case 5:
		node.GroupID, node.ArtifactID, node.Type, node.Version, node.Scope = parts[0], parts[1], parts[2], parts[3], parts[4]
	case 6:
		node.GroupID, node.ArtifactID, node.Type, node.Classifier, node.Version, node.Scope = parts[0], parts[1], parts[2], parts[3], parts[4], parts[5]
	default:
		return TreeNode{}, false
	}
	return node, true
}
