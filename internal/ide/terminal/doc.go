// Package terminal runs the interactive shells of Code Studio: PTY sessions per project session,
// coalesced output events and the detected shell profiles (local shells, WSL, SSH hosts, containers).
package terminal

import "github.com/Andrea-Cavallo/adOmnia/internal/ide/run"

// SessionID identifies the Code Studio session that owns a terminal.
type SessionID = run.SessionID

// TerminalID identifies one terminal.
type TerminalID string
