package testing

import (
	"adomnia/internal/ide/run"
	"encoding/json"
)

type Request struct {
	Root             string
	Executable       string
	WorkingDirectory string
	Environment      []string
	CoverageFile     string
	LanguageOptions  json.RawMessage
}

type TestRunner interface {
	TestCommand(Request) (run.CommandSpec, EventParser, error)
}
