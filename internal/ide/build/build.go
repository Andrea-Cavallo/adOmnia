// Package build plans and runs the build of the units detected in a project.
//
// Nothing here knows Gradle, Maven, Cargo or npm: every language adapter already resolves its
// own tool (wrapper first, then PATH) and returns a structured run.Suggestion, so the plan only
// asks the adapter and the executor only starts what came back. No shell is involved.
package build

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/language"
	processcore "github.com/Andrea-Cavallo/adOmnia/internal/ide/process"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
	"github.com/Andrea-Cavallo/adOmnia/internal/procutil"
)

const (
	// DefaultTimeout bounds one build when the caller says nothing.
	DefaultTimeout = 15 * time.Minute
	// MaxTimeout caps what a caller may ask for: a build that never ends is not a tool result.
	MaxTimeout = 60 * time.Minute
	// maxOutputBytes keeps the tail of the output: a Gradle log is megabytes and the MCP
	// response has to stay readable.
	maxOutputBytes = 64 << 10
)

// Options tunes detection and execution.
type Options struct {
	// Task replaces the arguments of a command build ("clean build", "install", …). A
	// structured build (Go, Cargo) ignores it: its command is not a simple task name.
	Task string
	// Timeout bounds one build; zero means DefaultTimeout, above MaxTimeout is clamped.
	Timeout time.Duration
	// Toolchain returns the executable of a language toolchain when its adapter asks for one
	// (Go needs the go binary). The host supplies it; the plan never guesses a binary name.
	Toolchain func(languageID string) (string, bool)
}

// Unit is one buildable unit of the project, already resolved to a command.
type Unit struct {
	Language string `json:"language"`
	Kind     string `json:"kind"`
	Name     string `json:"name,omitempty"`
	Root     string `json:"root"`
	// Title is the adapter's own label ("Gradle · ./gradlew build"), when it proposed one.
	Title      string   `json:"title,omitempty"`
	Executable string   `json:"executable,omitempty"`
	Arguments  []string `json:"arguments,omitempty"`
	Command    string   `json:"command,omitempty"`
	Runnable   bool     `json:"runnable"`
	// Reason explains why a unit cannot run, or what was overridden in its command.
	Reason string `json:"reason,omitempty"`

	spec run.CommandSpec
}

// Plan is the outcome of Detect: the project root and one entry per detected unit.
type Plan struct {
	Root  string `json:"root"`
	Units []Unit `json:"units"`
	// Problems are detection warnings that did not prevent planning.
	Problems []string `json:"problems,omitempty"`
}

// Result is the outcome of one unit's build.
type Result struct {
	Language   string `json:"language"`
	Kind       string `json:"kind"`
	Name       string `json:"name,omitempty"`
	Root       string `json:"root"`
	Command    string `json:"command,omitempty"`
	Status     string `json:"status"`
	ExitCode   int    `json:"exitCode"`
	DurationMs int64  `json:"durationMs"`
	Output     string `json:"output,omitempty"`
	Truncated  bool   `json:"truncated,omitempty"`
	Reason     string `json:"reason,omitempty"`
}

// Build statuses.
const (
	StatusOK      = "ok"
	StatusFailed  = "failed"
	StatusTimeout = "timeout"
	StatusSkipped = "skipped"
)

// Detect resolves the build command of every unit under root without executing anything.
func Detect(ctx context.Context, registry *language.Registry, root string, options Options) (*Plan, error) {
	absolute, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(absolute)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("%s: not a directory", absolute)
	}
	units, detectErr := registry.DetectUnits(ctx, absolute)
	if detectErr != nil && len(units) == 0 {
		return nil, detectErr
	}
	sort.SliceStable(units, func(i, j int) bool { return units[i].Root < units[j].Root })
	plan := &Plan{Root: absolute, Units: make([]Unit, 0, len(units))}
	if detectErr != nil {
		plan.Problems = append(plan.Problems, detectErr.Error())
	}
	for _, unit := range units {
		plan.Units = append(plan.Units, planUnit(ctx, registry, absolute, unit, options))
	}
	return plan, nil
}

// planUnit asks the unit's adapter for its build suggestion and resolves it to a command.
func planUnit(ctx context.Context, registry *language.Registry, projectRoot string, unit project.Unit, options Options) Unit {
	entry := Unit{Language: unit.Language, Kind: unit.Kind, Name: unit.Name, Root: unit.Root}
	adapter, ok := registry.Get(unit.Language)
	if !ok {
		entry.Reason = fmt.Sprintf("language %q is not registered", unit.Language)
		return entry
	}
	provider, ok := adapter.(run.SuggestionProvider)
	if !ok {
		entry.Reason = fmt.Sprintf("%s does not propose build commands", adapter.Name())
		return entry
	}
	suggestion, ok := buildSuggestion(provider.Suggest(ctx, projectRoot, unit))
	if !ok {
		entry.Reason = fmt.Sprintf("no build tool found for %s: add the project wrapper or install the tool", unit.Kind)
		return entry
	}
	entry.Title = suggestion.Title
	configuration := suggestion.Configuration
	arguments := append([]string(nil), configuration.ProgramArguments...)
	if task := strings.TrimSpace(options.Task); task != "" {
		if configuration.Kind == "command" {
			arguments = strings.Fields(task)
		} else {
			entry.Reason = "the task override applies to command builds only: this unit runs a fixed tool command"
		}
	}
	spec, err := commandSpec(adapter, projectRoot, unit, configuration, arguments, options)
	if err != nil {
		entry.Reason = err.Error()
		return entry
	}
	entry.Executable, entry.Arguments = spec.Executable, spec.Arguments
	entry.Command = spec.DisplayCommand
	entry.Runnable = true
	entry.spec = spec
	return entry
}

