package run

import "time"

type SessionID string
type RunID string
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
type ProcessOutput struct {
	RunID     RunID  `json:"runId"`
	Stream    string `json:"stream"`
	Text      string `json:"text"`
	Truncated bool   `json:"truncated,omitempty"`
}
