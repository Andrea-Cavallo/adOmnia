package adomniacli

import (
	"crypto/sha256"
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/collectionfs"
	"github.com/Andrea-Cavallo/adOmnia/internal/collectionresolve"
	"github.com/Andrea-Cavallo/adOmnia/internal/devcontext"
	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
	"github.com/Andrea-Cavallo/adOmnia/internal/requestcontract"
)

const generatedRequestPrefix = "req-route-"

func (s *mcpServer) projectListRoutes(project string) (string, error) {
	snapshot, routes, err := scanMCPProjectRoutes(project)
	if err != nil {
		return "", err
	}
	return jsonText(map[string]any{"project": snapshot.Root, "routes": routes, "warnings": snapshot.Warnings})
}

func scanMCPProjectRoutes(project string) (devcontext.Snapshot, []devcontext.Entity, error) {
	root := strings.TrimSpace(project)
	if root == "" {
		return devcontext.Snapshot{}, nil, fmt.Errorf("project is required")
	}
	root, err := filepath.Abs(root)
	if err != nil {
		return devcontext.Snapshot{}, nil, err
	}
	info, err := os.Stat(root)
	if err != nil {
		return devcontext.Snapshot{}, nil, fmt.Errorf("open project: %w", err)
	}
	if !info.IsDir() {
		return devcontext.Snapshot{}, nil, fmt.Errorf("project is not a directory: %s", root)
	}
	manager := devcontext.NewManager(func(string) (string, error) { return root, nil }, nil)
	snapshot, err := manager.Rescan("mcp-project")
	if err != nil {
		return devcontext.Snapshot{}, nil, err
	}
	routes := make([]devcontext.Entity, 0)
	for _, entity := range snapshot.Entities {
		if entity.Kind == "route" {
			routes = append(routes, entity)
		}
	}
	return snapshot, routes, nil
}

func (s *mcpServer) collectionCreateFromCode(project, requested, name, baseURL string) (string, error) {
	snapshot, routes, err := scanMCPProjectRoutes(project)
	if err != nil {
		return "", err
	}
	if len(routes) == 0 {
		return "", fmt.Errorf("no HTTP routes found in %s", snapshot.Root)
	}
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	folder, collection, created, err := s.loadCollectionForWrite(requested, name, project)
	if err != nil {
		return "", err
	}
	collection.Children = removeGeneratedRequests(collection.Children)
	if strings.TrimSpace(baseURL) == "" {
		baseURL = "{{baseUrl}}"
	}
	generatedCount := 0
	for _, route := range routes {
		method := strings.ToUpper(strings.TrimSpace(route.Attrs["method"]))
		path := strings.TrimSpace(route.Attrs["path"])
		if !validMCPMethod(method) || path == "" {
			snapshot.Warnings = append(snapshot.Warnings, "skipped unsupported route "+method+" "+path)
			continue
		}
		request := requestcontract.Request{
			ID: generatedRequestPrefix + shortMCPHash(method+" "+path), Name: method + " " + path,
			Type: "request", Method: method, URL: strings.TrimRight(baseURL, "/") + "/" + strings.TrimLeft(path, "/"),
		}
		if err := validateMCPRequest(request); err != nil {
			return "", fmt.Errorf("route %s %s: %w", method, path, err)
		}
		if err := upsertMCPRequest(&collection, request, ""); err != nil {
			return "", err
		}
		generatedCount++
	}
	if err := saveMCPCollection(folder, collection); err != nil {
		return "", err
	}
	return jsonText(map[string]any{
		"collection": folder, "created": created, "generatedCount": generatedCount,
		"requestCount": collectionfs.CountRequests(collection.Children), "warnings": snapshot.Warnings,
	})
}

func (s *mcpServer) collectionUpsertRequest(requested, folderPath string, raw jsonv1.RawMessage) (string, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return "", fmt.Errorf("request is required")
	}
	var request requestcontract.Request
	if err := json.Unmarshal(raw, &request); err != nil {
		return "", fmt.Errorf("invalid request: %w", err)
	}
	request.ID = strings.TrimSpace(request.ID)
	request.Method = strings.ToUpper(strings.TrimSpace(request.Method))
	request.URL = strings.TrimSpace(request.URL)
	request.Type = "request"
	if strings.TrimSpace(request.Name) == "" {
		request.Name = request.Method + " " + request.URL
	}
	if err := validateMCPRequest(request); err != nil {
		return "", err
	}
	if err := validateMCPFolder(folderPath); err != nil {
		return "", err
	}
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	collection, folder, err := s.loadCollection(requested)
	if err != nil {
		return "", err
	}
	_, found, err := findMCPRequest(collection, request.ID)
	if err != nil {
		return "", err
	}
	created := !found
	if err := upsertMCPRequest(&collection, request, folderPath); err != nil {
		return "", err
	}
	if err := saveMCPCollection(folder, collection); err != nil {
		return "", err
	}
	return jsonText(map[string]any{"collection": folder, "id": request.ID, "created": created})
}

