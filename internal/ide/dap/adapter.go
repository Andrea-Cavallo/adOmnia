package dap

import (
	"adomnia/internal/ide/run"
	"encoding/json"
)

type SessionID = run.SessionID
type DebugSessionID string

type Transport string

const (
	Stdio     Transport = "stdio"
	TCPListen Transport = "tcp-listen"
)

// AdapterSpec describes an adapter without coupling the lifecycle to its language.
type AdapterSpec struct {
	AdapterID            string
	Executable           string
	Arguments            []string
	Environment          []string
	WorkingDirectory     string
	Transport            Transport
	ReadyPattern         string
	Address              string
	Detach               bool
	Title                string
	Launch               func(buildDirectory string) (string, map[string]any)
	ExplainError         func(error) error
	RetryEvaluate        func(expression, context string, err error) (string, bool)
	ExplainEvaluateError func(error, string) error
	PanicFunction        string
}

type Launch struct {
	SessionID SessionID
	Root      string
	Spec      AdapterSpec
}

type LaunchRequest struct {
	Executable       string
	WorkingDirectory string
	Program          string
	Environment      []string
	LanguageOptions  json.RawMessage
}

type DebugAdapterProvider interface {
	DebugAdapter(LaunchRequest) (AdapterSpec, error)
}

// Session exposes DAP operations used by optional language extensions.
type Session interface {
	Call(DebugSessionID, string, any, any) error
	Evaluate(DebugSessionID, string, int, string) (EvaluateResult, error)
	Threads(DebugSessionID) ([]DebugThread, error)
	StackTraceLimit(DebugSessionID, int, int) ([]DebugFrame, error)
	Disassemble(DebugSessionID, string, int, int) ([]DebugInstruction, error)
}
