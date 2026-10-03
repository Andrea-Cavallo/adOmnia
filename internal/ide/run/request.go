// Package run owns language-neutral execution requests and lifecycle.
package run

import "encoding/json"

type Request struct {
	Kind             string
	Root             string
	WorkingDirectory string
	Target           string
	ProgramArguments []string
	LanguageOptions  json.RawMessage
	Executable       string
	Environment      []string
}

// Runner constructs a structured command; no shell interpolation is involved.
type Runner interface {
	RunKinds() []string
	CommandSpec(Request) (CommandSpec, error)
}
