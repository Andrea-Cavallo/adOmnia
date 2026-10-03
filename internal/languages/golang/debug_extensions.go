package golang

import (
	"adomnia/internal/ide/dap"
	"fmt"
)

type DebugExtensions struct{ dap.Session }
type DebugSessionID = dap.DebugSessionID
type DebugFrame = dap.DebugFrame
type DebugThread = dap.DebugThread
type SourceLineCache = sourceLineCache

var GoroutineState = goroutineState
var BlockedOn = blockedOn
var SummarizeGoroutine = summarizeGoroutine
var NewSourceLineCache = newSourceLineCache
var ParseByteArray = parseByteArray

func (m *DebugExtensions) ShowRegisters(id DebugSessionID, show bool) error {
	return m.Call(id, "evaluate", map[string]any{"expression": fmt.Sprintf("dlv config showRegisters %t", show), "context": "repl"}, nil)
}