// buildSuggestion picks the first build proposal: adapters order it best-first (build, then
// clean build, then clean).
func buildSuggestion(suggestions []run.Suggestion) (run.Suggestion, bool) {
	for _, suggestion := range suggestions {
		if suggestion.Action == "build" {
			return suggestion, true
		}
	}
	return run.Suggestion{}, false
}

// commandSpec builds the command the same way the IDE does: a free command goes through
// run.Command (wrapper inside the project or tool on PATH), a structured one through the
// adapter's runner.
func commandSpec(adapter language.Language, projectRoot string, unit project.Unit, configuration run.Configuration, arguments []string, options Options) (run.CommandSpec, error) {
	if configuration.Kind == "command" {
		if strings.TrimSpace(configuration.Target) == "" {
			return run.CommandSpec{}, errors.New("the adapter proposed a command without a target")
		}
		return run.Command(unit.Root, unit.Root, configuration.Target, arguments)
	}
	runner, ok := adapter.(language.Runner)
	if !ok {
		return run.CommandSpec{}, fmt.Errorf("%s cannot build a %s unit without a runner", adapter.Name(), unit.Kind)
	}
	request := run.Request{
		Kind: string(configuration.Kind), Root: projectRoot, WorkingDirectory: unit.Root,
		Target: configuration.Target, ProgramArguments: arguments,
		LanguageOptions: configuration.LanguageOptions,
	}
	if options.Toolchain != nil {
		if path, found := options.Toolchain(unit.Language); found {
			request.Executable = path
		}
	}
	return runner.CommandSpec(request)
}

// Execute runs every runnable unit of the plan, in plan order, and collects the results.
func (p *Plan) Execute(ctx context.Context, options Options) []Result {
	timeout := options.Timeout
	if timeout <= 0 {
		timeout = DefaultTimeout
	}
	if timeout > MaxTimeout {
		timeout = MaxTimeout
	}
	results := make([]Result, 0, len(p.Units))
	for _, unit := range p.Units {
		results = append(results, executeUnit(ctx, unit, timeout))
	}
	return results
}

func executeUnit(ctx context.Context, unit Unit, timeout time.Duration) Result {
	result := Result{Language: unit.Language, Kind: unit.Kind, Name: unit.Name, Root: unit.Root, Command: unit.Command}
	if !unit.Runnable {
		result.Status, result.ExitCode, result.Reason = StatusSkipped, -1, unit.Reason
		return result
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	command := procutil.CommandContext(ctx, unit.spec.Executable, unit.spec.Arguments...)
	command.Dir = unit.spec.WorkingDirectory
	if command.Dir == "" {
		command.Dir = unit.Root
	}
	if len(unit.spec.Environment) > 0 {
		command.Env = append(os.Environ(), unit.spec.Environment...)
	}
	output := &tailBuffer{limit: maxOutputBytes}
	command.Stdout, command.Stderr = output, output
	started := time.Now()
	runErr := command.Run()
	result.DurationMs = time.Since(started).Milliseconds()
	result.Output, result.Truncated = output.Text(), output.truncated
	result.ExitCode = -1
	if command.ProcessState != nil {
		result.ExitCode = command.ProcessState.ExitCode()
	}
	switch {
	case ctx.Err() == context.DeadlineExceeded:
		result.Status = StatusTimeout
		result.Reason = fmt.Sprintf("the build did not finish within %s", timeout)
		// The context kills the direct child only: a build daemon or a wrapper keeps its own tree.
		_ = processcore.TerminateTree(command)
	case runErr != nil:
		result.Status = StatusFailed
		result.Reason = runErr.Error()
	default:
		result.Status = StatusOK
	}
	return result
}

// tailBuffer keeps the last limit bytes written to it: the end of a build is where the errors
// are, and a Gradle or Maven log does not fit in a tool response.
type tailBuffer struct {
	data      []byte
	limit     int
	truncated bool
}

func (b *tailBuffer) Write(chunk []byte) (int, error) {
	b.data = append(b.data, chunk...)
	if len(b.data) > b.limit {
		excess := len(b.data) - b.limit
		b.data = b.data[excess:]
		b.truncated = true
	}
	return len(chunk), nil
}

// Text returns the retained output as a string, without a dangling partial line at the start.
func (b *tailBuffer) Text() string {
	text := string(b.data)
	if b.truncated {
		if index := strings.IndexByte(text, '\n'); index >= 0 {
			text = text[index+1:]
		}
	}
	return strings.TrimRight(text, "\r\n")
}
