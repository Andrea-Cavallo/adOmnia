package collectionfs

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

const FormatVersion = "adomnia.collection.v1"

type Collection struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Color       string `json:"color,omitempty"`
	Children    []Node `json:"children"`
	OpenAPISpec string `json:"_openapiSpec,omitempty"`
}

type Node struct {
	ID       string          `json:"id"`
	Name     string          `json:"name"`
	Type     string          `json:"type"`
	Children []Node          `json:"children,omitempty"`
	Raw      json.RawMessage `json:"-"`
}

func (n *Node) UnmarshalJSON(data []byte) error {
	type nodeAlias Node
	var alias nodeAlias
	if err := json.Unmarshal(data, &alias); err != nil {
		return err
	}
	*n = Node(alias)
	n.Raw = append(n.Raw[:0], data...)
	return nil
}

func (n Node) MarshalJSON() ([]byte, error) {
	if n.Type == "request" && len(n.Raw) > 0 {
		return n.Raw, nil
	}
	type folder struct {
		ID       string `json:"id"`
		Name     string `json:"name"`
		Type     string `json:"type"`
		Children []Node `json:"children"`
	}
	return json.Marshal(folder{
		ID:       n.ID,
		Name:     n.Name,
		Type:     n.Type,
		Children: n.Children,
	})
}

type ExportOptions struct {
	Now time.Time
}

type ExportManifest struct {
	SchemaVersion string `json:"schemaVersion"`
	CollectionID  string `json:"collectionId"`
	Collection    string `json:"collection"`
	GeneratedAt   string `json:"generatedAt"`
}

type DriftReport struct {
	SchemaVersion      string `json:"schemaVersion"`
	CollectionID       string `json:"collectionId"`
	Collection         string `json:"collection"`
	FolderCollectionID string `json:"folderCollectionId"`
	CurrentHash        string `json:"currentHash"`
	FolderHash         string `json:"folderHash"`
	SyncHash           string `json:"syncHash,omitempty"`
	InSync             bool   `json:"inSync"`
	RequestCount       int    `json:"requestCount"`
	FolderRequestCount int    `json:"folderRequestCount"`
	Message            string `json:"message"`
}

func ExportCollection(root string, collection Collection, opts ExportOptions) error {
	if strings.TrimSpace(root) == "" {
		return fmt.Errorf("export root required")
	}
	if strings.TrimSpace(collection.ID) == "" {
		return fmt.Errorf("collection id required")
	}
	if strings.TrimSpace(collection.Name) == "" {
		return fmt.Errorf("collection name required")
	}
	now := opts.Now
	if now.IsZero() {
		now = time.Now().UTC()
	}
	if err := os.MkdirAll(root, 0755); err != nil {
		return fmt.Errorf("create export root: %w", err)
	}
	if err := writeJSON(filepath.Join(root, "adomnia.collection.json"), ExportManifest{
		SchemaVersion: FormatVersion,
		CollectionID:  collection.ID,
		Collection:    collection.Name,
		GeneratedAt:   now.UTC().Format(time.RFC3339),
	}); err != nil {
		return err
	}
	if err := writeJSON(filepath.Join(root, "collection.json"), map[string]any{
		"schemaVersion": FormatVersion,
		"id":            collection.ID,
		"name":          collection.Name,
		"color":         collection.Color,
		"openapiSpec":   collection.OpenAPISpec,
	}); err != nil {
		return err
	}
	if err := writeText(filepath.Join(root, ".gitignore"), ".env\n*.tmp\n.adomnia-sync.local.json\n"); err != nil {
		return err
	}
	if err := writeJSON(filepath.Join(root, ".adomnia-sync.json"), map[string]any{
		"schemaVersion": FormatVersion,
		"collectionId":  collection.ID,
		"collection":    collection.Name,
		"hash":          collectionHash(collection),
	}); err != nil {
		return err
	}
	return writeNodes(filepath.Join(root, "folders"), collection.Children)
}

