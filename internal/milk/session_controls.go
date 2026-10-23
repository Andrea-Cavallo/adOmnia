package milk

import (
	"adomnia/internal/aipolicy"
	"adomnia/internal/airedact"
	"adomnia/internal/jsonutil"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json/v2"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
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
	data, _ := jsonutil.Marshal(m.controls[root])
	imageMode := "file"
	if m.imagePrompts {
		imageMode = "native"
	}
	commands := append([]Command(nil), m.commands[root]...)
	result := SessionControls{Root: root, Images: true, ImageMode: imageMode, Commands: commands, Controls: []SessionControl{}}
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
		changed, err := selectConfiguredAgent(value.(string))
		if err != nil {
			return SessionControls{}, err
		}
		if changed {
			// milk rilegge quale agente è primario/escalation solo in modo inaffidabile
			// (il config reload non riallinea i runner) e poi riscrive ~/.milk/config.json
			// dalla sua vista in memoria: senza riavvio il turno finisce all'agente di prima
			// e la scelta "torna indietro" da sola. Il riavvio allinea processo e file.
			if err := m.Restart(); err != nil {
				return SessionControls{}, err
			}
		}
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
	for _, agent := range agentStatuses(config) {
		label := agent.Name
		if agent.Model != "" {
			label += " · " + agent.Model
		}
		if !agent.Usable {
			label += " · key missing"
		}
		control.Options = append(control.Options, ControlValue{Value: agent.Name, Name: label})
	}
	return control, nil
}

// selectConfiguredAgent scrive l'agente primario nel config globale di milk e
// dice se il valore è cambiato davvero.
func selectConfiguredAgent(name string) (bool, error) {
	path, err := ConfigPath()
	if err != nil {
		return false, err
	}
	config, err := readConfig(path)
	if err != nil {
		return false, err
	}
	if !agentNames(config)[name] {
		return false, errors.New("milk agent is no longer configured")
	}
	for _, status := range agentStatuses(config) {
		if status.Name == name && !status.Usable {
			return false, fmt.Errorf("%s: it would fail every turn. Set the variable and restart adOmnia, or choose another agent", missingKeyMessage(status))
		}
	}
	if current, _ := config["agent"].(string); current == name {
		return false, nil
	}
	config["agent"] = name
	return true, writeConfig(path, config)
}

// RedactPromptText is the single prompt boundary shared by milk, Claude Code and
// OpenCode: the agent sees masked secrets, never the original values.
func RedactPromptText(text string) string {
	return airedact.Redact(strings.TrimSpace(text))
}

// promptBlocks traduce il turno in content block ACP. Le immagini usano il blocco
// nativo `image` quando l'agente lo annuncia; altrimenti vengono scritte in una
// cartella temporanea e referenziate con `@path`, esattamente come fa la TUI di
// milk per l'agente CLI (che legge `@path` nativamente). Il secondo valore è la
// pulizia da eseguire a fine turno.
func (m *Manager) promptBlocks(request PromptRequest) ([]map[string]string, func(), error) {
	blocks := []map[string]string{{"type": "text", "text": RedactPromptText(request.Message)}}
	noop := func() {}
	if len(request.Images) > 4 {
		return nil, noop, errors.New("attach at most four images")
	}
	m.mu.Lock()
	supported := m.imagePrompts
	m.mu.Unlock()
	total := 0
	var files []string
	cleanup := func() {
		for _, path := range files {
			_ = os.Remove(path)
		}
	}
	fail := func(err error) ([]map[string]string, func(), error) {
		cleanup()
		return nil, noop, err
	}
	for _, attachment := range request.Images {
		if len(attachment.Data) > 6*1024*1024 {
			return fail(errors.New("image exceeds the 4 MiB limit"))
		}
		data, err := base64.StdEncoding.DecodeString(attachment.Data)
		if err != nil || len(data) == 0 || len(data) > 4*1024*1024 {
			return fail(errors.New("invalid or oversized image attachment"))
		}
		mime := http.DetectContentType(data)
		if mime != "image/png" && mime != "image/jpeg" && mime != "image/gif" && mime != "image/webp" || mime != attachment.MimeType {
			return fail(fmt.Errorf("unsupported image format for %s", attachment.Name))
		}
		total += len(data)
		if total > 8*1024*1024 {
			return fail(errors.New("images exceed the 8 MiB total limit"))
		}
		if supported {
			blocks = append(blocks, map[string]string{"type": "image", "mimeType": mime, "data": attachment.Data})
			continue
		}
		path, err := writeImageAttachment(attachment, mime, data)
		if err != nil {
			return fail(err)
		}
		files = append(files, path)
	}
	if len(files) > 0 {
		// @path è la convenzione che milk usa verso l'agente CLI: il file resta
		// leggibile per tutta la durata del turno e viene rimosso alla fine.
		blocks[0]["text"] = strings.Join(prefixPaths(files), "\n") + "\n" + blocks[0]["text"]
	}
	return blocks, cleanup, nil
}

func prefixPaths(files []string) []string {
	out := make([]string, 0, len(files))
	for _, path := range files {
		out = append(out, "@"+path)
	}
	return out
}

func writeImageAttachment(attachment ImageAttachment, mime string, data []byte) (string, error) {
	directory := filepath.Join(os.TempDir(), "adomnia-milk-images")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return "", fmt.Errorf("cannot prepare the image attachment folder: %w", err)
	}
	// Anche se la cartella arriva da una versione precedente: permessi restrittivi sempre.
	if err := os.Chmod(directory, 0o700); err != nil {
		return "", fmt.Errorf("cannot prepare the image attachment folder: %w", err)
	}
	sum := sha256.Sum256(data)
	name := hex.EncodeToString(sum[:8]) + "-" + safeAttachmentName(attachment.Name) + extensionForMIME(mime)
	path := filepath.Join(directory, name) // NOSONAR -- the name is content-addressed (sha256 prefix) plus a sanitized name; the folder is 0700 and the file 0600, and the file exists only to be passed to the milk CLI
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return "", fmt.Errorf("cannot write %s: %w", attachment.Name, err)
	}
	return path, nil
}

// safeAttachmentName tiene solo i caratteri utili di un nome scelto dall'utente.
func safeAttachmentName(name string) string {
	clean := strings.Map(func(char rune) rune {
		switch {
		case char >= 'a' && char <= 'z', char >= 'A' && char <= 'Z', char >= '0' && char <= '9':
			return char
		case char == '.' || char == '-' || char == '_':
			return char
		}
		return '-'
	}, name)
	clean = strings.Trim(clean, ".-")
	if clean == "" {
		return "image"
	}
	if len(clean) > 60 {
		clean = clean[:60]
	}
	return clean
}

func extensionForMIME(mime string) string {
	switch mime {
	case "image/png":
		return ".png"
	case "image/jpeg":
		return ".jpg"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	}
	return ""
}
