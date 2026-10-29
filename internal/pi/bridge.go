package pi

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/aipolicy"
	"github.com/Andrea-Cavallo/adOmnia/internal/copilot"
	"github.com/Andrea-Cavallo/adOmnia/internal/milk"
	"github.com/Andrea-Cavallo/adOmnia/internal/procutil"
)

type rpcReply struct {
	ID      string            `json:"id"`
	Type    string            `json:"type"`
	Success bool              `json:"success"`
	Error   string            `json:"error"`
	Data    jsonv1.RawMessage `json:"data"`
}
type bridge struct {
	conn      *milk.Conn
	command   []string
	extension string
	mu        sync.Mutex
	sessions  map[string]*piSession
	closed    bool
}
type piSession struct {
	id, root              string
	owner                 *bridge
	cmd                   *exec.Cmd
	stdin                 io.WriteCloser
	done                  chan struct{}
	writeMu, mu, promptMu sync.Mutex
	sequence              atomic.Uint64
	pending               map[string]chan rpcReply
	settled               chan error
	turnError             error
}

// RunBridge is dispatched before Wails or storage initialization in the child process.
func RunBridge(commandJSON string, input io.Reader, output io.Writer) error {
	var command []string
	if json.Unmarshal([]byte(commandJSON), &command) != nil || len(command) == 0 {
		return errors.New("invalid Pi launch command")
	}
	directory, err := os.MkdirTemp("", "adomnia-pi-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(directory)
	extension := filepath.Join(directory, "adomnia-permissions.ts")
	if err := os.WriteFile(extension, permissionExtension, 0o600); err != nil {
		return err
	}
	b := &bridge{command: command, extension: extension, sessions: map[string]*piSession{}}
	b.conn = milk.NewConn(input, output, b)
	defer b.close()
	b.conn.Run()
	return nil
}

func (b *bridge) close() {
	b.mu.Lock()
	sessions := b.sessions
	b.closed = true
	b.sessions = map[string]*piSession{}
	b.mu.Unlock()
	for _, s := range sessions {
		s.close()
	}
}
func (s *piSession) close() {
	_ = s.stdin.Close()
	select {
	case <-s.done:
	case <-time.After(time.Second):
		_ = procutil.KillTree(s.cmd)
	}
}
func (s *piSession) write(value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	_, err = s.stdin.Write(append(data, '\n'))
	return err
}
func (s *piSession) call(ctx context.Context, kind string, params map[string]any) (jsonv1.RawMessage, error) {
	id := fmt.Sprintf("pi-%d", s.sequence.Add(1))
	if params == nil {
		params = map[string]any{}
	}
	params["type"] = kind
	params["id"] = id
	response := make(chan rpcReply, 1)
	s.mu.Lock()
	s.pending[id] = response
	s.mu.Unlock()
	defer func() { s.mu.Lock(); delete(s.pending, id); s.mu.Unlock() }()
	if err := s.write(params); err != nil {
		return nil, err
	}
	select {
	case value := <-response:
		if !value.Success {
			return nil, fmt.Errorf("Pi %s: %s", kind, value.Error)
		}
		return value.Data, nil
	case <-s.done:
		return nil, errors.New("Pi exited; restart it from Pi settings")
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (b *bridge) newSession(ctx context.Context, root string) (*piSession, error) {
	if !filepath.IsAbs(root) || !aipolicy.Allows(aipolicy.Load(root), false) {
		return nil, errors.New("Pi requires an open project that permits this provider")
	}
	resolved, err := filepath.EvalSymlinks(root)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, 16)
	if _, err = rand.Read(nonce); err != nil {
		return nil, err
	}
	id := hex.EncodeToString(nonce)
	args := append(append([]string{}, b.command[1:]...), "--mode", "rpc", "--no-session", "--no-extensions", "--extension", b.extension)
	cmd := procutil.Command(b.command[0], args...)
	procutil.ConfigureChild(cmd)
	cmd.Dir = resolved
	cmd.Stderr = os.Stderr
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		_ = stdin.Close()
		return nil, err
	}
	s := &piSession{id: id, root: resolved, owner: b, cmd: cmd, stdin: stdin, done: make(chan struct{}), pending: map[string]chan rpcReply{}}
	b.mu.Lock()
	if b.closed || len(b.sessions) >= 16 {
		b.mu.Unlock()
		_ = stdin.Close()
		return nil, errors.New("Pi bridge closed or session limit reached")
	}
	if err = cmd.Start(); err != nil {
		b.mu.Unlock()
		_ = stdin.Close()
		return nil, err
	}
	b.sessions[id] = s
	b.mu.Unlock()
	go s.read(stdout)
	if _, err = s.call(ctx, "get_state", nil); err != nil {
		s.close()
		b.mu.Lock()
		delete(b.sessions, id)
		b.mu.Unlock()
		return nil, err
	}
	return s, nil
}

func (s *piSession) read(stdout io.Reader) {
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 64*1024), 32*1024*1024)
	for scanner.Scan() {
		line := append([]byte(nil), scanner.Bytes()...)
		var reply rpcReply
		if json.Unmarshal(line, &reply) != nil {
			continue
		}
		if reply.Type == "response" {
			s.mu.Lock()
			channel := s.pending[reply.ID]
			s.mu.Unlock()
			if channel != nil {
				select {
				case channel <- reply:
				default:
				}
			}
			continue
		}
		s.event(reply.Type, line)
	}
	if scanner.Err() != nil {
		_ = procutil.KillTree(s.cmd)
	}
	_ = s.cmd.Wait()
	close(s.done)
}
func (s *piSession) update(value any) {
	_ = s.owner.conn.Notify("session/update", map[string]any{"sessionId": s.id, "update": value})
}
func (s *piSession) text(kind, text string) {
	if text != "" {
		s.update(map[string]any{"sessionUpdate": kind, "content": map[string]string{"type": "text", "text": text}})
	}
}
func (s *piSession) event(kind string, data []byte) {
	switch kind {
	case "message_update":
		var event struct {
			Delta struct {
				Type  string `json:"type"`
				Delta string `json:"delta"`
			} `json:"assistantMessageEvent"`
		}
		if json.Unmarshal(data, &event) != nil {
			return
		}
		if event.Delta.Type == "text_delta" {
			s.text("agent_message_chunk", event.Delta.Delta)
		} else if event.Delta.Type == "thinking_delta" {
			s.text("agent_thought_chunk", event.Delta.Delta)
		}
	case "message_end":
		var event struct {
			Message struct {
				StopReason   string `json:"stopReason"`
				ErrorMessage string `json:"errorMessage"`
			} `json:"message"`
		}
		_ = json.Unmarshal(data, &event)
		if event.Message.StopReason == "error" {
			s.mu.Lock()
			s.turnError = errors.New(event.Message.ErrorMessage)
			s.mu.Unlock()
		}
	case "agent_settled":
		var event struct {
			Aborted bool `json:"aborted"`
		}
		_ = json.Unmarshal(data, &event)
		s.mu.Lock()
		channel, err := s.settled, s.turnError
		s.mu.Unlock()
		if event.Aborted && err == nil {
			err = context.Canceled
		}
		if channel != nil {
			select {
			case channel <- err:
			default:
			}
		}
	case "tool_execution_start", "tool_execution_update", "tool_execution_end":
		var event struct {
			ID      string `json:"toolCallId"`
			Name    string `json:"toolName"`
			Args    any    `json:"args"`
			Result  any    `json:"result"`
			Partial any    `json:"partialResult"`
			IsError bool   `json:"isError"`
		}
		if json.Unmarshal(data, &event) != nil {
			return
		}
		status := "in_progress"
		if kind == "tool_execution_end" {
			status = "completed"
			if event.IsError {
				status = "failed"
			}
		}
		output := event.Result
		if output == nil {
			output = event.Partial
		}
		if output == nil {
			output = event.Args
		}
		s.update(map[string]any{"sessionUpdate": "tool_call_update", "toolCallId": event.ID, "title": event.Name, "status": status, "rawOutput": output})
	case "extension_ui_request":
		go s.ui(data)
	case "auto_retry_start", "auto_compaction_start":
		s.text("agent_thought_chunk", "\nPi is retrying or compacting the conversation…\n")
	case "extension_error":
		var event struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(data, &event)
		s.mu.Lock()
		s.turnError = fmt.Errorf("Pi extension: %s", event.Error)
		s.mu.Unlock()
	}
}

