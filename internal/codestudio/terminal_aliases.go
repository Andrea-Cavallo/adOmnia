package codestudio

import "github.com/Andrea-Cavallo/adOmnia/internal/ide/terminal"

// Terminal types live in internal/ide/terminal; the aliases keep the GoIDE bindings and callers unchanged.
type (
	TerminalSession = terminal.TerminalSession
	TerminalOutput  = terminal.TerminalOutput
	TerminalRequest = terminal.TerminalRequest
	TerminalManager = terminal.TerminalManager
	TerminalProfile = terminal.TerminalProfile
)

func NewTerminalManager() *TerminalManager    { return terminal.NewTerminalManager() }
func ListTerminalProfiles() []TerminalProfile { return terminal.ListTerminalProfiles() }
