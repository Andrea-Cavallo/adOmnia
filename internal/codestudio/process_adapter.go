package codestudio

import "github.com/Andrea-Cavallo/adOmnia/internal/ide/process"

// Alias locali verso il core: evitano di toccare decine di call site durante la migrazione.
var (
	configureProcess          = process.Configure
	terminateProcessTree      = process.TerminateTree
	terminateProcessTreeByPID = process.TerminateTreeByPID
)
