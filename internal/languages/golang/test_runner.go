package golang

import (
	"adomnia/internal/ide/run"
	idetesting "adomnia/internal/ide/testing"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

func (*Language) TestCommand(request idetesting.Request) (run.CommandSpec, idetesting.EventParser, error) {
	var options TestOptions
	if err := json.Unmarshal(request.LanguageOptions, &options); err != nil {
		return run.CommandSpec{}, nil, fmt.Errorf("opzioni test Go non valide: %w", err)
	}
	for _, pattern := range options.Packages {
		if err := run.ValidateTarget(request.Root, request.WorkingDirectory, strings.TrimSuffix(pattern, "/...")); err != nil {
			return run.CommandSpec{}, nil, err
		}
	}
	arguments, err := TestArguments(options, request.CoverageFile)
	if err != nil {
		return run.CommandSpec{}, nil, err
	}
	return run.CommandSpec{Executable: request.Executable, Arguments: arguments, WorkingDirectory: request.WorkingDirectory, Environment: request.Environment, DisplayCommand: displayRunCommand("go", arguments), QuietStdout: true}, Test2JSONParser{}, nil
}

const (
	maxTestPatterns = 64
	maxTestRepeat   = 1000
)

var shuffleSeed = regexp.MustCompile(`^(on|-?\d{1,19})$`)

type TestOptions struct {
	Language        string          `json:"language,omitempty"`
	LanguageOptions json.RawMessage `json:"languageOptions,omitempty"`
	SessionID       run.SessionID   `json:"sessionId"`
	// WorkingDirectory è la cartella del modulo, relativa al progetto ('' per la radice).
	WorkingDirectory string `json:"workingDirectory"`
	// Packages sono pattern relativi al modulo, es. "./..." o "./internal/api".
	Packages []string `json:"packages"`
	// Run è l'espressione regolare di -run; vuota esegue tutti i test.
	Run string `json:"run,omitempty"`
	// Bench abilita i benchmark con l'espressione indicata (i test vengono esclusi con -run ^$ se Run è vuoto).
	Bench    string `json:"bench,omitempty"`
	Coverage bool   `json:"coverage,omitempty"`
	// Race attiva il race detector (-race): i report finiscono in TestRunSnapshot.RaceReports.
	Race        bool              `json:"race,omitempty"`
	BuildTags   []string          `json:"buildTags,omitempty"`
	Environment map[string]string `json:"environment,omitempty"`
	// Repeat esegue ogni test N volte (-count=N) per misurarne la flakiness; 0 o 1 = una volta.
	Repeat int `json:"repeat,omitempty"`
	// Shuffle è "on" per un ordine casuale o un seed numerico per riprodurlo (-shuffle).
	Shuffle string `json:"shuffle,omitempty"`
	// CPU esegue i test con questi valori di GOMAXPROCS (-cpu): per ogni valore, Repeat ripetizioni.
	CPU []int `json:"cpu,omitempty"`
}

func TestArguments(request TestOptions, coverageFile string) ([]string, error) {
	packages := request.Packages
	if len(packages) == 0 {
		packages = []string{"./..."}
	}
	if len(packages) > maxTestPatterns {
		return nil, fmt.Errorf("troppi package: massimo %d", maxTestPatterns)
	}
	for _, expression := range []string{request.Run, request.Bench} {
		if _, err := regexp.Compile(strings.ReplaceAll(expression, "/", "|")); err != nil {
			return nil, fmt.Errorf("espressione di filtro non valida %q: %w", expression, err)
		}
	}
	if request.Repeat < 0 || request.Repeat > maxTestRepeat {
		return nil, fmt.Errorf("ripetizioni non valide: da 1 a %d", maxTestRepeat)
	}
	if request.Shuffle != "" && !shuffleSeed.MatchString(request.Shuffle) {
		return nil, fmt.Errorf("shuffle non valido %q: usa \"on\" o un seed numerico", request.Shuffle)
	}
	arguments := []string{"test", "-json", fmt.Sprintf("-count=%d", max(1, request.Repeat))}
	if request.Shuffle != "" {
		arguments = append(arguments, "-shuffle="+request.Shuffle)
	}
	if len(request.CPU) > 0 {
		values := make([]string, 0, len(request.CPU))
		for _, cpu := range request.CPU {
			if cpu < 1 || cpu > 1024 || len(request.CPU) > 16 {
				return nil, fmt.Errorf("valori -cpu non validi: da 1 a 1024, al massimo 16")
			}
			values = append(values, strconv.Itoa(cpu))
		}
		arguments = append(arguments, "-cpu="+strings.Join(values, ","))
	}
	if len(request.BuildTags) > 0 {
		arguments = append(arguments, "-tags", strings.Join(request.BuildTags, ","))
	}
	if request.Race {
		arguments = append(arguments, "-race")
	}
	switch {
	case request.Run != "":
		arguments = append(arguments, "-run", request.Run)
	case request.Bench != "":
		arguments = append(arguments, "-run", "^$")
	}
	if request.Bench != "" {
		arguments = append(arguments, "-bench", request.Bench, "-benchmem")
	}
	if coverageFile != "" {
		arguments = append(arguments, "-coverprofile", coverageFile)
	}
	return append(arguments, packages...), nil
}