func ImportCollection(root string) (Collection, error) {
	var meta struct {
		ID          string `json:"id"`
		Name        string `json:"name"`
		Color       string `json:"color"`
		OpenAPISpec string `json:"openapiSpec"`
	}
	if err := readJSON(filepath.Join(root, "collection.json"), &meta); err != nil {
		return Collection{}, err
	}
	children, err := readNodes(filepath.Join(root, "folders"))
	if err != nil {
		return Collection{}, err
	}
	return Collection{
		ID:          meta.ID,
		Name:        meta.Name,
		Color:       meta.Color,
		OpenAPISpec: meta.OpenAPISpec,
		Children:    children,
	}, nil
}

func InspectDrift(root string, collection Collection) (DriftReport, error) {
	imported, err := ImportCollection(root)
	if err != nil {
		return DriftReport{}, err
	}
	currentHash := collectionHash(collection)
	folderHash := collectionHash(imported)
	var syncMeta struct {
		Hash string `json:"hash"`
	}
	_ = readJSON(filepath.Join(root, ".adomnia-sync.json"), &syncMeta)
	inSync := currentHash == folderHash
	if imported.ID != collection.ID {
		inSync = false
	}
	message := "Folder projection matches the current collection."
	if !inSync {
		message = "Folder projection differs from the current collection."
	}
	return DriftReport{
		SchemaVersion:      FormatVersion,
		CollectionID:       collection.ID,
		Collection:         collection.Name,
		FolderCollectionID: imported.ID,
		CurrentHash:        currentHash,
		FolderHash:         folderHash,
		SyncHash:           syncMeta.Hash,
		InSync:             inSync,
		RequestCount:       CountRequests(collection.Children),
		FolderRequestCount: CountRequests(imported.Children),
		Message:            message,
	}, nil
}

func CountRequests(nodes []Node) int {
	total := 0
	for _, node := range nodes {
		if node.Type == "request" {
			total++
			continue
		}
		total += CountRequests(node.Children)
	}
	return total
}

func writeNodes(dir string, nodes []Node) error {
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("create node dir: %w", err)
	}
	used := map[string]int{}
	for index, node := range nodes {
		seq := index + 1
		switch node.Type {
		case "folder":
			folderName := uniqueName(used, fmt.Sprintf("%03d-%s", seq, slug(node.Name)))
			folderDir := filepath.Join(dir, folderName)
			if err := os.MkdirAll(folderDir, 0755); err != nil {
				return fmt.Errorf("create folder %s: %w", node.Name, err)
			}
			if err := writeJSON(filepath.Join(folderDir, "folder.json"), map[string]any{
				"schemaVersion": FormatVersion,
				"seq":           seq,
				"id":            node.ID,
				"name":          node.Name,
				"type":          "folder",
			}); err != nil {
				return err
			}
			if err := writeNodes(folderDir, node.Children); err != nil {
				return err
			}
		case "request":
			fileName := uniqueName(used, fmt.Sprintf("%03d-%s.request.json", seq, slug(node.Name)))
			payload, err := requestPayload(node, seq)
			if err != nil {
				return err
			}
			if err := writeJSON(filepath.Join(dir, fileName), payload); err != nil {
				return err
			}
		default:
			return fmt.Errorf("unknown node type %q for %s", node.Type, node.ID)
		}
	}
	return nil
}

type sequencedNode struct {
	seq  int
	name string
	node Node
}

func readNodes(dir string) ([]Node, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read node dir %s: %w", dir, err)
	}
	items := make([]sequencedNode, 0, len(entries))
	for _, entry := range entries {
		name := entry.Name()
		path := filepath.Join(dir, name)
		if entry.IsDir() {
			var meta struct {
				Seq  int    `json:"seq"`
				ID   string `json:"id"`
				Name string `json:"name"`
				Type string `json:"type"`
			}
			if err := readJSON(filepath.Join(path, "folder.json"), &meta); err != nil {
				return nil, err
			}
			children, err := readNodes(path)
			if err != nil {
				return nil, err
			}
			items = append(items, sequencedNode{
				seq:  meta.Seq,
				name: name,
				node: Node{ID: meta.ID, Name: meta.Name, Type: "folder", Children: children},
			})
			continue
		}
		if !strings.HasSuffix(name, ".request.json") {
			continue
		}
		node, seq, err := readRequestNode(path)
		if err != nil {
			return nil, err
		}
		items = append(items, sequencedNode{seq: seq, name: name, node: node})
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].seq == items[j].seq {
			return items[i].name < items[j].name
		}
		return items[i].seq < items[j].seq
	})
	nodes := make([]Node, 0, len(items))
	for _, item := range items {
		nodes = append(nodes, item.node)
	}
	return nodes, nil
}

