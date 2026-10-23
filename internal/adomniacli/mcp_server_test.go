package adomniacli

import (
	"bytes"
	"encoding/json/v2"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// rpc sends one request line to a fresh server and decodes the single reply.
func rpc(t *testing.T, folder, line string) map[string]any {
	t.Helper()
	var out bytes.Buffer
	args := []string{"mcp"}
	if folder != "" {
		args = append(args, folder)
	}
	if code := MCP(args, strings.NewReader(line+"\n"), &out, &bytes.Buffer{}); code != 0 {
		t.Fatalf("exit %d", code)
	}
	var reply map[string]any
	if err := json.Unmarshal(out.Bytes(), &reply); err != nil {
		t.Fatalf("reply %q: %v", out.String(), err)
	}
	return reply
}

func rpcError(reply map[string]any) (int, string) {
	e, ok := reply["error"].(map[string]any)
	if !ok {
		return 0, ""
	}
	return int(e["code"].(float64)), e["message"].(string)
}

func toolText(t *testing.T, reply map[string]any) (string, bool) {
	t.Helper()
	result := reply["result"].(map[string]any)
	content := result["content"].([]any)[0].(map[string]any)
	return content["text"].(string), result["isError"].(bool)
}

// mcpCollection exports a collection with a secret-bearing header and two environments.
func mcpCollection(t *testing.T) string {
	t.Helper()
	root := exportTestCollection(t, "http://127.0.0.1:1", "200")
	if err := os.MkdirAll(filepath.Join(root, "environments"), 0o755); err != nil {
		t.Fatal(err)
	}
	write := func(name, body string) {
		if err := os.WriteFile(filepath.Join(root, "environments", name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("dev.json", `{"variables":[{"key":"baseUrl","value":"http://dev","enabled":true},{"key":"apiToken","value":"s3cr3t","enabled":true}]}`)
	write("flat.json", `{"host":"h","password":"pw"}`)
	return root
}

func TestMCPInitializeNegotiatesVersionAndAdvertisesCapabilities(t *testing.T) {
	reply := rpc(t, "", `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}`)
	result := reply["result"].(map[string]any)
	if result["protocolVersion"] != "2025-03-26" {
		t.Fatalf("known version must be echoed: %v", result["protocolVersion"])
	}
	caps := result["capabilities"].(map[string]any)
	for _, name := range []string{"tools", "resources", "prompts"} {
		if _, ok := caps[name]; !ok {
			t.Fatalf("missing capability %s", name)
		}
	}
	if !strings.Contains(result["instructions"].(string), "masked") {
		t.Fatalf("instructions = %v", result["instructions"])
	}
	unknown := rpc(t, "", `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"1999-01-01"}}`)
	if unknown["result"].(map[string]any)["protocolVersion"] != mcpProtocolVersions[0] {
		t.Fatalf("unknown version must fall back to the newest")
	}
}

func TestMCPProtocolErrors(t *testing.T) {
	cases := []struct {
		name, line string
		code       int
	}{
		{"unknown method", `{"jsonrpc":"2.0","id":1,"method":"nope"}`, rpcMethodNotFound},
		{"missing method", `{"jsonrpc":"2.0","id":1}`, rpcInvalidRequest},
		{"garbage", `{not json`, rpcParseError},
		{"unknown tool", `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"nope"}}`, rpcInvalidParams},
		{"tool without name", `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{}}`, rpcInvalidParams},
		{"resource without uri", `{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{}}`, rpcInvalidParams},
		{"unknown resource", `{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"adomnia://other"}}`, rpcResourceMissing},
		{"prompt without name", `{"jsonrpc":"2.0","id":1,"method":"prompts/get","params":{}}`, rpcInvalidParams},
		{"unknown prompt", `{"jsonrpc":"2.0","id":1,"method":"prompts/get","params":{"name":"nope"}}`, rpcInvalidParams},
		{"missing prompt argument", `{"jsonrpc":"2.0","id":1,"method":"prompts/get","params":{"name":"test_endpoint"}}`, rpcInvalidParams},
	}
	for _, tc := range cases {
		code, _ := rpcError(rpc(t, "", tc.line))
		if code != tc.code {
			t.Errorf("%s: code = %d, want %d", tc.name, code, tc.code)
		}
	}
}

func TestMCPPingAndLoggingAndEmptyLines(t *testing.T) {
	var out bytes.Buffer
	in := "\n" + `{"jsonrpc":"2.0","id":1,"method":"ping"}` + "\n" + `{"jsonrpc":"2.0","id":2,"method":"logging/setLevel","params":{"level":"info"}}` + "\n"
	if code := MCP([]string{"mcp"}, strings.NewReader(in), &out, &bytes.Buffer{}); code != 0 {
		t.Fatalf("exit %d", code)
	}
	if lines := strings.Split(strings.TrimSpace(out.String()), "\n"); len(lines) != 2 {
		t.Fatalf("replies = %q", out.String())
	}
}

func TestMCPToolsHaveSchemasTitlesAndAnnotations(t *testing.T) {
	reply := rpc(t, "", `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
	tools := reply["result"].(map[string]any)["tools"].([]any)
	if len(tools) < 9 {
		t.Fatalf("tools = %d", len(tools))
	}
	for _, raw := range tools {
		tool := raw.(map[string]any)
		if tool["title"] == "" || tool["annotations"] == nil || tool["inputSchema"].(map[string]any)["type"] != "object" {
			t.Errorf("incomplete tool %v", tool["name"])
		}
	}
	if !mcpKnownTool("collection_get_request") || mcpKnownTool("nope") {
		t.Fatal("mcpKnownTool")
	}
}

func TestMCPCollectionToolsReadMaskedData(t *testing.T) {
	root := mcpCollection(t)
	call := func(tool, args string) (string, bool) {
		return toolText(t, rpc(t, root, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"`+tool+`","arguments":`+args+`}}`))
	}

	list, isErr := call("collection_list_requests", `{}`)
	if isErr || !strings.Contains(list, "req-cli") || !strings.Contains(list, `"Method": "GET"`) && !strings.Contains(list, `"method": "GET"`) {
		t.Fatalf("list = %s", list)
	}
	got, isErr := call("collection_get_request", `{"id":"req-cli"}`)
	if isErr || !strings.Contains(got, "CLI Probe") || !strings.Contains(got, "X-Run") {
		t.Fatalf("get = %s", got)
	}
	if _, isErr := call("collection_get_request", `{"id":"missing"}`); !isErr {
		t.Fatal("unknown id must be a tool error")
	}
	if _, isErr := call("collection_get_request", `{}`); !isErr {
		t.Fatal("missing id must be a tool error")
	}

	envs, isErr := call("collection_list_environments", `{}`)
	if isErr || !strings.Contains(envs, "baseUrl") || !strings.Contains(envs, "http://dev") {
		t.Fatalf("envs = %s", envs)
	}
	if strings.Contains(envs, "s3cr3t") || strings.Contains(envs, `"pw"`) || !strings.Contains(envs, maskedValue) {
		t.Fatalf("secrets leaked or mask missing: %s", envs)
	}
	if text, isErr := call("collection_list_requests", `{"collection":5}`); !isErr || !strings.Contains(text, "invalid arguments") {
		t.Fatalf("wrong argument type = %q %v", text, isErr)
	}
}

func TestMCPCollectionToolErrorsWithoutCollection(t *testing.T) {
	empty := t.TempDir()
	for _, tool := range []string{"collection_list_requests", "collection_list_environments", "collection_run"} {
		text, isErr := toolText(t, rpc(t, empty, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"`+tool+`"}}`))
		if !isErr || !strings.Contains(text, "no adOmnia collection") {
			t.Errorf("%s: %q %v", tool, text, isErr)
		}
	}
	text, isErr := toolText(t, rpc(t, empty, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"mock_start"}}`))
	if !isErr || !strings.Contains(text, "config is required") {
		t.Fatalf("mock_start = %q", text)
	}
}

func TestMCPCollectionRunExecutesAgainstServer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }))
	defer server.Close()
	root := exportTestCollection(t, server.URL, "200")
	text, isErr := toolText(t, rpc(t, root, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"collection_run"}}`))
	if isErr || !strings.Contains(text, "passed") {
		t.Fatalf("run = %q %v", text, isErr)
	}
	_, isErr = toolText(t, rpc(t, root, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"collection_run","arguments":{"env":"missing"}}}`))
	if !isErr {
		t.Fatal("unknown environment must be a tool error")
	}
}

