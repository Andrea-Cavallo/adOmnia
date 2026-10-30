package milk

import (
	"encoding/json/v2"
	"time"
)

// State è lo stato dell'integrazione mostrato nella status bar.
type State string

const (
	StateDisabled     State = "disabled"
	StateNotInstalled State = "not-installed"
	StateStarting     State = "starting"
	StateReady        State = "ready"
	StateError        State = "error"
	// StateOutdated: il milk trovato non ha ancora `serve --acp`.
	StateOutdated State = "outdated"
	// StateInstalling: adOmnia sta scaricando una release di milk.
	StateInstalling State = "installing"
)

// Status è lo stato pubblicato al frontend.
type Capabilities struct {
	ProtocolVersion int  `json:"protocolVersion"`
	LoadSession     bool `json:"loadSession"`
	ResumeSession   bool `json:"resumeSession"`
	CloseSession    bool `json:"closeSession"`
	PromptImages    bool `json:"promptImages"`
	ReadTextFile    bool `json:"readTextFile"`
}

type Status struct {
	State        State        `json:"state"`
	Message      string       `json:"message,omitempty"`
	Binary       string       `json:"binary,omitempty"`
	Version      string       `json:"version,omitempty"`
	Running      bool         `json:"running"`
	Restarts     int          `json:"restarts"`
	ActiveAgent  string       `json:"activeAgent,omitempty"`
	Capabilities Capabilities `json:"capabilities"`
	// Backend è chi serve i turni secondo l'agente (Claude Code: "AWS Bedrock", "Claude Pro"…).
	Backend string `json:"backend,omitempty"`
	// Model è il modello dell'ultima sessione aperta.
	Model string `json:"model,omitempty"`
}

// PromptRequest descrive un turno di chat milk. Token è generato dal frontend e
// collega progress/cancel; Root è la cartella del progetto attivo.
type PromptRequest struct {
	Token      string            `json:"token"`
	Root       string            `json:"root,omitempty"`
	SessionKey string            `json:"sessionKey,omitempty"`
	Message    string            `json:"message"`
	Images     []ImageAttachment `json:"images,omitempty"`
	// TimeLimit, se impostato, sostituisce il timeout del turno configurato:
	// i task hanno un proprio limite esplicito e non devono essere tagliati
	// dal timeout globale della chat.
	TimeLimit time.Duration `json:"-"`
}

type ImageAttachment struct {
	Name     string `json:"name"`
	MimeType string `json:"mimeType"`
	Data     string `json:"data"`
}

// SessionControl mirrors the selectable ACP session options; model IDs come from the agent.
type ControlValue struct {
	Value   string         `json:"value,omitempty"`
	Name    string         `json:"name"`
	Options []ControlValue `json:"options,omitempty"`
}
type SessionControl struct {
	ID           string         `json:"id"`
	Name         string         `json:"name"`
	Category     string         `json:"category,omitempty"`
	Type         string         `json:"type"`
	CurrentValue any            `json:"currentValue"`
	Options      []ControlValue `json:"options,omitempty"`
}

// ACP v1 uses id; milk's v2 uses configId. The renderer sees one normalized key.
func (c *SessionControl) UnmarshalJSON(data []byte) error {
	type plain SessionControl
	var wire struct {
		*plain
		ConfigID string `json:"configId"`
	}
	wire.plain = (*plain)(c)
	if err := json.Unmarshal(data, &wire); err != nil {
		return err
	}
	if c.ID == "" {
		c.ID = wire.ConfigID
	}
	return nil
}

// Command è una slash command annunciata dall'agente (ACP
// available_commands_update): il client la completa, l'agente la esegue.
type Command struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Hint        string `json:"hint,omitempty"`
}

// CommandEvent pubblica le slash command di una sessione appena l'agente le annuncia.
type CommandEvent struct {
	Root      string    `json:"root"`
	SessionID string    `json:"sessionId"`
	Commands  []Command `json:"commands"`
}

// SessionControls raccoglie le opzioni di sessione offerte dall'agente.
// ImageMode dice come arrivano le immagini: "native" (ACP image block),
// "file" (riferimento @path, come fa la TUI di milk) o "none".
type SessionControls struct {
	Root      string           `json:"root"`
	Controls  []SessionControl `json:"controls"`
	Commands  []Command        `json:"commands,omitempty"`
	Images    bool             `json:"images"`
	ImageMode string           `json:"imageMode,omitempty"`
}

// PromptResponse conferma che il prompt è stato accettato.
type PromptResponse struct {
	Token     string `json:"token"`
	MessageID string `json:"messageId"`
}

// ToolUpdate è un tool call osservato durante il turno.
type ToolUpdate struct {
	ToolCallID string `json:"toolCallId"`
	Name       string `json:"name"`
	Status     string `json:"status"` // pending | in_progress | completed | failed | cancelled
	RawOutput  string `json:"rawOutput,omitempty"`
}

// RouteInfo descrive la decisione di routing di milk.
type RouteInfo struct {
	Agent  string `json:"agent"`
	Target string `json:"target"`
	Reason string `json:"reason"`
}

// ChatEvent è un delta streaming già normalizzato per il renderer.
type ChatEvent struct {
	Token      string      `json:"token"`
	Root       string      `json:"root"`
	SessionID  string      `json:"sessionId,omitempty"`
	SessionKey string      `json:"sessionKey,omitempty"`
	Kind       string      `json:"kind"` // begin | text | thought | tool | end | route | warning | error
	Reply      string      `json:"reply,omitempty"`
	Tool       *ToolUpdate `json:"tool,omitempty"`
	Route      *RouteInfo  `json:"route,omitempty"`
	Error      string      `json:"error,omitempty"`
	StopReason string      `json:"stopReason,omitempty"`
	Plan       []PlanEntry `json:"plan,omitempty"`
}

type PlanEntry struct {
	Content  string `json:"content"`
	Status   string `json:"status"`
	Priority string `json:"priority,omitempty"`
}

// PermissionOption è una scelta offerta da una richiesta di autorizzazione.
type PermissionOption struct {
	OptionID string `json:"optionId"`
	Name     string `json:"name,omitempty"`
	Kind     string `json:"kind,omitempty"`
}

// PermissionEvent chiede all'utente se approvare una tool call.
type PermissionEvent struct {
	RequestID   string             `json:"requestId"`
	SessionID   string             `json:"sessionId"`
	SessionKey  string             `json:"sessionKey,omitempty"`
	ToolCallID  string             `json:"toolCallId"`
	Title       string             `json:"title"`
	Description string             `json:"description"`
	Options     []PermissionOption `json:"options"`
}

// Session è una sessione ACP milk per una cartella di progetto.
type Session struct {
	SessionID string `json:"sessionId"`
	Root      string `json:"root"`
}
