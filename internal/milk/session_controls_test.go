package milk

import (
	"context"
	"encoding/base64"
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"github.com/Andrea-Cavallo/adOmnia/internal/aipolicy"
	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestSessionControlUsesAdvertisedModelAndDoesNotCrossProjects(t *testing.T) {
	m := NewAgentManager(NewSettingsStore(t.TempDir()), Agent{Name: "fixture", Event: "claude", Protocol: 1})
	pair := newConnPair(t, &handler{manager: m})
	m.current = &process{conn: pair.conn}
	m.status.State = StateReady
	m.sessions["/one"] = "s1"
	m.rootBySession["s1"] = "/one"
	m.controls["/one"] = []SessionControl{{ID: "model", Type: "select", Category: "model", CurrentValue: "sonnet", Options: []ControlValue{{Name: "Models", Options: []ControlValue{{Value: "opus", Name: "Opus"}, {Value: "sonnet", Name: "Sonnet"}}}}}}
	m.controls["/two"] = []SessionControl{{ID: "model", CurrentValue: "other"}}
	if _, err := m.SetSessionControl(context.Background(), "/one", "model", "invented"); err == nil {
		t.Fatal("accepted unadvertised model")
	}
	m.turns["s1"] = "busy"
	if _, err := m.SetSessionControl(context.Background(), "/one", "model", "opus"); err == nil {
		t.Fatal("changed model during turn")
	}
	delete(m.turns, "s1")
	request := make(chan map[string]any, 1)
	go func() {
		wire := pair.readClientLine(t)
		var params map[string]any
		_ = json.Unmarshal(wire["params"], &params)
		params["method"] = string(wire["method"])
		request <- params
		writeLine(t, pair.agentToClient, map[string]any{"jsonrpc": "2.0", "id": jsonv1.RawMessage(wire["id"]), "result": map[string]any{}})
	}()
	result, err := m.SetSessionControl(context.Background(), "/one", "model", "opus")
	if err != nil {
		t.Fatal(err)
	}
	sent := <-request
	if sent["sessionId"] != "s1" || sent["configId"] != "model" || sent["value"] != "opus" {
		t.Fatalf("wrong params: %+v", sent)
	}
	if result.Controls[0].CurrentValue != "opus" || m.controls["/two"][0].CurrentValue != "other" {
		t.Fatal("project state mixed")
	}
	result.Controls[0].Options[0].Name = "mutated"
	if m.controls["/one"][0].Options[0].Name == "mutated" {
		t.Fatal("snapshot aliases manager state")
	}
	// Config changes from slash commands arrive outside a turn too.
	(&handler{manager: m}).HandleNotification("session/update", jsonv1.RawMessage(`{"sessionId":"s1","update":{"sessionUpdate":"config_option_update","configOptions":[{"id":"model","currentValue":"sonnet"}]}}`))
	if m.controls["/one"][0].CurrentValue != "sonnet" {
		t.Fatal("ignored out-of-turn config update")
	}
}

func TestImagesAreValidatedAndNeverSilentlyDropped(t *testing.T) {
	m := NewManager(NewSettingsStore(t.TempDir()))
	image := ImageAttachment{Name: "shot.png", MimeType: "image/png", Data: base64.StdEncoding.EncodeToString(append([]byte{137, 80, 78, 71, 13, 10, 26, 10}, make([]byte, 100)...))}
	request := PromptRequest{Message: "explain", Images: []ImageAttachment{image}}
	// Senza blocchi immagine nativi l'immagine diventa un riferimento @path,
	// come fa la TUI di milk: il modello non la perde e il file sparisce a fine turno.
	blocks, cleanup, err := m.promptBlocks(request)
	if err != nil {
		t.Fatal(err)
	}
	if len(blocks) != 1 || blocks[0]["type"] != "text" || !strings.Contains(blocks[0]["text"], "@") {
		t.Fatalf("image reference lost: %+v", blocks)
	}
	reference := strings.TrimPrefix(strings.Split(blocks[0]["text"], "\n")[0], "@")
	if _, err := os.Stat(reference); err != nil {
		t.Fatalf("image file not written: %v", err)
	}
	cleanup()
	if _, err := os.Stat(reference); !os.IsNotExist(err) {
		t.Fatal("image file was not cleaned up")
	}
	m.imagePrompts = true
	blocks, cleanup, err = m.promptBlocks(request)
	if err != nil || len(blocks) != 2 || blocks[1]["type"] != "image" || blocks[1]["data"] != image.Data {
		t.Fatalf("%v %+v", err, blocks)
	}
	cleanup()
	request.Images[0].MimeType = "image/jpeg"
	if _, _, err := m.promptBlocks(request); err == nil {
		t.Fatal("accepted false MIME")
	}
	request.Images[0].Data = "not-base64"
	if _, _, err := m.promptBlocks(request); err == nil {
		t.Fatal("accepted invalid data")
	}
}

func TestMilkV2ConfigIDsAndTypedBooleanRequests(t *testing.T) {
	m := NewManager(NewSettingsStore(t.TempDir()))
	pair := newConnPair(t, &handler{manager: m})
	m.current = &process{conn: pair.conn}
	m.status.State = StateReady
	m.sessions["/project"] = "session"
	m.rootBySession["session"] = "/project"
	var options []SessionControl
	if err := json.Unmarshal([]byte(`[{"configId":"think","name":"Reasoning","type":"boolean","currentValue":true}]`), &options); err != nil {
		t.Fatal(err)
	}
	m.controls["/project"] = options
	request := make(chan map[string]any, 1)
	go func() {
		wire := pair.readClientLine(t)
		var params map[string]any
		_ = json.Unmarshal(wire["params"], &params)
		request <- params
		writeLine(t, pair.agentToClient, map[string]any{"jsonrpc": "2.0", "id": jsonv1.RawMessage(wire["id"]), "result": map[string]any{}})
	}()
	result, err := m.SetSessionControl(context.Background(), "/project", "think", false)
	if err != nil {
		t.Fatal(err)
	}
	params := <-request
	if params["type"] != "boolean" || params["value"] != false || params["configId"] != "think" || result.Controls[0].CurrentValue != false {
		t.Fatalf("wrong v2 payload: %+v %+v", params, result)
	}
}

func TestMilkAgentChoicePreservesConfigurationAndSecrets(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	path := filepath.Join(home, ".milk", "config.json")
	_ = os.MkdirAll(filepath.Dir(path), 0700)
	original := `{"agent":"cheap","escalation_agent":"deep","unknown":{"keep":true},"agents":[{"name":"cheap","model":"small","token":"secret"},{"name":"deep","model":"large"}]}`
	if err := os.WriteFile(path, []byte(original), 0600); err != nil {
		t.Fatal(err)
	}
	control, err := configuredAgentControl()
	if err != nil {
		t.Fatal(err)
	}
	data, _ := jsonutil.Marshal(control)
	if strings.Contains(string(data), "secret") || len(control.Options) != 2 {
		t.Fatalf("unsafe model metadata: %s", data)
	}
	if _, err := selectConfiguredAgent("missing"); err == nil {
		t.Fatal("accepted missing agent")
	}
	if changed, err := selectConfiguredAgent("deep"); err != nil || !changed {
		t.Fatalf("selecting another agent must change the config: changed=%v err=%v", changed, err)
	}
	config, err := readConfig(path)
	if err != nil || config["agent"] != "deep" || config["escalation_agent"] != "deep" || config["unknown"] == nil {
		t.Fatalf("config lost: %+v %v", config, err)
	}
	backup, _ := os.ReadFile(path + ".bak")
	if string(backup) != original {
		t.Fatal("backup not preserved")
	}
}

func TestMilkV2PlanUsesNestedEntries(t *testing.T) {
	m := NewManager(NewSettingsStore(t.TempDir()))
	m.turns["s"] = "token"
	m.rootBySession["s"] = "/project"
	var event ChatEvent
	m.SetEmitter(func(name string, payload any) {
		if name == "milk.chat" {
			event = payload.(ChatEvent)
		}
	})
	(&handler{manager: m}).HandleNotification("session/update", jsonv1.RawMessage(`{"sessionId":"s","update":{"sessionUpdate":"plan_update","plan":{"type":"items","planId":"task","entries":[{"content":"Run tests","status":"in_progress"}]}}}`))
	if event.Kind != "plan" || len(event.Plan) != 1 || event.Plan[0].Content != "Run tests" || event.Root != "/project" {
		t.Fatalf("plan lost: %+v", event)
	}
}

func TestAgentControlsRespectProjectPolicyBeforeOpeningSession(t *testing.T) {
	root := t.TempDir()
	if err := aipolicy.Save(root, aipolicy.Off); err != nil {
		t.Fatal(err)
	}
	m := NewManager(NewSettingsStore(t.TempDir()))
	if _, err := m.SessionControls(root); err == nil || !strings.Contains(err.Error(), "policy") {
		t.Fatalf("policy ignored: %v", err)
	}
	if _, err := m.Prompt(context.Background(), PromptRequest{Root: root, Token: "t", Message: "hello"}); err == nil || !strings.Contains(err.Error(), "policy") {
		t.Fatalf("prompt policy ignored: %v", err)
	}
}

func TestNewSessionRequestsFreshMilkContextAndKeepsLegacyModelList(t *testing.T) {
	m := NewManager(NewSettingsStore(t.TempDir()))
	pair := newConnPair(t, &handler{manager: m})
	m.current = &process{conn: pair.conn}
	m.status.State = StateReady
	request := make(chan map[string]any, 1)
	go func() {
		wire := pair.readClientLine(t)
		var params map[string]any
		_ = json.Unmarshal(wire["params"], &params)
		request <- params
		writeLine(t, pair.agentToClient, map[string]any{"jsonrpc": "2.0", "id": jsonv1.RawMessage(wire["id"]), "result": map[string]any{"sessionId": "fresh", "configOptions": []map[string]any{{"configId": "think", "type": "boolean", "currentValue": true}}, "models": map[string]any{"currentModelId": "sonnet", "availableModels": []map[string]string{{"modelId": "sonnet", "name": "Sonnet"}, {"modelId": "opus", "name": "Opus"}}}}})
	}()
	result, err := m.SessionControls("/project")
	if err != nil {
		t.Fatal(err)
	}
	params := <-request
	meta, _ := params["_meta"].(map[string]any)
	milkMeta, _ := meta["milk"].(map[string]any)
	if milkMeta["fresh"] != true {
		t.Fatal("new UI chat could silently resume a previous milk conversation")
	}
	if len(result.Controls) != 2 || result.Controls[0].ID != "think" || result.Controls[1].ID != "_legacy_model" {
		t.Fatalf("capabilities lost: %+v", result)
	}
}

func TestImageAttachmentsLiveInAPrivateFolderNotInTheSharedTempDir(t *testing.T) {
	base := filepath.Join(t.TempDir(), "cache", "adomnia", "milk-images")
	original := attachmentRoot
	attachmentRoot = func() string { return base }
	t.Cleanup(func() { attachmentRoot = original })

	path, err := writeImageAttachment(ImageAttachment{Name: "shot.png"}, "image/png", []byte("png-bytes"))
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(path) != base {
		t.Fatalf("attachment written to %s, want the private folder %s", path, base)
	}
	if got, err := os.ReadFile(path); err != nil || string(got) != "png-bytes" {
		t.Fatalf("content = %q, %v", got, err)
	}
	if runtime.GOOS != "windows" {
		for _, entry := range []string{base, path} {
			info, err := os.Stat(entry)
			if err != nil {
				t.Fatal(err)
			}
			if info.Mode().Perm()&0o077 != 0 {
				t.Fatalf("%s is accessible to other users: %v", entry, info.Mode().Perm())
			}
		}
	}
}

func TestDefaultAttachmentFolderIsNotTheSharedTempDir(t *testing.T) {
	root := attachmentRoot()
	if root == "" {
		t.Skip("no user cache directory on this machine")
	}
	if rel, err := filepath.Rel(os.TempDir(), root); err == nil && !strings.HasPrefix(rel, "..") {
		t.Fatalf("%s is inside the shared temp dir %s", root, os.TempDir())
	}
}
