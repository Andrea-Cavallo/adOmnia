package adomniacli

import (
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"fmt"
	"net/url"
	"strings"
)

const (
	mcpCollectionURI   = "adomnia://collection"
	mcpRequestPrefix   = "adomnia://collection/request/"
	mcpEnvironmentPref = "adomnia://collection/environment/"
	rpcResourceMissing = -32002
)

type mcpResource struct {
	URI         string `json:"uri"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	MIMEType    string `json:"mimeType"`
}

func mcpResourceTemplates() []map[string]string {
	return []map[string]string{
		{"uriTemplate": mcpRequestPrefix + "{id}", "name": "Collection request", "description": "One request of the collection, secrets masked.", "mimeType": "application/json"},
		{"uriTemplate": mcpEnvironmentPref + "{name}", "name": "Collection environment", "description": "Variables of one environment, secrets masked.", "mimeType": "application/json"},
	}
}

// resourcesList exposes what an agent may want to read without calling a tool: the collection
// summary, every request and every environment.
func (s *mcpServer) resourcesList(jsonv1.RawMessage) (any, *mcpError) {
	resources := []mcpResource{{URI: mcpCollectionURI, Name: "Collection summary", Description: "Name, request and environment counts.", MIMEType: "application/json"}}
	if rows, err := s.requestRows(""); err == nil {
		for _, row := range rows {
			resources = append(resources, mcpResource{URI: mcpRequestPrefix + url.PathEscape(row.ID), Name: row.Method + " " + row.Name, Description: row.URL, MIMEType: "application/json"})
		}
	}
	if environments, err := s.environments(""); err == nil {
		for _, environment := range environments {
			resources = append(resources, mcpResource{URI: mcpEnvironmentPref + url.PathEscape(environment.Name), Name: "Environment " + environment.Name, MIMEType: "application/json"})
		}
	}
	return map[string]any{"resources": resources}, nil
}

func (s *mcpServer) resourcesRead(raw jsonv1.RawMessage) (any, *mcpError) {
	var params struct {
		URI string `json:"uri"`
	}
	if err := json.Unmarshal(raw, &params); err != nil || params.URI == "" {
		return nil, invalidParams("resources/read needs a uri")
	}
	text, err := s.readResource(params.URI)
	if err != nil {
		return nil, &mcpError{rpcResourceMissing, err.Error()}
	}
	return map[string]any{"contents": []map[string]string{{"uri": params.URI, "mimeType": "application/json", "text": text}}}, nil
}

func (s *mcpServer) readResource(uri string) (string, error) {
	switch {
	case uri == mcpCollectionURI:
		collection, _, err := s.loadCollection("")
		if err != nil {
			return "", err
		}
		rows, err := s.requestRows("")
		if err != nil {
			return "", err
		}
		environments, err := s.environments("")
		if err != nil {
			return "", err
		}
		return jsonText(map[string]any{"name": collection.Name, "requests": len(rows), "environments": len(environments)})
	case strings.HasPrefix(uri, mcpRequestPrefix):
		id, err := url.PathUnescape(strings.TrimPrefix(uri, mcpRequestPrefix))
		if err != nil {
			return "", fmt.Errorf("bad resource uri %q", uri)
		}
		return s.getRequest("", id)
	case strings.HasPrefix(uri, mcpEnvironmentPref):
		name, err := url.PathUnescape(strings.TrimPrefix(uri, mcpEnvironmentPref))
		if err != nil {
			return "", fmt.Errorf("bad resource uri %q", uri)
		}
		environments, err := s.environments("")
		if err != nil {
			return "", err
		}
		for _, environment := range environments {
			if environment.Name == name {
				return jsonText(environment)
			}
		}
		return "", fmt.Errorf("no environment %q", name)
	}
	return "", fmt.Errorf("unknown resource %q", uri)
}

type mcpPromptArg struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Required    bool   `json:"required"`
}

type mcpPrompt struct {
	Name        string         `json:"name"`
	Title       string         `json:"title,omitempty"`
	Description string         `json:"description"`
	Arguments   []mcpPromptArg `json:"arguments"`
}

func mcpPrompts() []mcpPrompt {
	return []mcpPrompt{
		{"create_collection_from_code", "Create a collection from code", "Scan a Code Studio project, create or sync its API collection and review the generated requests.", []mcpPromptArg{
			{"project", "Project folder opened in Code Studio.", true},
			{"collection", "Destination collection folder; empty uses the server default.", false},
			{"name", "New collection name.", false},
			{"baseUrl", "Base URL prefix (default {{baseUrl}}).", false},
		}},
		{"configure_environment", "Configure an environment", "Create or update an environment with variables and secrets, then use it to run the collection.", []mcpPromptArg{
			{"name", "Environment name, for example dev.", true},
			{"collection", "Collection folder; empty uses the server default.", false},
			{"variables", "Variables as KEY=VALUE pairs or a JSON array with key, value, enabled and secret.", true},
		}},
		{"test_endpoint", "Test one endpoint", "Read one request of the collection, run it and explain any failing assertion.", []mcpPromptArg{
			{"request", "Request id from collection_list_requests.", true},
			{"env", "Environment name.", false},
		}},
		{"run_collection_report", "Run and report", "Run a folder (or the whole collection) and summarise what passed, what failed and why.", []mcpPromptArg{
			{"folder", "Folder name or slash path; empty runs everything.", false},
			{"env", "Environment name.", false},
		}},
		{"mock_dependency", "Mock a dependency", "Start the mock server for an upstream endpoint, then verify what the code under development sent to it.", []mcpPromptArg{
			{"method", "HTTP method of the upstream endpoint.", true},
			{"path", "Path of the upstream endpoint, for example /v1/users.", true},
			{"status", "Status code the mock answers with (default 200).", false},
		}},
	}
}

func (s *mcpServer) promptsGet(raw jsonv1.RawMessage) (any, *mcpError) {
	var params struct {
		Name      string            `json:"name"`
		Arguments map[string]string `json:"arguments"`
	}
	if err := json.Unmarshal(raw, &params); err != nil || params.Name == "" {
		return nil, invalidParams("prompts/get needs a prompt name")
	}
	for _, prompt := range mcpPrompts() {
		if prompt.Name != params.Name {
			continue
		}
		for _, argument := range prompt.Arguments {
			if argument.Required && strings.TrimSpace(params.Arguments[argument.Name]) == "" {
				return nil, invalidParams("prompt %s needs the %q argument", prompt.Name, argument.Name)
			}
		}
		text := promptText(prompt.Name, params.Arguments)
		return map[string]any{
			"description": prompt.Description,
			"messages":    []map[string]any{{"role": "user", "content": map[string]string{"type": "text", "text": text}}},
		}, nil
	}
	return nil, invalidParams("unknown prompt %q", params.Name)
}

func promptText(name string, args map[string]string) string {
	env := ""
	if args["env"] != "" {
		env = fmt.Sprintf(" with the %q environment", args["env"])
	}
	switch name {
	case "create_collection_from_code":
		baseURL := args["baseUrl"]
		if baseURL == "" {
			baseURL = "{{baseUrl}}"
		}
		return fmt.Sprintf("Create an adOmnia API collection from the Code Studio project %q. First call project_list_routes to inspect the detected routes, then call collection_create_from_code with project %q, collection %q, name %q and baseUrl %q. Finally call collection_list_requests and report the generated requests and any scan warnings. Do not invent routes that were not detected.", args["project"], args["project"], args["collection"], args["name"], baseURL)
	case "configure_environment":
		return fmt.Sprintf("Configure the adOmnia environment %q in collection %q with these variables: %s. Call collection_upsert_environment using a variables array with key, value, enabled and secret fields. Mark tokens, passwords and other sensitive values as secret. If the environment already exists, set merge=true so unspecified variables and secrets are preserved. Then call collection_list_environments to verify that secrets are masked and collection_run with env=%q to use the saved environment.", args["name"], args["collection"], args["variables"], args["name"])
	case "test_endpoint":
		return fmt.Sprintf("Use the adOmnia tools to test the request with id %q%s. First call collection_get_request to read it, then collection_run to execute it, and report the status, timing and every failing assertion. If it fails, explain the likely cause and what to change in the code or the request.", args["request"], env)
	case "run_collection_report":
		scope := "the whole collection"
		if args["folder"] != "" {
			scope = fmt.Sprintf("the folder %q", args["folder"])
		}
		return fmt.Sprintf("Use collection_run to run %s%s. Summarise how many requests passed and failed, list each failure with its assertion and response, and group failures that share a cause.", scope, env)
	default:
		status := args["status"]
		if status == "" {
			status = "200"
		}
		return fmt.Sprintf("Use the adOmnia mock server to stand in for an upstream API. Call mock_start with an endpoint for %s %s answering %s, run the code under development, then call mock_hits and verify the method, path, headers and body it sent. Call mock_stop when done.", strings.ToUpper(args["method"]), args["path"], status)
	}
}
