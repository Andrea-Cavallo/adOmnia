package goide

import (
	idetesting "adomnia/internal/ide/testing"
	"adomnia/internal/languages/golang"
)

type TestLocation = idetesting.TestLocation
type TestResult = idetesting.TestResult
type TestSummary = idetesting.TestSummary

const (
	TestRunning        = idetesting.TestRunning
	TestPassed         = idetesting.TestPassed
	TestFailed         = idetesting.TestFailed
	TestSkipped        = idetesting.TestSkipped
	TestTimedOut       = idetesting.TestTimedOut
	TestBenchmarked    = idetesting.TestBenchmarked
	maxTestOutputBytes = 64 * 1024
)

type testTree struct {
	*idetesting.Tree
	parser idetesting.EventParser
}

func newTestTree() *testTree {
	return &testTree{Tree: idetesting.NewTree(), parser: golang.Test2JSONParser{}}
}
func (t *testTree) apply(line []byte) {
	if event, ok := t.parser.Parse(line); ok {
		t.Apply(event)
	}
}
func (t *testTree) snapshot() ([]TestResult, TestSummary) { return t.Snapshot() }
