package milk

// State è lo stato dell'integrazione mostrato nella status bar.
type State string

const (
	StateDisabled     State = "disabled"
	StateNotInstalled State = "not-installed"
	StateStarting     State = "starting"
	StateReady        State = "ready"
	StateError        State = "error"
)

// Status è lo stato pubblicato al frontend.
type Status struct {
	State       State  `json:"state"`
	Message     string `json:"message,omitempty"`
	Binary      string `json:"binary,omitempty"`
	Version     string `json:"version,omitempty"`
	Running     bool   `json:"running"`
	Restarts    int    `json:"restarts"`
	ActiveAgent string `json:"activeAgent,omitempty"`
}

// PromptRequest descrive un turno di chat milk. Token è generato dal frontend e
// collega progress/cancel; Root è la cartella del progetto attivo.
type PromptRequest struct {
	Token   string `json:"token"`
	Root    string `json:"root,omitempty"`
	Message string `json:"message"`
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
	Kind       string      `json:"kind"` // begin | text | thought | tool | end | route | warning | error
	Reply      string      `json:"reply,omitempty"`
	Tool       *ToolUpdate `json:"tool,omitempty"`
	Route      *RouteInfo  `json:"route,omitempty"`
	Error      string      `json:"error,omitempty"`
	StopReason string      `json:"stopReason,omitempty"`
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