func readRequestNode(path string) (Node, int, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Node{}, 0, fmt.Errorf("read request %s: %w", path, err)
	}
	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		return Node{}, 0, fmt.Errorf("decode request %s: %w", path, err)
	}
	seq := 0
	if rawSeq, ok := payload["seq"].(float64); ok {
		seq = int(rawSeq)
	}
	delete(payload, "schemaVersion")
	delete(payload, "seq")
	cleaned, err := json.Marshal(payload)
	if err != nil {
		return Node{}, 0, fmt.Errorf("encode request %s: %w", path, err)
	}
	var node Node
	if err := json.Unmarshal(cleaned, &node); err != nil {
		return Node{}, 0, fmt.Errorf("decode request node %s: %w", path, err)
	}
	node.Raw = cleaned
	return node, seq, nil
}

func requestPayload(node Node, seq int) (map[string]any, error) {
	var payload map[string]any
	if err := json.Unmarshal(node.Raw, &payload); err != nil {
		return nil, fmt.Errorf("decode request %s: %w", node.ID, err)
	}
	payload["schemaVersion"] = FormatVersion
	payload["seq"] = seq
	return payload, nil
}

func readJSON(path string, value any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read %s: %w", path, err)
	}
	if err := json.Unmarshal(data, value); err != nil {
		return fmt.Errorf("decode %s: %w", path, err)
	}
	return nil
}

func writeJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal %s: %w", path, err)
	}
	data = append(data, '\n')
	return writeBytes(path, data)
}

func writeText(path, value string) error {
	return writeBytes(path, []byte(value))
}

func writeBytes(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return fmt.Errorf("create parent for %s: %w", path, err)
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0644); err != nil {
		return fmt.Errorf("write temp %s: %w", tmp, err)
	}
	_ = os.Remove(path)
	if err := os.Rename(tmp, path); err != nil {
		return fmt.Errorf("replace %s: %w", path, err)
	}
	return nil
}

var nonSlug = regexp.MustCompile(`[^a-z0-9]+`)

func slug(value string) string {
	out := strings.ToLower(strings.TrimSpace(value))
	out = nonSlug.ReplaceAllString(out, "-")
	out = strings.Trim(out, "-")
	if out == "" {
		out = "unnamed"
	}
	if len(out) > 80 {
		out = strings.Trim(out[:80], "-")
	}
	switch out {
	case "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9":
		return out + "-item"
	default:
		return out
	}
}

func uniqueName(used map[string]int, base string) string {
	count := used[base]
	used[base] = count + 1
	if count == 0 {
		return base
	}
	ext := filepath.Ext(base)
	stem := strings.TrimSuffix(base, ext)
	return fmt.Sprintf("%s-%d%s", stem, count+1, ext)
}

func collectionHash(collection Collection) string {
	data, _ := json.Marshal(collection)
	var canonical any
	if err := json.Unmarshal(data, &canonical); err == nil {
		if canonicalData, err := json.Marshal(canonical); err == nil {
			data = canonicalData
		}
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func Snapshot(root string) (map[string][]byte, error) {
	out := map[string][]byte{}
	if err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		out[filepath.ToSlash(rel)] = data
		return nil
	}); err != nil {
		return nil, err
	}
	return out, nil
}

func EqualSnapshots(a, b map[string][]byte) bool {
	if len(a) != len(b) {
		return false
	}
	keys := make([]string, 0, len(a))
	for key := range a {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		if !bytes.Equal(a[key], b[key]) {
			return false
		}
	}
	return true
}
