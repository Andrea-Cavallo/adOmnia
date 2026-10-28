// Package langserver runs the language servers of Code Studio sessions (gopls, JDT LS, basedpyright,
// rust-analyzer, the web servers…): one process per session, language and unit, with the document
// tracking, crash restarts, memory budget, idle release and the editor features built on LSP.
package langserver

import (
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/workspace"
)

type (
	SessionID  = run.SessionID
	DocumentID = workspace.DocumentID
	Session    = workspace.Session
	Document   = workspace.Document
	Project    = workspace.Project
)

type DiskChange = workspace.DiskChange