func TestMCPResources(t *testing.T) {
	root := mcpCollection(t)
	list := rpc(t, root, `{"jsonrpc":"2.0","id":1,"method":"resources/list"}`)["result"].(map[string]any)["resources"].([]any)
	uris := map[string]bool{}
	for _, item := range list {
		uris[item.(map[string]any)["uri"].(string)] = true
	}
	for _, want := range []string{mcpCollectionURI, mcpRequestPrefix + "req-cli", mcpEnvironmentPref + "dev", mcpEnvironmentPref + "flat"} {
		if !uris[want] {
			t.Errorf("resource %s not listed: %v", want, uris)
		}
	}
	templates := rpc(t, root, `{"jsonrpc":"2.0","id":1,"method":"resources/templates/list"}`)["result"].(map[string]any)["resourceTemplates"].([]any)
	if len(templates) != 2 {
		t.Fatalf("templates = %v", templates)
	}

	read := func(uri string) (string, int) {
		reply := rpc(t, root, `{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"`+uri+`"}}`)
		if code, _ := rpcError(reply); code != 0 {
			return "", code
		}
		return reply["result"].(map[string]any)["contents"].([]any)[0].(map[string]any)["text"].(string), 0
	}
	if text, code := read(mcpCollectionURI); code != 0 || !strings.Contains(text, `"requests": 1`) || !strings.Contains(text, `"environments": 2`) {
		t.Fatalf("summary = %q %d", text, code)
	}
	if text, code := read(mcpRequestPrefix + "req-cli"); code != 0 || !strings.Contains(text, "CLI Probe") {
		t.Fatalf("request = %q %d", text, code)
	}
	if text, code := read(mcpEnvironmentPref + "dev"); code != 0 || strings.Contains(text, "s3cr3t") || !strings.Contains(text, "http://dev") {
		t.Fatalf("environment = %q %d", text, code)
	}
	for _, uri := range []string{mcpRequestPrefix + "nope", mcpEnvironmentPref + "nope", mcpRequestPrefix + "%zz", mcpEnvironmentPref + "%zz"} {
		if _, code := read(uri); code != rpcResourceMissing {
			t.Errorf("%s: code = %d", uri, code)
		}
	}
}