func (s *mcpServer) collectionDeleteRequest(requested, id string) (string, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return "", fmt.Errorf("id is required")
	}
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	collection, folder, err := s.loadCollection(requested)
	if err != nil {
		return "", err
	}
	children, found := removeMCPRequest(collection.Children, id)
	if !found {
		return "", fmt.Errorf("no request with id %q in the collection", id)
	}
	collection.Children = children
	if err := saveMCPCollection(folder, collection); err != nil {
		return "", err
	}
	return jsonText(map[string]any{"collection": folder, "id": id, "deleted": true})
}

func (s *mcpServer) loadCollectionForWrite(requested, name, project string) (string, collectionfs.Collection, bool, error) {
	if collection, folder, err := s.loadCollection(requested); err == nil {
		return folder, collection, false, nil
	}
	folder := strings.TrimSpace(requested)
	if folder == "" {
		folder = s.defaultFolder
	}
	if folder == "" {
		folder = "."
	}
	folder, err := filepath.Abs(folder)
	if err != nil {
		return "", collectionfs.Collection{}, false, err
	}
	if _, err := os.Stat(filepath.Join(folder, "collection.json")); !os.IsNotExist(err) {
		return "", collectionfs.Collection{}, false, fmt.Errorf("no writable adOmnia collection in %s", folder)
	}
	name = strings.TrimSpace(name)
	if name == "" {
		name = filepath.Base(project) + " API"
	}
	collection := collectionfs.Collection{ID: "col-" + shortMCPHash(folder), Name: name, Children: []collectionfs.Node{}}
	return folder, collection, true, nil
}

func validateMCPRequest(request requestcontract.Request) error {
	if request.ID == "" || len(request.ID) > 256 {
		return fmt.Errorf("request.id is required and must be at most 256 characters")
	}
	if !validMCPMethod(request.Method) {
		return fmt.Errorf("request.method must be a standard HTTP method")
	}
	if request.URL == "" {
		return fmt.Errorf("request.url is required")
	}
	if strings.Contains(request.URL, "{{") {
		return nil
	}
	parsed, err := url.Parse(request.URL)
	if err != nil || (parsed.Scheme != "" && parsed.Scheme != "http" && parsed.Scheme != "https") || (parsed.Scheme == "" && !strings.HasPrefix(request.URL, "/")) {
		return fmt.Errorf("request.url must be an HTTP(S) URL, an absolute path, or contain variables")
	}
	return nil
}

func validMCPMethod(method string) bool {
	switch method {
	case "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS":
		return true
	default:
		return false
	}
}

