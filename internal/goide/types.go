package goide

import (
	"time"

	"adomnia/internal/ide/project"
)

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
	// Units sono le unità di build rilevate dai language adapter (multi-linguaggio);
	// i campi Go qui sopra ne sono derivati finché il frontend li legge.
	Units []project.Unit `json:"units"`
}

type Session struct {
	ID      SessionID `json:"id"`
	Project Project   `json:"project"`
	// WorkspaceID è il workspace Go Studio che contiene la sessione, indipendente dai workspace API di adOmnia.
	WorkspaceID string    `json:"workspaceId,omitempty"`
	OpenedAt    time.Time `json:"openedAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
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
	// MediaType è valorizzato per le immagini (image/png, image/jpeg…); Language è "image".
	MediaType string `json:"mediaType,omitempty"`
}

type OpenDocument struct {
	Document   Document  `json:"document"`
	Content    string    `json:"content"`
	DiskToken  string    `json:"diskToken"`
	ModifiedAt time.Time `json:"modifiedAt"`
	// DataURL è il contenuto base64 di un'immagine, per l'anteprima nell'editor.
	DataURL string `json:"dataUrl,omitempty"`
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
	// Make e Docker eseguono file del progetto (Makefile, Dockerfile) con i
	// rispettivi strumenti: Target è il percorso del file, relativo alla working directory.
	RunKindMake        RunConfigurationKind = "make"
	RunKindDockerBuild RunConfigurationKind = "docker-build"
	RunKindDockerRun   RunConfigurationKind = "docker-run"
	// RunKindDockerCompose: ProgramArguments è "up" o "down" seguito dai servizi (nessuno = tutti).
	RunKindDockerCompose RunConfigurationKind = "docker-compose"
	// RunKindCommand esegue un comando qualsiasi (Target) con ProgramArguments, senza shell.
	RunKindCommand RunConfigurationKind = "command"
	// RunKindGoTool esegue `go <Target> <ProgramArguments>` con la toolchain del progetto (vet, generate, tool pprof…).
	RunKindGoTool RunConfigurationKind = "go-tool"
	// RunKindCompound avvia insieme, in parallelo, le configurazioni elencate in Compound.
	RunKindCompound RunConfigurationKind = "compound"
)

// DockerOptions completa le configurazioni docker-build e docker-run. I build
// arg segreti, come le variabili d'ambiente segrete, non persistono il valore.
type DockerOptions struct {
	// Context è la cartella di build, relativa alla working directory ("." se vuoto).
	Context string `json:"context,omitempty"`
	// Tag dell'immagine; vuoto significa <nome progetto>:dev.
	Tag string `json:"tag,omitempty"`
	// Stage è lo stage multi-stage da costruire (--target).
	Stage     string             `json:"stage,omitempty"`
	BuildArgs []EnvironmentEntry `json:"buildArgs,omitempty"`
	NoCache   bool               `json:"noCache,omitempty"`
	// Ports nel formato di docker run -p: "8080", "8080:80", "127.0.0.1:8080:80/tcp".
	Ports []string `json:"ports,omitempty"`
	// Volumes nel formato "percorso/relativo:/percorso/container[:ro]", confinati al progetto.
	Volumes []string `json:"volumes,omitempty"`
}

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
	Docker           DockerOptions        `json:"docker"`
	// EnvFile è un file .env relativo alla working directory; le variabili esplicite vincono.
	EnvFile string `json:"envFile,omitempty"`
	GOOS    string `json:"goos,omitempty"`
	GOARCH  string `json:"goarch,omitempty"`
	Race    bool   `json:"race,omitempty"`
	// Coverage aggiunge -cover; per run e build i dati finiscono in .gocoverdata.
	Coverage bool `json:"coverage,omitempty"`
	// Profile vale solo per i test: cpu, mem, block, mutex o trace.
	Profile string `json:"profile,omitempty"`
	// DebugFlags sono build flag aggiuntivi per Delve, es. -gcflags=all=-N -l.
	DebugFlags []string `json:"debugFlags,omitempty"`
	// Port imposta PORT e viene verificata libera prima dell'avvio.
	Port int `json:"port,omitempty"`
	// PreRun e PostRun sono ID di altre configurazioni della sessione, eseguite in ordine.
	PreRun  []string `json:"preRun,omitempty"`
	PostRun []string `json:"postRun,omitempty"`
	// Compound: ID delle configurazioni avviate insieme (solo per il tipo compound).
	Compound []string `json:"compound,omitempty"`
	// Shared: la configurazione vive anche in .adomnia/run-configurations.json, da versionare con il progetto.
	Shared bool `json:"shared,omitempty"`
	// Pinned: in cima ai selettori di configurazione.
	Pinned bool `json:"pinned,omitempty"`
	// RestartOnSave: un'esecuzione in corso riparte quando si salva un file Go del progetto.
	RestartOnSave bool `json:"restartOnSave,omitempty"`
	// RestartPolicy dopo un crash di adOmnia: "" o prompt (si chiede), never, always.
	RestartPolicy string    `json:"restartPolicy,omitempty"`
	Order         int       `json:"order"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

// RequiredSecrets elenca le chiavi il cui valore deve essere fornito a runtime.
func (c RunConfiguration) RequiredSecrets() []string {
	keys := make([]string, 0, len(c.Environment))
	seen := make(map[string]bool)
	for _, entry := range append(append([]EnvironmentEntry(nil), c.Environment...), c.Docker.BuildArgs...) {
		if entry.Secret && !seen[entry.Key] {
			seen[entry.Key] = true
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
	// Bookmarks e Navigation sono gestiti dal frontend e salvati insieme al layout.
	Bookmarks       []Bookmark        `json:"bookmarks,omitempty"`
	Navigation      []NavigationEntry `json:"navigation,omitempty"`
	NavigationIndex int               `json:"navigationIndex,omitempty"`
	// Breakpoints è gestito solo dal backend (SetBreakpoints): SaveSessionView lo conserva.
	Breakpoints map[string][]Breakpoint `json:"breakpoints,omitempty"`
	// FunctionBreakpoints e StopOnPanic sono gestiti dal backend (SetFunctionBreakpoints).
	FunctionBreakpoints []FunctionBreakpoint `json:"functionBreakpoints,omitempty"`
	StopOnPanic         bool                 `json:"stopOnPanic,omitempty"`
	// Cursors: ultima posizione del cursore nei file aperti; Split: lo split dell'editor con i suoi tab.
	Cursors []CursorPosition `json:"cursors,omitempty"`
	Split   *SplitView       `json:"split,omitempty"`
}

// CursorPosition è la posizione del cursore in un file aperto (1-based).
type CursorPosition struct {
	Path   string `json:"path"`
	Line   int    `json:"line"`
	Column int    `json:"column"`
}

// SplitView descrive lo split dell'editor: orientamento, file visibile e tab propri.
type SplitView struct {
	Orientation string   `json:"orientation"`
	ActivePath  string   `json:"activePath"`
	Paths       []string `json:"paths,omitempty"`
}

// Bookmark è un segnalibro di riga del progetto.
type Bookmark struct {
	RelativePath string `json:"relativePath"`
	Line         int    `json:"line"`
}

// NavigationEntry è una posizione della cronologia di navigazione (Back/Forward).
type NavigationEntry struct {
	RelativePath string `json:"relativePath"`
	Line         int    `json:"line"`
	Column       int    `json:"column"`
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
	// Status: safe (il disco è quello da cui si partiva), already-applied (il disco ha già questo testo),
	// conflict (il disco è cambiato dopo la snapshot) o missing.
	Status string `json:"status"`
	// DiskContent è il testo attuale su disco, per il diff Disk Version ↔ Recovered Version.
	DiskContent  string `json:"diskContent,omitempty"`
	SnapshotHash string `json:"snapshotHash,omitempty"`
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
	ExtraTargets     []string          `json:"extraTargets,omitempty"`
	WorkingDirectory string            `json:"workingDirectory"`
	GoArguments      []string          `json:"goArguments"`
	ProgramArguments []string          `json:"programArguments"`
	BuildTags        []string          `json:"buildTags"`
	Environment      map[string]string `json:"environment"`
	// Docker vale per i tipi docker-build e docker-run; i build arg arrivano già risolti.
	Docker DockerOptions `json:"docker"`
	// Secrets sono i nomi di Environment e Docker.BuildArgs il cui valore non deve
	// comparire nella riga di comando: passano solo dall'ambiente del processo.
	Secrets []string `json:"secrets,omitempty"`
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
	// Template è l'ID di un ProjectTemplate; vuoto equivale al modulo vuoto.
	Template  string `json:"template,omitempty"`
	Confirmed bool   `json:"confirmed"`
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
