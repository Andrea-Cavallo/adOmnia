package run

import (
	"encoding/json"
	"time"
)

type Configuration struct {
	Language         string             `json:"language,omitempty"`
	LanguageOptions  json.RawMessage    `json:"languageOptions,omitempty"`
	ID               string             `json:"id"`
	SessionID        SessionID          `json:"sessionId"`
	Name             string             `json:"name"`
	Kind             Kind               `json:"kind"`
	Target           string             `json:"target"`
	Files            []string           `json:"files,omitempty"`
	BinaryPath       string             `json:"binaryPath,omitempty"`
	WorkingDirectory string             `json:"workingDirectory"`
	ProgramArguments []string           `json:"programArguments"`
	Environment      []EnvironmentEntry `json:"environment"`
	Docker           DockerOptions      `json:"docker"`
	EnvFile          string             `json:"envFile,omitempty"`
	Port             int                `json:"port,omitempty"`
	PreRun           []string           `json:"preRun,omitempty"`
	PostRun          []string           `json:"postRun,omitempty"`
	Compound         []string           `json:"compound,omitempty"`
	Shared           bool               `json:"shared,omitempty"`
	Pinned           bool               `json:"pinned,omitempty"`
	RestartOnSave    bool               `json:"restartOnSave,omitempty"`
	RestartPolicy    string             `json:"restartPolicy,omitempty"`
	Order            int                `json:"order"`
	CreatedAt        time.Time          `json:"createdAt"`
	UpdatedAt        time.Time          `json:"updatedAt"`
}
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
type EnvironmentEntry struct {
	Key    string `json:"key"`
	Value  string `json:"value,omitempty"`
	Secret bool   `json:"secret,omitempty"`
}
type Kind string
