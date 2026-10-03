package goide

import "adomnia/internal/ide/run"

type CommandSpec = run.CommandSpec
type ProcessManager = run.ProcessManager

var NewProcessManager = run.NewProcessManager

const (
	MaxConsoleBufferBytes  = run.MaxConsoleBufferBytes
	MaxPendingOutputEvents = run.MaxPendingOutputEvents
	MaxConcurrentRuns      = run.MaxConcurrentRuns
	maxExecutionHistory    = 100
)