func validateMCPFolder(folder string) error {
	if strings.Contains(folder, `\`) {
		return fmt.Errorf("folder must use slash-separated names")
	}
	for _, part := range strings.Split(folder, "/") {
		part = strings.TrimSpace(part)
		if part == "." || part == ".." || (part == "" && strings.TrimSpace(folder) != "") {
			return fmt.Errorf("folder contains an invalid path segment")
		}
	}
	return nil
}

func upsertMCPRequest(collection *collectionfs.Collection, request requestcontract.Request, folderPath string) error {
	resolved, err := collectionresolve.ResolveRequests(*collection)
	if err != nil {
		return err
	}
	for _, existing := range resolved {
		if existing.Request.ID != request.ID && strings.EqualFold(existing.Request.Method, request.Method) && existing.Request.URL == request.URL {
			return fmt.Errorf("request %s %s already exists with id %q", request.Method, request.URL, existing.Request.ID)
		}
	}
	raw, err := jsonutil.Marshal(request)
	if err != nil {
		return err
	}
	node := collectionfs.Node{ID: request.ID, Name: request.Name, Type: "request", Raw: raw}
	if strings.TrimSpace(folderPath) == "" {
		if children, found := replaceMCPRequest(collection.Children, node); found {
			collection.Children = children
			return nil
		}
	}
	children, _ := removeMCPRequest(collection.Children, request.ID)
	collection.Children = children
	if strings.TrimSpace(folderPath) == "" {
		collection.Children = append(collection.Children, node)
		return nil
	}
	collection.Children = insertMCPRequestAtFolder(collection.Children, strings.Split(folderPath, "/"), "", node)
	return nil
}

func replaceMCPRequest(nodes []collectionfs.Node, request collectionfs.Node) ([]collectionfs.Node, bool) {
	out := append([]collectionfs.Node(nil), nodes...)
	found := false
	for index := range out {
		if out[index].Type == "request" && out[index].ID == request.ID {
			out[index] = request
			found = true
			continue
		}
		children, childFound := replaceMCPRequest(out[index].Children, request)
		out[index].Children = children
		found = found || childFound
	}
	return out, found
}

func removeMCPRequest(nodes []collectionfs.Node, id string) ([]collectionfs.Node, bool) {
	out := make([]collectionfs.Node, 0, len(nodes))
	found := false
	for _, node := range nodes {
		if node.Type == "request" && node.ID == id {
			found = true
			continue
		}
		children, childFound := removeMCPRequest(node.Children, id)
		node.Children = children
		out = append(out, node)
		found = found || childFound
	}
	return out, found
}

func insertMCPRequestAtFolder(nodes []collectionfs.Node, parts []string, prefix string, request collectionfs.Node) []collectionfs.Node {
	name := strings.TrimSpace(parts[0])
	fullPath := name
	if prefix != "" {
		fullPath = prefix + "/" + name
	}
	for index := range nodes {
		if nodes[index].Type == "folder" && nodes[index].Name == name {
			if len(parts) == 1 {
				nodes[index].Children = append(nodes[index].Children, request)
			} else {
				nodes[index].Children = insertMCPRequestAtFolder(nodes[index].Children, parts[1:], fullPath, request)
			}
			return nodes
		}
	}
	folder := collectionfs.Node{ID: "folder-" + shortMCPHash(fullPath), Name: name, Type: "folder", Children: []collectionfs.Node{}}
	if len(parts) == 1 {
		folder.Children = append(folder.Children, request)
	} else {
		folder.Children = insertMCPRequestAtFolder(folder.Children, parts[1:], fullPath, request)
	}
	return append(nodes, folder)
}

func removeGeneratedRequests(nodes []collectionfs.Node) []collectionfs.Node {
	out := make([]collectionfs.Node, 0, len(nodes))
	for _, node := range nodes {
		if node.Type == "request" && strings.HasPrefix(node.ID, generatedRequestPrefix) {
			continue
		}
		node.Children = removeGeneratedRequests(node.Children)
		out = append(out, node)
	}
	return out
}

func findMCPRequest(collection collectionfs.Collection, id string) (requestcontract.Request, bool, error) {
	resolved, err := collectionresolve.ResolveRequests(collection)
	if err != nil {
		return requestcontract.Request{}, false, err
	}
	for _, request := range resolved {
		if request.Request.ID == id {
			return request.Request, true, nil
		}
	}
	return requestcontract.Request{}, false, nil
}

func saveMCPCollection(folder string, collection collectionfs.Collection) error {
	environments, err := readMCPEnvironments(folder)
	if err != nil {
		return err
	}
	return saveMCPEnvironments(folder, collection, environments)
}

func readMCPEnvironments(folder string) ([]collectionfs.Environment, error) {
	entries, err := os.ReadDir(filepath.Join(folder, "environments"))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	environments := make([]collectionfs.Environment, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(folder, "environments", entry.Name()))
		if err != nil {
			return nil, err
		}
		var environment collectionfs.Environment
		if err := json.Unmarshal(data, &environment); err != nil {
			return nil, fmt.Errorf("decode environment %s: %w", entry.Name(), err)
		}
		name := strings.TrimSuffix(entry.Name(), ".json")
		if environment.Name == "" {
			environment.Name = name
		}
		if environment.ID == "" {
			environment.ID = "env-" + shortMCPHash(name)
		}
		if environment.Variables == nil {
			vars, err := loadEnvironmentVars(folder, name)
			if err != nil {
				return nil, err
			}
			keys := make([]string, 0, len(vars))
			for key := range vars {
				keys = append(keys, key)
			}
			sort.Strings(keys)
			for _, key := range keys {
				environment.Variables = append(environment.Variables, requestcontract.Variable{Key: key, Value: vars[key], Enabled: true})
			}
		}
		environments = append(environments, environment)
	}
	return environments, nil
}

func shortMCPHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return fmt.Sprintf("%x", sum[:8])
}