func TestMCPResourcesWithoutCollectionStillListSummary(t *testing.T) {
	list := rpc(t, t.TempDir(), `{"jsonrpc":"2.0","id":1,"method":"resources/list"}`)["result"].(map[string]any)["resources"].([]any)
	if len(list) != 1 {
		t.Fatalf("resources = %v", list)
	}
}

func TestMCPPrompts(t *testing.T) {
	list := rpc(t, "", `{"jsonrpc":"2.0","id":1,"method":"prompts/list"}`)["result"].(map[string]any)["prompts"].([]any)
	if len(list) != 3 {
		t.Fatalf("prompts = %d", len(list))
	}
	get := func(name, args string) string {
		reply := rpc(t, "", `{"jsonrpc":"2.0","id":1,"method":"prompts/get","params":{"name":"`+name+`","arguments":`+args+`}}`)
		if code, msg := rpcError(reply); code != 0 {
			t.Fatalf("%s: %d %s", name, code, msg)
		}
		return reply["result"].(map[string]any)["messages"].([]any)[0].(map[string]any)["content"].(map[string]any)["text"].(string)
	}
	if text := get("test_endpoint", `{"request":"req-1","env":"dev"}`); !strings.Contains(text, `"req-1"`) || !strings.Contains(text, `"dev"`) {
		t.Fatalf("test_endpoint = %s", text)
	}
	if text := get("run_collection_report", `{}`); !strings.Contains(text, "the whole collection") {
		t.Fatalf("run_collection_report = %s", text)
	}
	if text := get("run_collection_report", `{"folder":"auth"}`); !strings.Contains(text, `"auth"`) {
		t.Fatalf("run_collection_report folder = %s", text)
	}
	if text := get("mock_dependency", `{"method":"post","path":"/v1/users"}`); !strings.Contains(text, "POST /v1/users answering 200") {
		t.Fatalf("mock_dependency = %s", text)
	}
	if text := get("mock_dependency", `{"method":"get","path":"/x","status":"404"}`); !strings.Contains(text, "answering 404") {
		t.Fatalf("mock_dependency status = %s", text)
	}
}