func (s *piSession) ui(data []byte) {
	var request struct {
		ID      string `json:"id"`
		Method  string `json:"method"`
		Title   string `json:"title"`
		Message string `json:"message"`
	}
	if json.Unmarshal(data, &request) != nil {
		return
	}
	response := map[string]any{"type": "extension_ui_response", "id": request.ID, "cancelled": true}
	if request.Method == "confirm" && request.Title == "adOmnia tool permission" {
		var tool struct {
			Tool  string         `json:"tool"`
			Input map[string]any `json:"input"`
		}
		_ = json.Unmarshal([]byte(request.Message), &tool)
		allowed := aipolicy.Allows(aipolicy.Load(s.root), false)
		if path, ok := tool.Input["path"].(string); ok {
			allowed = allowed && allowedPath(s.root, path)
		}
		if allowed {
			ctx, cancel := context.WithTimeout(context.Background(), 85*time.Second)
			defer cancel()
			var answer struct {
				Outcome struct {
					OptionID string `json:"optionId"`
				} `json:"outcome"`
			}
			err := s.owner.conn.Call(ctx, "session/request_permission", map[string]any{"sessionId": s.id, "title": "Pi · " + tool.Tool, "description": request.Message, "toolCall": map[string]string{"toolCallId": request.ID, "title": tool.Tool}, "options": []map[string]string{{"optionId": "allow", "kind": "allow_once", "name": "Allow"}, {"optionId": "deny", "kind": "reject_once", "name": "Deny"}}}, &answer)
			allowed = err == nil && answer.Outcome.OptionID == "allow"
		}
		response = map[string]any{"type": "extension_ui_response", "id": request.ID, "confirmed": allowed}
	} else {
		s.text("agent_thought_chunk", "\nPi requested unsupported UI: "+request.Method+". The interaction was cancelled.\n")
	}
	_ = s.write(response)
}

