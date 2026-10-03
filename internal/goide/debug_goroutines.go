package goide

import "adomnia/internal/languages/golang"

type GoroutineSummary = golang.GoroutineSummary
type GoroutineOverview = golang.GoroutineOverview
type sourceLineCache = golang.SourceLineCache

const (
	GoroutineRunning   = golang.GoroutineRunning
	GoroutineChanRecv  = golang.GoroutineChanRecv
	GoroutineChanSend  = golang.GoroutineChanSend
	GoroutineSelect    = golang.GoroutineSelect
	GoroutineMutex     = golang.GoroutineMutex
	GoroutineWaitGroup = golang.GoroutineWaitGroup
	GoroutineCond      = golang.GoroutineCond
	GoroutineSleep     = golang.GoroutineSleep
	GoroutineIO        = golang.GoroutineIO
	GoroutineSyscall   = golang.GoroutineSyscall
	GoroutineWaiting   = golang.GoroutineWaiting
)

var goroutineState = golang.GoroutineState
var blockedOn = golang.BlockedOn
var summarizeGoroutine = golang.SummarizeGoroutine
var newSourceLineCache = golang.NewSourceLineCache

func (m *DebugManager) Goroutines(id DebugSessionID) (GoroutineOverview, error) {
	return (&golang.DebugExtensions{Session: m.DebugManager}).Goroutines(id)
}
