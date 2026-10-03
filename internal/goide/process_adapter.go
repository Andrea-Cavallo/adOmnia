package goide

import "adomnia/internal/ide/process"

// Alias locali verso il core: evitano di toccare decine di call site durante la migrazione.
var (
	configureProcess          = process.Configure
	terminateProcessTree      = process.TerminateTree
	terminateProcessTreeByPID = process.TerminateTreeByPID
	defaultShell              = process.DefaultShell
)
