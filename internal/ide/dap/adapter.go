package dap

import (
	jsonv1 "encoding/json"
	"net"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
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
	// ZeroFrameIDs: il primo frame ha id 0 (js-debug), quindi 0 è un frame valido e non "nessun
	// frame" come per Delve e debugpy: senza questa distinzione evaluate partirebbe in scope globale.
	ZeroFrameIDs bool
	// ChildSession costruisce lo spec della sessione figlia che l'adapter chiede con la richiesta
	// inversa startDebugging (js-debug: il processo controllato vive lì). Nil = non supportata.
	ChildSession func(request string, configuration map[string]any) (AdapterSpec, error)
}

type Launch struct {
	SessionID SessionID
	Root      string
	Spec      AdapterSpec
}

// childSession è una connessione figlia dello stesso debug adapter (richiesta inversa
// startDebugging). js-debug la usa per il processo che avvia davvero: il target vive qui, mentre la
// connessione principale resta il canale dei comandi dell'adapter.
type childSession struct {
	client *Client
	conn   net.Conn
}

type LaunchRequest struct {
	// Root è la radice reale del progetto: serve agli adapter che confinano i target al progetto.
	Root             string
	Executable       string
	WorkingDirectory string
	Program          string
	Environment      []string
	LanguageOptions  jsonv1.RawMessage
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
