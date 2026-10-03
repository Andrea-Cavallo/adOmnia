package testing

import (
	"adomnia/internal/ide/run"
	"encoding/json"
)

type Request struct {
	Executable       string
	WorkingDirectory string
	Environment      []string
	CoverageFile     string
	LanguageOptions  json.RawMessage
}

type TestRunner interface {
	TestCommand(Request) (run.CommandSpec, EventParser, error)
}
