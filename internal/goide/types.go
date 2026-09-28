package goide

import "time"

type SessionID string
type DocumentID string
type RunID string
type TerminalID string
type LSPRequestID string
type DebugSessionID string

type AuthorizationState string

const (
	AuthorizationOpened    AuthorizationState = "opened"
	AuthorizationPermitted AuthorizationState = "tooling-permitted"
)

type GoModule struct {
	Path       string `json:"path"`
	ModulePath string `json:"modulePath,omitempty"`
}

type RecentProject struct {
	Name      string    `json:"name"`
	RootPath  string    `json:"rootPath"`
	RealPath  string    `json:"realPath"`
	Available bool      `json:"available"`
	OpenedAt  time.Time `json:"openedAt"`
}

type Project struct {
	ID            string             `json:"id"`
	Name          string             `json:"name"`
	RootPath      string             `json:"rootPath"`
	RealPath      string             `json:"realPath"`
	GoModPath     string             `json:"goModPath,omitempty"`
	GoWorkPath    string             `json:"goWorkPath,omitempty"`
	Modules       []GoModule         `json:"modules"`
	LooseGoDirs   []string           `json:"looseGoDirs,omitempty"`
	Authorization AuthorizationState `json:"authorization"`
}

type Session struct {
	ID        SessionID `json:"id"`
	Project   Project   `json:"project"`
	OpenedAt  time.Time `json:"openedAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type Document struct {
	ID           DocumentID `json:"id"`
	SessionID    SessionID  `json:"sessionId"`
	URI          string     `json:"uri"`
	Path         string     `json:"path"`
	RelativePath string     `json:"relativePath"`
	Name         string     `json:"name"`
	Language     string     `json:"language"`
	Version      int        `json:"version"`
	Dirty        bool       `json:"dirty"`
	ReadOnly     bool       `json:"readOnly,omitempty"`
	External     bool       `json:"external,omitempty"`
}

type OpenDocument struct {
	Document   Document  `json:"document"`
	Content    string    `json:"content"`
	DiskToken  string    `json:"diskToken"`
	ModifiedAt time.Time `json:"modifiedAt"`
}

type DocumentDiskState struct {
	DocumentID DocumentID `json:"documentId"`
	Changed    bool       `json:"changed"`
	Content    string     `json:"content,omitempty"`
	DiskToken  string     `json:"diskToken"`
	ModifiedAt time.Time  `json:"modifiedAt"`
}

type FileEntry struct {
	Name         string    `json:"name"`
	RelativePath string    `json:"relativePath"`
	Directory    bool      `json:"directory"`
	Ignored      bool      `json:"ignored,omitempty"`
	Size         int64     `json:"size,omitempty"`
	ModifiedAt   time.Time `json:"modifiedAt"`
	Language     string    `json:"language,omitempty"`
}

type QuickOpenResult struct {
	Name         string `json:"name"`
	RelativePath string `json:"relativePath"`
	Language     string `json:"language"`
}

type RunConfiguration struct {
	ID               string            `json:"id"`
	SessionID        SessionID         `json:"sessionId"`
	Name             string            `json:"name"`
	Target           string            `json:"target"`
	WorkingDirectory string            `json:"workingDirectory"`
	GoArguments      []string          `json:"goArguments"`
	ProgramArguments []string          `json:"programArguments"`
	BuildTags        []string          `json:"buildTags"`
	Environment      map[string]string `json:"environment"`
}

type Execution struct {
	ID               RunID      `json:"id"`
	SessionID        SessionID  `json:"sessionId"`
	Kind             string     `json:"kind"`
	Status           string     `json:"status"`
	Command          string     `json:"command"`
	WorkingDirectory string     `json:"workingDirectory"`
	PID              int        `json:"pid,omitempty"`
	StartedAt        time.Time  `json:"startedAt"`
	FinishedAt       *time.Time `json:"finishedAt,omitempty"`
	ExitCode         *int       `json:"exitCode,omitempty"`
	DurationMillis   int64      `json:"durationMillis"`
	Error            string     `json:"error,omitempty"`
}

type RunRequest struct {
	SessionID        SessionID         `json:"sessionId"`
	Kind             string            `json:"kind"`
	Target           string            `json:"target"`
	WorkingDirectory string            `json:"workingDirectory"`
	GoArguments      []string          `json:"goArguments"`
	ProgramArguments []string          `json:"programArguments"`
	BuildTags        []string          `json:"buildTags"`
	Environment      map[string]string `json:"environment"`
}

type ProcessOutput struct {
	RunID     RunID  `json:"runId"`
	Stream    string `json:"stream"`
	Text      string `json:"text"`
	Truncated bool   `json:"truncated,omitempty"`
}

type CreateProjectRequest struct {
	ParentPath string `json:"parentPath"`
	Name       string `json:"name"`
	ModulePath string `json:"modulePath"`
	Confirmed  bool   `json:"confirmed"`
}

type EventEnvelope struct {
	Version    int       `json:"version"`
	Type       string    `json:"type"`
	SessionID  SessionID `json:"sessionId,omitempty"`
	ResourceID string    `json:"resourceId,omitempty"`
	Sequence   uint64    `json:"sequence"`
	Timestamp  time.Time `json:"timestamp"`
	Payload    any       `json:"payload,omitempty"`
}

type Capabilities struct {
	SchemaVersion    int  `json:"schemaVersion"`
	ProjectOpen      bool `json:"projectOpen"`
	ProjectCreate    bool `json:"projectCreate"`
	Documents        bool `json:"documents"`
	Toolchain        bool `json:"toolchain"`
	Processes        bool `json:"processes"`
	LSP              bool `json:"lsp"`
	Terminal         bool `json:"terminal"`
	Debug            bool `json:"debug"`
	Tests            bool `json:"tests"`
	MultipleSessions bool `json:"multipleSessions"`
	SeparateWindows  bool `json:"separateWindows"`
}
