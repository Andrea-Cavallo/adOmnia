package collectionresolve

import (
	"encoding/json"
	"fmt"
	"strings"

	"adomnia/internal/collectionfs"
	"adomnia/internal/requestcontract"
)

type ResolvedRequest struct {
	Request    requestcontract.Request
	Vars       map[string]string
	FolderPath []string
}

type scopeState struct {
	auth       requestcontract.Auth
	headers    []requestcontract.KVRow
	variables  []requestcontract.Variable
	preScript  string
	postScript string
}

func ResolveEffectiveRequest(collection collectionfs.Collection, requestID string) (ResolvedRequest, bool, error) {
	requests, err := ResolveRequests(collection)
	if err != nil {
		return ResolvedRequest{}, false, err
	}
	for _, item := range requests {
		if item.Request.ID == requestID {
			return item, true, nil
		}
	}
	return ResolvedRequest{}, false, nil
}

func ResolveRequests(collection collectionfs.Collection) ([]ResolvedRequest, error) {
	root := scopeState{
		auth:       collection.Auth,
		headers:    cloneRows(collection.Headers),
		variables:  cloneVariables(collection.Variables),
		preScript:  collection.PreScript,
		postScript: collection.PostScript,
	}
	return resolveNodes(collection.Children, root, nil)
}

func resolveNodes(nodes []collectionfs.Node, scope scopeState, folderPath []string) ([]ResolvedRequest, error) {
	out := []ResolvedRequest{}
	for _, node := range nodes {
		switch node.Type {
		case "folder":
			nextScope := mergeScope(scope, node)
			nextPath := append(append([]string{}, folderPath...), node.Name, node.ID)
			children, err := resolveNodes(node.Children, nextScope, nextPath)
			if err != nil {
				return nil, err
			}
			out = append(out, children...)
		case "request":
			req, err := decodeRequest(node)
			if err != nil {
				return nil, err
			}
			resolved := applyRequestInheritance(req, scope)
			out = append(out, ResolvedRequest{
				Request:    resolved,
				Vars:       variablesMap(scope.variables),
				FolderPath: append([]string{}, folderPath...),
			})
		}
	}
	return out, nil
}

func decodeRequest(node collectionfs.Node) (requestcontract.Request, error) {
	var req requestcontract.Request
	if len(node.Raw) == 0 {
		return req, fmt.Errorf("request %s has no payload", node.ID)
	}
	if err := json.Unmarshal(node.Raw, &req); err != nil {
		return req, fmt.Errorf("decode request %s: %w", node.ID, err)
	}
	return req, nil
}

func mergeScope(parent scopeState, folder collectionfs.Node) scopeState {
	next := scopeState{
		auth:       parent.auth,
		headers:    cloneRows(parent.headers),
		variables:  cloneVariables(parent.variables),
		preScript:  parent.preScript,
		postScript: parent.postScript,
	}
	if authIsSet(folder.Auth) {
		next.auth = folder.Auth
	}
	next.headers = mergeRows(next.headers, folder.Headers)
	next.variables = mergeVariables(next.variables, folder.Variables)
	if folder.PreScript != "" {
		next.preScript = appendScript(next.preScript, folder.PreScript)
	}
	if folder.PostScript != "" {
		next.postScript = appendScript(next.postScript, folder.PostScript)
	}
	return next
}

func applyRequestInheritance(req requestcontract.Request, scope scopeState) requestcontract.Request {
	policy := req.Inheritance
	if policy.Auth == "" || policy.Auth == "inherit" {
		if authIsSet(req.Auth) {
			req.Auth = req.Auth
		} else {
			req.Auth = scope.auth
		}
	} else if policy.Auth == "none" {
		req.Auth = requestcontract.Auth{Type: "none"}
	}

	if policy.Headers == "" || policy.Headers == "inherit" {
		req.Headers = mergeRows(scope.headers, req.Headers)
	} else if policy.Headers == "none" {
		req.Headers = nil
	}
	return req
}

func variablesMap(variables []requestcontract.Variable) map[string]string {
	out := map[string]string{}
	for _, variable := range variables {
		if !variable.Enabled || strings.TrimSpace(variable.Key) == "" {
			continue
		}
		out[variable.Key] = variable.Value
	}
	return out
}

func mergeRows(base, overlay []requestcontract.KVRow) []requestcontract.KVRow {
	out := cloneRows(base)
	positions := map[string]int{}
	for index, row := range out {
		if key := rowKey(row.Key); key != "" {
			positions[key] = index
		}
	}
	for _, row := range overlay {
		key := rowKey(row.Key)
		if key == "" {
			out = append(out, row)
			continue
		}
		if index, ok := positions[key]; ok {
			out[index] = row
			continue
		}
		positions[key] = len(out)
		out = append(out, row)
	}
	return out
}

func mergeVariables(base, overlay []requestcontract.Variable) []requestcontract.Variable {
	out := cloneVariables(base)
	positions := map[string]int{}
	for index, variable := range out {
		if key := rowKey(variable.Key); key != "" {
			positions[key] = index
		}
	}
	for _, variable := range overlay {
		key := rowKey(variable.Key)
		if key == "" {
			out = append(out, variable)
			continue
		}
		if index, ok := positions[key]; ok {
			out[index] = variable
			continue
		}
		positions[key] = len(out)
		out = append(out, variable)
	}
	return out
}

func authIsSet(auth requestcontract.Auth) bool {
	return strings.TrimSpace(auth.Type) != "" && auth.Type != "none"
}

func rowKey(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func cloneRows(rows []requestcontract.KVRow) []requestcontract.KVRow {
	return append([]requestcontract.KVRow{}, rows...)
}

func cloneVariables(variables []requestcontract.Variable) []requestcontract.Variable {
	return append([]requestcontract.Variable{}, variables...)
}

func appendScript(parent, child string) string {
	if strings.TrimSpace(parent) == "" {
		return child
	}
	return parent + "\n" + child
}
