package milk

import (
	"adomnia/internal/aipolicy"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
)

func (m *Manager) SessionControls(root string) (SessionControls, error) {
	if !aipolicy.Allows(aipolicy.Load(root), m.agent.Event == "opencode") {
		return SessionControls{}, errors.New("project AI policy blocks this agent")
	}
	if err := m.wakeIfIdle(); err != nil {
		return SessionControls{}, err
	}
	if m.Status().State != StateReady {
		return SessionControls{}, errors.New("start the agent before selecting a model")
	}
	if strings.TrimSpace(root) == "" {
		return SessionControls{}, errors.New("open a project first")
	}
	if _, err := m.sessionFor(root); err != nil {
		return SessionControls{}, err
	}
	m.mu.Lock()
	data, _ := json.Marshal(m.controls[root])
	result := SessionControls{Root: root, Images: m.imagePrompts, Controls: []SessionControl{}}
	m.mu.Unlock()
	_ = json.Unmarshal(data, &result.Controls)
	if m.agent.Event == "milk" && versionAtLeast(m.Status().Version, "0.7.0") {
		if control, err := configuredAgentControl(); err == nil && len(control.Options) > 0 {
			result.Controls = append([]SessionControl{control}, result.Controls...)
		}
	}
	return result, nil
}

func controlHasValue(options []ControlValue, value string) bool {
	for _, option := range options {
		if option.Value == value && value != "" || controlHasValue(option.Options, value) {
			return true
		}
	}
	return false
}

func (m *Manager) SetSessionControl(ctx context.Context, root, configID string, value any) (SessionControls, error) {
	current, err := m.SessionControls(root)
	if err != nil {
		return SessionControls{}, err
	}
	var chosen *SessionControl
	for _, control := range current.Controls {
		if control.ID == configID {
			copy := control
			chosen = &copy
			break
		}
	}
	if chosen == nil {
		return SessionControls{}, errors.New("this session does not offer that option")
	}
	valid := false
	if chosen.Type == "boolean" {
		_, valid = value.(bool)
	} else if v, ok := value.(string); ok {
		valid = controlHasValue(chosen.Options, v)
	}
	if !valid {
		return SessionControls{}, errors.New("choose a value offered by this agent")
	}
	m.mu.Lock()
	id := m.sessions[root]
	if m.turns[id] != "" {
		m.mu.Unlock()
		return SessionControls{}, errors.New("stop the running turn before changing session settings")
	}
	m.turns[id] = "_settings"
	m.mu.Unlock()
	defer func() { m.mu.Lock(); delete(m.turns, id); m.mu.Unlock() }()
	if configID == "_milk_agent" {
		if err := selectConfiguredAgent(value.(string)); err != nil {
			return SessionControls{}, err
		}
		m.ResetSession(root)
		return m.SessionControls(root)
	}
	conn, err := m.connection()
	if err != nil {
		return SessionControls{}, err
	}
	callCtx, cancel := context.WithTimeout(ctx, sessionTimeout)
	defer cancel()
	method := "session/set_config_option"
	params := map[string]any{"sessionId": id, "configId": configID, "value": value}
	if m.agent.Protocol == 2 {
		params["type"] = "id"
		if chosen.Type == "boolean" {
			params["type"] = "boolean"
		}
	}
	if configID == "_legacy_model" {
		method = "session/set_model"
		params = map[string]any{"sessionId": id, "modelId": value}
	}
	var response struct {
		ConfigOptions []SessionControl `json:"configOptions"`
	}
	if err := conn.Call(callCtx, method, params, &response); err != nil {
		return SessionControls{}, err
	}
	m.mu.Lock()
	if m.sessions[root] != id {
		m.mu.Unlock()
		return SessionControls{}, errors.New("the agent session changed; reload its model options")
	}
	if len(response.ConfigOptions) > 0 {
		m.controls[root] = response.ConfigOptions
	} else {
		for index := range m.controls[root] {
			if m.controls[root][index].ID == configID {
				m.controls[root][index].CurrentValue = value
			}
		}
	}
	m.mu.Unlock()
	return m.SessionControls(root)
}

func configuredAgentControl() (SessionControl, error) {
	path, err := ConfigPath()
	if err != nil {
		return SessionControl{}, err
	}
	config, err := readConfig(path)
	if err != nil {
		return SessionControl{}, err
	}
	control := SessionControl{ID: "_milk_agent", Name: "Primary agent · new chat", Category: "model", Type: "select", CurrentValue: config["agent"], Options: []ControlValue{}}
	agents, _ := config["agents"].([]any)
	for _, item := range agents {
		entry, ok := item.(map[string]any)
		if !ok {
			continue
		}
		name, _ := entry["name"].(string)
		model, _ := entry["model"].(string)
		if name != "" {
			label := name
			if model != "" {
				label += " · " + model
			}
			control.Options = append(control.Options, ControlValue{Value: name, Name: label})
		}
	}
	return control, nil
}

func selectConfiguredAgent(name string) error {
	path, err := ConfigPath()
	if err != nil {
		return err
	}
	config, err := readConfig(path)
	if err != nil {
		return err
	}
	if !agentNames(config)[name] {
		return errors.New("milk agent is no longer configured")
	}
	config["agent"] = name
	return writeConfig(path, config)
}

func (m *Manager) promptBlocks(request PromptRequest) ([]map[string]string, error) {
	blocks := []map[string]string{{"type": "text", "text": strings.TrimSpace(request.Message)}}
	if len(request.Images) > 4 {
		return nil, errors.New("attach at most four images")
	}
	m.mu.Lock()
	supported := m.imagePrompts
	m.mu.Unlock()
	if len(request.Images) > 0 && !supported {
		return nil, errors.New("this agent does not support images through ACP; use an image-capable agent")
	}
	total := 0
	for _, attachment := range request.Images {
		if len(attachment.Data) > 6*1024*1024 {
			return nil, errors.New("image exceeds the 4 MiB limit")
		}
		data, err := base64.StdEncoding.DecodeString(attachment.Data)
		if err != nil || len(data) == 0 || len(data) > 4*1024*1024 {
			return nil, errors.New("invalid or oversized image attachment")
		}
		mime := http.DetectContentType(data)
		if mime != "image/png" && mime != "image/jpeg" && mime != "image/gif" && mime != "image/webp" || mime != attachment.MimeType {
			return nil, fmt.Errorf("unsupported image format for %s", attachment.Name)
		}
		total += len(data)
		if total > 8*1024*1024 {
			return nil, errors.New("images exceed the 8 MiB total limit")
		}
		blocks = append(blocks, map[string]string{"type": "image", "mimeType": mime, "data": attachment.Data})
	}
	return blocks, nil
}
