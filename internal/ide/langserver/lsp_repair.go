package langserver

import (
	"context"
	"encoding/json"
	"log"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/lsp"
)

// maxRepairs bounds how many times one repair key runs per server process: a repair that the server
// undoes (a re-import) runs again, one that does not hold stops instead of looping on every build.
const maxRepairs = 3

// repairDiagnostics runs the command the spec answers to a report, outside the read loop of the
// connection (a server request from inside a notification handler would deadlock).
func (m *LSPManager) repairDiagnostics(state *lspSession, report lsp.PublishDiagnosticsParams) {
	if len(report.Diagnostics) == 0 {
		return
	}
	state.mu.Lock()
	hook, process := state.options.DiagnosticsRepair, state.process
	if hook == nil || process == nil || state.closed {
		state.mu.Unlock()
		return
	}
	repair, ok := hook(report.URI, report.Diagnostics)
	if !ok || state.repairs[repairKey{process, repair.Key}] >= maxRepairs {
		state.mu.Unlock()
		return
	}
	if state.repairs == nil {
		state.repairs = make(map[repairKey]int)
	}
	state.repairs[repairKey{process, repair.Key}]++
	name := state.options.DisplayName()
	state.mu.Unlock()
	go func() {
		ctx, cancel := withRequestTimeout(context.Background())
		defer cancel()
		var result json.RawMessage
		if err := process.conn.Call(ctx, "workspace/executeCommand", map[string]any{"command": repair.Command, "arguments": repair.Arguments}, &result); err != nil {
			log.Printf("[lsp] %s: %s for %s failed: %v", name, repair.Command, repair.Key, err)
		}
	}()
}

// repairKey ties a repair count to the process it ran on: a restarted server starts from zero.
type repairKey struct {
	process *serverProcess
	key     string
}
