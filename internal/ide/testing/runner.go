package testing

import (
	"encoding/json"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
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