func allowedPath(root, path string) bool {
	candidate := path
	if !filepath.IsAbs(candidate) {
		candidate = filepath.Join(root, candidate)
	}
	candidate = filepath.Clean(candidate)
	// New files must also remain inside the real project through their existing parent.
	real, err := filepath.EvalSymlinks(candidate)
	if err != nil {
		parent, parentErr := filepath.EvalSymlinks(filepath.Dir(candidate))
		if parentErr != nil {
			return false
		}
		real = filepath.Join(parent, filepath.Base(candidate))
	}
	relative, err := filepath.Rel(root, real)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) && !copilot.LoadContextFilterFor(root, false).Excluded(filepath.ToSlash(relative))
}

func (b *bridge) HandleNotification(method string, params jsonv1.RawMessage) {
	if method != "session/cancel" {
		return
	}
	var input struct {
		SessionID string `json:"sessionId"`
	}
	_ = json.Unmarshal(params, &input)
	b.mu.Lock()
	s := b.sessions[input.SessionID]
	b.mu.Unlock()
	if s != nil {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			_, _ = s.call(ctx, "clear_queue", nil)
			if _, err := s.call(ctx, "abort", nil); err != nil {
				s.close()
			}
		}()
	}
}

func (b *bridge) HandleRequest(ctx context.Context, method string, params jsonv1.RawMessage) (any, error) {
	if method == "initialize" {
		return map[string]any{"protocolVersion": 1, "agentInfo": map[string]string{"name": "Pi (adOmnia RPC bridge)", "version": "1.4.0"}, "agentCapabilities": map[string]any{"promptCapabilities": map[string]bool{"image": true}, "sessionCapabilities": map[string]bool{"close": true}}}, nil
	}
	var input struct {
		SessionID string `json:"sessionId"`
		Cwd       string `json:"cwd"`
		ModelID   string `json:"modelId"`
		ConfigID  string `json:"configId"`
		Value     string `json:"value"`
		Prompt    []struct {
			Type     string `json:"type"`
			Text     string `json:"text"`
			MimeType string `json:"mimeType"`
			Data     string `json:"data"`
		} `json:"prompt"`
	}
	if err := json.Unmarshal(params, &input); err != nil {
		return nil, err
	}
	if method == "session/new" {
		s, err := b.newSession(ctx, input.Cwd)
		if err != nil {
			return nil, err
		}
		options, err := s.controls(ctx)
		if err != nil {
			s.close()
			b.mu.Lock()
			delete(b.sessions, s.id)
			b.mu.Unlock()
			return nil, err
		}
		return map[string]any{"sessionId": s.id, "configOptions": options}, nil
	}
	b.mu.Lock()
	s := b.sessions[input.SessionID]
	b.mu.Unlock()
	if s == nil {
		return nil, errors.New("Pi session is no longer available")
	}
	switch method {
	case "session/close":
		b.mu.Lock()
		delete(b.sessions, s.id)
		b.mu.Unlock()
		s.close()
		return map[string]any{}, nil
	case "session/set_config_option", "session/set_model":
		value := input.Value
		if method == "session/set_model" {
			value = input.ModelID
			input.ConfigID = "model"
		}
		if input.ConfigID == "model" {
			provider, model, ok := strings.Cut(value, "/")
			if !ok {
				return nil, errors.New("Pi model must include provider/id")
			}
			if _, err := s.call(ctx, "set_model", map[string]any{"provider": provider, "modelId": model}); err != nil {
				return nil, err
			}
		} else if input.ConfigID == "thinking" {
			if _, err := s.call(ctx, "set_thinking_level", map[string]any{"level": value}); err != nil {
				return nil, err
			}
		} else {
			return nil, errors.New("unknown Pi session control")
		}
		options, err := s.controls(ctx)
		return map[string]any{"configOptions": options}, err
	case "session/prompt":
		s.promptMu.Lock()
		defer s.promptMu.Unlock()
		if !aipolicy.Allows(aipolicy.Load(s.root), false) {
			return nil, errors.New("project AI policy blocks Pi")
		}
		var text []string
		var images []map[string]string
		for _, block := range input.Prompt {
			if block.Type == "text" {
				text = append(text, block.Text)
			} else if block.Type == "image" {
				images = append(images, map[string]string{"type": "image", "mimeType": block.MimeType, "data": block.Data})
			} else {
				return nil, fmt.Errorf("Pi does not support prompt block %s", block.Type)
			}
		}
		if len(images) > 0 {
			state, err := s.state(ctx)
			if err != nil {
				return nil, err
			}
			supported := false
			for _, kind := range state.Model.Input {
				supported = supported || kind == "image"
			}
			if !supported {
				return nil, errors.New("the selected Pi model does not accept images; choose a vision model")
			}
		}
		settled := make(chan error, 1)
		s.mu.Lock()
		s.settled = settled
		s.turnError = nil
		s.mu.Unlock()
		defer func() { s.mu.Lock(); s.settled = nil; s.mu.Unlock() }()
		accepted, err := s.call(ctx, "prompt", map[string]any{"message": strings.Join(text, "\n\n"), "images": images})
		if err != nil {
			return nil, err
		}
		var disposition struct {
			Disposition string `json:"disposition"`
		}
		_ = json.Unmarshal(accepted, &disposition)
		if disposition.Disposition == "handled" {
			return map[string]string{"stopReason": "end_turn"}, nil
		}
		select {
		case err := <-settled:
			if errors.Is(err, context.Canceled) {
				return map[string]string{"stopReason": "cancelled"}, nil
			}
			return map[string]string{"stopReason": "end_turn"}, err
		case <-s.done:
			return nil, errors.New("Pi exited during the turn")
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	return nil, milk.ErrMethodNotFound
}

type model struct {
	ID       string   `json:"id"`
	Provider string   `json:"provider"`
	Name     string   `json:"name"`
	Input    []string `json:"input"`
}
type sessionState struct {
	Model    model  `json:"model"`
	Thinking string `json:"thinkingLevel"`
}

func (s *piSession) state(ctx context.Context) (sessionState, error) {
	raw, err := s.call(ctx, "get_state", nil)
	var state sessionState
	if err == nil {
		err = json.Unmarshal(raw, &state)
	}
	return state, err
}
func (s *piSession) controls(ctx context.Context) ([]milk.SessionControl, error) {
	state, err := s.state(ctx)
	if err != nil {
		return nil, err
	}
	raw, err := s.call(ctx, "get_available_models", nil)
	if err != nil {
		return nil, err
	}
	var data struct {
		Models []model `json:"models"`
	}
	if err = json.Unmarshal(raw, &data); err != nil {
		return nil, err
	}
	modelControl := milk.SessionControl{ID: "model", Name: "Model", Category: "model", Type: "select", CurrentValue: state.Model.Provider + "/" + state.Model.ID}
	for _, model := range data.Models {
		modelControl.Options = append(modelControl.Options, milk.ControlValue{Value: model.Provider + "/" + model.ID, Name: model.Provider + " · " + model.Name})
	}
	controls := []milk.SessionControl{}
	if len(modelControl.Options) > 0 {
		controls = append(controls, modelControl)
	}
	if raw, err = s.call(ctx, "get_available_thinking_levels", nil); err == nil {
		var levels struct {
			Levels []string `json:"levels"`
		}
		if json.Unmarshal(raw, &levels) == nil && len(levels.Levels) > 1 {
			control := milk.SessionControl{ID: "thinking", Name: "Thinking", Category: "thought_level", Type: "select", CurrentValue: state.Thinking}
			for _, level := range levels.Levels {
				control.Options = append(control.Options, milk.ControlValue{Value: level, Name: level})
			}
			controls = append(controls, control)
		}
	}
	return controls, nil
}
