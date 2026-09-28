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

// RunConfigurationKind elenca i perimetri di esecuzione supportati da una configurazione salvata.
type RunConfigurationKind string

const (
	RunKindPackage RunConfigurationKind = "package"
	RunKindFiles   RunConfigurationKind = "files"
	RunKindBuild   RunConfigurationKind = "build"
	RunKindBinary  RunConfigurationKind = "binary"
	RunKindTest    RunConfigurationKind = "test"
)

// EnvironmentEntry rappresenta una variabile d'ambiente di una configurazione Run.
// Le voci marcate Secret non persistono il valore: viene richiesto all'avvio e
// resta soltanto in memoria per la durata della sessione.
type EnvironmentEntry struct {
	Key    string `json:"key"`
	Value  string `json:"value,omitempty"`
	Secret bool   `json:"secret,omitempty"`
}

type RunConfiguration struct {
	ID               string               `json:"id"`
	SessionID        SessionID            `json:"sessionId"`
	Name             string               `json:"name"`
	Kind             RunConfigurationKind `json:"kind"`
	Target           string               `json:"target"`
	Files            []string             `json:"files,omitempty"`
	BinaryPath       string               `json:"binaryPath,omitempty"`
	WorkingDirectory string               `json:"workingDirectory"`
	GoArguments      []string             `json:"goArguments"`
	ProgramArguments []string             `json:"programArguments"`
	BuildTags        []string             `json:"buildTags"`
	Environment      []EnvironmentEntry   `json:"environment"`
	Order            int                  `json:"order"`
	CreatedAt        time.Time            `json:"createdAt"`
	UpdatedAt        time.Time            `json:"updatedAt"`
}

// RequiredSecrets elenca le chiavi il cui valore deve essere fornito a runtime.
func (c RunConfiguration) RequiredSecrets() []string {
	keys := make([]string, 0, len(c.Environment))
	for _, entry := range c.Environment {
		if entry.Secret {
			keys = append(keys, entry.Key)
		}
	}
	return keys
}

// SessionView è lo stato di interfaccia ripristinabile di una sessione: quali
// file erano aperti, quale era attivo e come era disposto il layout. Non
// contiene mai il contenuto dei file.
type SessionView struct {
	OpenPaths          []string `json:"openPaths,omitempty"`
	ActivePath         string   `json:"activePath,omitempty"`
	ActiveConfigID     string   `json:"activeConfigId,omitempty"`
	ProjectWidth       int      `json:"projectWidth,omitempty"`
	StructureWidth     int      `json:"structureWidth,omitempty"`
	BottomHeight       int      `json:"bottomHeight,omitempty"`
	StructureOpen      bool     `json:"structureOpen"`
	BottomOpen         bool     `json:"bottomOpen"`
	TerminalPanelOpen  bool     `json:"terminalPanelOpen"`
	ShowIgnoredEntries bool     `json:"showIgnoredEntries"`
}

// RecoveredBuffer è un buffer non salvato ritrovato dopo un riavvio: viene
// proposto all'utente come recupero esplicito, mai riapplicato da solo.
type RecoveredBuffer struct {
	SessionID    SessionID `json:"sessionId"`
	RelativePath string    `json:"relativePath"`
	Content      string    `json:"content"`
	SavedAt      time.Time `json:"savedAt"`
	DiskChanged  bool      `json:"diskChanged"`
	Missing      bool      `json:"missing"`
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
	SessionID SessionID `json:"sessionId"`
	Kind      string    `json:"kind"`
	Target    string    `json:"target"`
	// ExtraTargets contiene i target aggiuntivi di una configurazione a lista
	// di file: vengono accodati subito dopo Target, prima degli argomenti del
	// programma, per rispettare l'ordine richiesto da `go run`.
	ExtraTargets []string `json:"extraTargets,omitempty"`
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
