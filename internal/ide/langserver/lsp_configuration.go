package langserver

// RefreshConfiguration notifies running servers after a persisted setting changes.
// Merely reevaluating workspace/configuration is insufficient: the server must
// first know to ask for it. Documents and processes remain intact.
func (m *LSPManager) RefreshConfiguration(sessionID SessionID, languageID string) error {
	for _, state := range m.statesOf(sessionID, languageID) {
		state.mu.Lock()
		process, configuration := state.synced, state.options.Configuration
		state.mu.Unlock()
		if process == nil || configuration == nil {
			continue
		}
		if err := process.conn.Notify("workspace/didChangeConfiguration", map[string]any{"settings": configuration()}); err != nil {
			return err
		}
	}
	return nil
}
