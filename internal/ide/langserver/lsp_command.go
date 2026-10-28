package langserver

import (
	"context"
	"encoding/json"
	"fmt"
)

// ExecuteCommand esegue un comando del language server del linguaggio (workspace/executeCommand) e
// restituisce il risultato grezzo. Serve ai server che espongono funzioni oltre LSP (per Java: i comandi
// del Java Debug Server dentro JDT LS); non è un canale per comandi scelti dalla UI.
func (m *LSPManager) ExecuteCommand(ctx context.Context, sessionID SessionID, languageID, command string, arguments ...any) (json.RawMessage, error) {
	state, ok := m.server(sessionID, languageID)
	if !ok {
		return nil, fmt.Errorf("the %s language server is not running", languageID)
	}
	state.mu.Lock()
	process, ready, name := state.process, state.status.State == LanguageServerReady, state.options.DisplayName()
	state.mu.Unlock()
	if process == nil || !ready {
		return nil, fmt.Errorf("%s is not ready", name)
	}
	if _, bounded := ctx.Deadline(); !bounded {
		var cancel context.CancelFunc
		ctx, cancel = withRequestTimeout(ctx)
		defer cancel()
	}
	if arguments == nil {
		arguments = []any{}
	}
	var result json.RawMessage
	if err := process.conn.Call(ctx, "workspace/executeCommand", map[string]any{"command": command, "arguments": arguments}, &result); err != nil {
		return nil, err
	}
	return result, nil
}
