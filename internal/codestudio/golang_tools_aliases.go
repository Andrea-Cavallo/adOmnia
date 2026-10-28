package codestudio

import "github.com/Andrea-Cavallo/adOmnia/internal/languages/golang"

// Go tool types (profiles, traces, symbol moves, code generation) live in internal/languages/golang; the
// aliases keep the GoIDE bindings and callers unchanged.
type (
	CodeGenRequest     = golang.CodeGenRequest
	CodeGenResult      = golang.CodeGenResult
	LiveProfileRequest = golang.LiveProfileRequest
	MoveSymbolRequest  = golang.MoveSymbolRequest
	ProfileEdge        = golang.ProfileEdge
	ProfileFile        = golang.ProfileFile
	ProfileFlame       = golang.ProfileFlame
	ProfileFunction    = golang.ProfileFunction
	ProfileLine        = golang.ProfileLine
	ProfileNode        = golang.ProfileNode
	ProfileReport      = golang.ProfileReport
	ProfileSampleType  = golang.ProfileSampleType
	TraceEvent         = golang.TraceEvent
	TraceFrame         = golang.TraceFrame
	TraceGoroutine     = golang.TraceGoroutine
	TraceProc          = golang.TraceProc
	TraceRange         = golang.TraceRange
	TraceReport        = golang.TraceReport
	TraceSpan          = golang.TraceSpan
	TraceStats         = golang.TraceStats
)

func GenerateGoCode(request CodeGenRequest) (CodeGenResult, error) {
	return golang.GenerateGoCode(request)
}