func TestMaskSecrets(t *testing.T) {
	var input any
	_ = json.Unmarshal([]byte(`{
		"auth":{"type":"bearer","token":"abc","empty":""},
		"headers":[{"key":"Authorization","value":"Bearer x"},{"key":"X-Run","value":"cli"},{"key":"x-api-key","value":"k"}],
		"nested":{"clientSecret":"s","name":"keep"}}`), &input)
	text, _ := jsonText(maskSecrets(input))
	for _, leaked := range []string{`"abc"`, "Bearer x", `"k"`, `"s"`} {
		if strings.Contains(text, leaked) {
			t.Errorf("leaked %s in %s", leaked, text)
		}
	}
	for _, kept := range []string{"cli", "keep", `"type": "bearer"`} {
		if !strings.Contains(text, kept) {
			t.Errorf("lost %s in %s", kept, text)
		}
	}
	if maskValue("host", "h") != "h" || maskValue("password", "") != "" || maskValue("password", "x") != maskedValue {
		t.Fatal("maskValue")
	}
}

func TestMCPMockLifecycleInOneSession(t *testing.T) {
	call := func(id int, tool, args string) string {
		return `{"jsonrpc":"2.0","id":` + string(rune('0'+id)) + `,"method":"tools/call","params":{"name":"` + tool + `","arguments":` + args + `}}`
	}
	lines := strings.Join([]string{
		call(1, "mock_start", `{"config":{"port":19871,"endpoints":[]}}`),
		call(2, "mock_status", `{}`),
		call(3, "mock_hits", `{}`),
		call(4, "mock_clear_hits", `{}`),
		call(5, "mock_stop", `{}`),
	}, "\n") + "\n"
	var out bytes.Buffer
	if code := MCP([]string{"mcp"}, strings.NewReader(lines), &out, &bytes.Buffer{}); code != 0 {
		t.Fatalf("exit %d", code)
	}
	replies := strings.Split(strings.TrimSpace(out.String()), "\n")
	if len(replies) != 5 {
		t.Fatalf("replies = %d: %s", len(replies), out.String())
	}
	for i, reply := range replies {
		if strings.Contains(reply, `"isError":true`) {
			t.Errorf("step %d failed: %s", i+1, reply)
		}
	}
	if !strings.Contains(replies[1], `running`) {
		t.Errorf("status after start: %s", replies[1])
	}
}

func TestFolderOfKeepsNamesOnly(t *testing.T) {
	if got := folderOf([]string{"id1", "Auth", "id2", "Login"}); got != "id1/id2" && got != "Auth/Login" {
		// FolderPath alternates (id, name) or (name, id); either way no segment is dropped silently.
		t.Fatalf("folderOf = %q", got)
	}
	if folderOf(nil) != "" {
		t.Fatal("empty path")
	}
}
