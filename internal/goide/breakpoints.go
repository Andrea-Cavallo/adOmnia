package goide

import (
	"adomnia/internal/ide/dap"
	"adomnia/internal/languages/golang"
)

type Breakpoint = dap.Breakpoint
type BreakpointState = dap.BreakpointState
type FileBreakpoints = dap.FileBreakpoints
type FunctionBreakpoint = dap.FunctionBreakpoint
type FunctionBreakpointSettings = dap.FunctionBreakpointSettings
type FunctionBreakpointState = dap.FunctionBreakpointState
type FunctionBreakpointsView = dap.FunctionBreakpointsView

var normalizeBreakpoints = golang.NormalizeBreakpoints
var normalizeFunctionBreakpoints = golang.NormalizeFunctionBreakpoints
var dapSourceBreakpoints = dap.DAPSourceBreakpoints
var unverifiedStates = dap.UnverifiedStates
var unverifiedFunctionView = dap.UnverifiedFunctionView

const panicFunction = "runtime.gopanic"

func dapFunctionBreakpoints(settings FunctionBreakpointSettings) ([]map[string]any, []int) {
	return dap.DAPFunctionBreakpoints(settings, panicFunction)
}
