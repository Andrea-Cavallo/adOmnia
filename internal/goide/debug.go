package goide

import (
	"adomnia/internal/ide/dap"
	"adomnia/internal/languages/golang"
	"encoding/json"
)

type DebugRequest = golang.DebugRequest
type DebugManager struct{ *dap.DebugManager }

func NewDebugManager() *DebugManager { return &DebugManager{DebugManager: dap.NewDebugManager()} }

type debugLaunch struct {
	session     Session
	request     DebugRequest
	binary      string
	moduleDir   string
	program     string
	environment []string
}

func (m *DebugManager) Start(launch debugLaunch) (DebugSessionInfo, error) {
	options, err := json.Marshal(launch.request)
	if err != nil {
		return DebugSessionInfo{}, err
	}
	spec, err := golang.New().DebugAdapter(dap.LaunchRequest{Executable: launch.binary, WorkingDirectory: launch.moduleDir, Program: launch.program, Environment: launch.environment, LanguageOptions: options})
	if err != nil {
		return DebugSessionInfo{}, err
	}
	return m.DebugManager.Start(dap.Launch{SessionID: launch.session.ID, Root: launch.session.Project.RealPath, Spec: spec})
}
func (m *DebugManager) stackTrace(id DebugSessionID, threadID, levels int) ([]DebugFrame, error) {
	return m.StackTraceLimit(id, threadID, levels)
}
func (m *DebugManager) call(id DebugSessionID, command string, arguments, result any) error {
	return m.Call(id, command, arguments, result)
}
func (m *DebugManager) ShowRegisters(id DebugSessionID, show bool) error {
	return (&golang.DebugExtensions{Session: m.DebugManager}).ShowRegisters(id, show)
}

var debugTitle = golang.DebugTitle
var debugBinaryName = golang.DebugBinaryName

const (
	debugModeAttach = "attach"
	debugModeRemote = "remote"
	DebugStarting   = dap.DebugStarting
	DebugRunning    = dap.DebugRunning
	DebugStopped    = dap.DebugStopped
	DebugTerminated = dap.DebugTerminated
)

type DebugSessionInfo = dap.DebugSessionInfo
type DebugOutput = dap.DebugOutput
type DebugThread = dap.DebugThread
type DebugFrame = dap.DebugFrame
type DebugInstruction = dap.DebugInstruction
type DebugScope = dap.DebugScope
type DebugVariable = dap.DebugVariable
type EvaluateResult = dap.EvaluateResult
